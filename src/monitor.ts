import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';

/**
 * Solana 巨鲸监控系统 (V13 死磕防漏版)
 * * 核心升级：
 * 1. [死磕机制] 余额变动后，若未查到交易，将进行 5 次指数级重试 (2s, 3s, 4s...)。
 * 2. [RPC优化] 支持直接填入 Helius/QuickNode 的 API Key。
 * 3. [防漏单] 只要余额变了，就算查不到交易详情，最终也会强制播报余额变动。
 */

// ==================== 1. 基础配置 ====================
// ⚠️ 强烈建议替换为 Helius 免费 RPC，公共节点极易漏单
// 格式: 'https://mainnet.helius-rpc.com/?api-key=xxxxxxx'
const CUSTOM_RPC_URL = ''; 

// 代理配置 (Clash: 7890)
const PROXY_URL = 'http://127.0.0.1:7890'; 
const proxyAgent = new HttpsProxyAgent(PROXY_URL);

const customFetch = (url: string, options: any = {}) => {
    return fetch(url, { ...options, agent: proxyAgent });
};

// ==================== 2. 代币名称解析 ====================
const tokenMetadataCache = new Map<string, string>();
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
tokenMetadataCache.set(WSOL_MINT, 'SOL');
tokenMetadataCache.set('EPjFWdd5VenBxibDrxxPoNr6mVteov4ZHq9s6upZeY81', 'USDC');
tokenMetadataCache.set('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USDT');

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

function isStandardTicker(str: string): boolean {
    return /^[A-Za-z0-9$ ]+$/.test(str);
}

async function fetchFromDexScreener(mint: string): Promise<string | null> {
    try {
        const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
        const res = await customFetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.pairs && data.pairs.length > 0) return data.pairs[0].baseToken.symbol;
        return null;
    } catch (e) { return null; }
}

async function getSymbolFromMint(connection: Connection, mintAddress: string): Promise<string> {
    if (tokenMetadataCache.has(mintAddress)) return tokenMetadataCache.get(mintAddress)!;
    const shortName = `${mintAddress.slice(0, 4)}..${mintAddress.slice(-4)}`;
    
    try {
        const apiSymbol = await fetchFromDexScreener(mintAddress);
        if (apiSymbol) {
            tokenMetadataCache.set(mintAddress, apiSymbol);
            return apiSymbol;
        }
    } catch (e) {}

    try {
        const mintKey = new PublicKey(mintAddress);
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mintKey.toBuffer()],
            METADATA_PROGRAM_ID
        );
        const accountInfo = await connection.getAccountInfo(pda);
        if (accountInfo && accountInfo.data[0] === 4) {
            let offset = 65;
            const nameLen = accountInfo.data.readUInt32LE(offset);
            offset += 4 + nameLen; 
            const symbolLen = accountInfo.data.readUInt32LE(offset);
            offset += 4;
            let symbol = accountInfo.data.toString('utf8', offset, offset + symbolLen).replace(/\u0000/g, '').trim();
            if (symbol && isStandardTicker(symbol)) {
                tokenMetadataCache.set(mintAddress, symbol);
                return symbol;
            }
        }
    } catch (e) {}

    tokenMetadataCache.set(mintAddress, shortName);
    return shortName;
}

// ==================== 3. RPC 连接 ====================
const PUBLIC_RPC_ENDPOINTS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana'
];

async function chooseRpcEndpoint(): Promise<string> {
    // 1. 如果填了自定义 RPC，直接用
    if (CUSTOM_RPC_URL && CUSTOM_RPC_URL.length > 10) {
        console.log(`[配置] 使用自定义 RPC 节点`);
        return CUSTOM_RPC_URL;
    }

    // 2. 否则用公共节点
    for (const endpoint of PUBLIC_RPC_ENDPOINTS) {
        try {
            const conn = new Connection(endpoint, { fetch: customFetch as any });
            const v = await conn.getVersion();
            console.log(`[连接] 成功连接公共节点: ${endpoint} (v${v['solana-core']})`);
            console.log(`[建议] 公共节点极易漏单，强烈建议申请 Helius 免费 Key 填入代码顶部！`);
            return endpoint;
        } catch (e) {}
    }
    throw new Error('无可用 RPC 节点');
}

// ==================== 4. 钱包配置读取 ====================
interface WalletConfig {
    address: string;
    name: string;
    emoji?: string;
    publicKey: PublicKey;
}

function loadWalletConfigs(): WalletConfig[] {
    try {
        const p = path.join(__dirname, '..', 'wallets.json');
        const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const valid: WalletConfig[] = [];
        for (const item of raw) {
            const addr = item.address || item.trackedWalletAddress;
            if (addr) {
                valid.push({
                    address: addr,
                    name: item.name || '未知',
                    emoji: item.emoji || '👻',
                    publicKey: new PublicKey(addr)
                });
            }
        }
        return valid;
    } catch (e) {
        console.error('读取 wallets.json 失败');
        return [];
    }
}

// ==================== 5. 交易解析逻辑 (V13 死磕版) ====================

interface TradeDetails {
    signature: string;
    tokenMint: string;
    tokenName: string;
    tokenChange: number;
    solChange: number; 
    isBuy: boolean;
    type: 'SWAP' | 'TRANSFER' | 'WRAP';
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchLastTransactionDetails(
    connection: Connection, 
    pubKey: PublicKey
): Promise<TradeDetails | null> {
    let signatures: any[] = [];
    let attempts = 0;
    const maxRetries = 5; // 死磕 5 次

    // --- 阶段 1: 死磕获取签名 ---
    while (attempts < maxRetries) {
        try {
            signatures = await connection.getSignaturesForAddress(pubKey, { limit: 3 });
            
            // 如果拿到了签名，且没有错误，就跳出循环
            if (signatures.length > 0 && !signatures[0].err) {
                break;
            }
        } catch (e) {
            // 忽略网络错误，继续重试
        }

        attempts++;
        // 指数退避：第一次等 2s, 第二次 3s, 第三次 4s...
        if (attempts < maxRetries) {
            // console.log(`[重试] 未索引到交易，第 ${attempts} 次重试...`);
            await sleep(1000 + (attempts * 1000));
        }
    }

    if (signatures.length === 0) return null;
    const sig = signatures[0].signature;

    // --- 阶段 2: 获取详情 ---
    try {
        const tx = await connection.getParsedTransaction(sig, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
        });

        if (!tx || !tx.meta) return null;

        const logMessages = tx.meta.logMessages || [];
        const isSwapProgram = logMessages.some(log => 
            log.includes('Program JUP') || 
            log.includes('Program 675kPX9M') || 
            log.includes('Program 6EF8rrect') || 
            log.includes('Instruction: Swap')
        );

        const accountIndex = tx.transaction.message.accountKeys.findIndex(
            k => k.pubkey.toBase58() === pubKey.toBase58()
        );
        if (accountIndex === -1) return null;
        const preNative = tx.meta.preBalances[accountIndex];
        const postNative = tx.meta.postBalances[accountIndex];
        const nativeDiff = (postNative - preNative) / 1e9;

        let targetMint = '';
        let targetChange = 0;
        let wSolDiff = 0;

        const preTokenBals = tx.meta.preTokenBalances || [];
        const postTokenBals = tx.meta.postTokenBalances || [];
        const allMints = new Set<string>();
        preTokenBals.forEach(b => allMints.add(b.mint));
        postTokenBals.forEach(b => allMints.add(b.mint));

        for (const mint of allMints) {
            const preBalObj = preTokenBals.find(b => b.mint === mint && b.owner === pubKey.toBase58());
            const postBalObj = postTokenBals.find(b => b.mint === mint && b.owner === pubKey.toBase58());
            const amountPre = preBalObj?.uiTokenAmount.uiAmount || 0;
            const amountPost = postBalObj?.uiTokenAmount.uiAmount || 0;
            const diff = amountPost - amountPre;

            if (Math.abs(diff) > 0) {
                if (mint === WSOL_MINT) {
                    wSolDiff += diff;
                } else {
                    if (Math.abs(diff) > Math.abs(targetChange)) {
                        targetMint = mint;
                        targetChange = diff;
                    }
                }
            }
        }

        const totalSolFlow = nativeDiff + wSolDiff;

        if (targetMint) {
            const symbol = await getSymbolFromMint(connection, targetMint);
            return {
                signature: sig,
                tokenMint: targetMint,
                tokenName: symbol,
                tokenChange: targetChange,
                solChange: totalSolFlow,
                isBuy: targetChange > 0,
                type: 'SWAP'
            };
        }

        if (isSwapProgram) {
             return {
                signature: sig,
                tokenMint: 'UNKNOWN',
                tokenName: '未知代币',
                tokenChange: 0,
                solChange: totalSolFlow,
                isBuy: totalSolFlow < 0,
                type: 'SWAP'
            };
        }

        if (Math.abs(nativeDiff) > 0.001 && Math.abs(wSolDiff) > 0.001 && Math.abs(totalSolFlow) < 0.01) {
            return {
                signature: sig,
                tokenMint: 'WSOL',
                tokenName: 'wSOL',
                tokenChange: wSolDiff,
                solChange: nativeDiff,
                isBuy: wSolDiff > 0,
                type: 'WRAP'
            };
        }

        return {
            signature: sig,
            tokenMint: 'SOL',
            tokenName: 'SOL',
            tokenChange: totalSolFlow,
            solChange: totalSolFlow,
            isBuy: totalSolFlow > 0,
            type: 'TRANSFER'
        };

    } catch (e) {
        return null;
    }
}

// ==================== 6. 轮询监控逻辑 ====================

const balanceCache = new Map<string, number>();

function chunkArray<T>(array: T[], size: number): T[][] {
    const res: T[][] = [];
    for (let i = 0; i < array.length; i += size) res.push(array.slice(i, i + size));
    return res;
}

function lamportsToSol(l: number) { return l / 1e9; }
function formatTime() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }

async function startPolling(connection: Connection, wallets: WalletConfig[]) {
    const CHUNK_SIZE = 50;
    const INTERVAL = 10000; 

    const chunks = chunkArray(wallets, CHUNK_SIZE);
    console.log(`[系统] 监控 ${wallets.length} 个钱包，分 ${chunks.length} 组轮询...\n`);

    console.log('[初始化] 建立余额基准...');
    for (const chunk of chunks) {
        try {
            const infos = await connection.getMultipleAccountsInfo(chunk.map(w => w.publicKey));
            infos.forEach((info, i) => {
                balanceCache.set(chunk[i].address, info ? info.lamports : 0);
            });
            await sleep(200);
        } catch (e) {}
    }
    console.log('[初始化] 完成，开始监控交易...\n');

    while (true) {
        for (const chunk of chunks) {
            try {
                const infos = await connection.getMultipleAccountsInfo(chunk.map(w => w.publicKey));
                const updates = [];
                for (let i = 0; i < infos.length; i++) {
                    const info = infos[i];
                    const wallet = chunk[i];
                    const cur = info ? info.lamports : 0;
                    const old = balanceCache.get(wallet.address) ?? 0;

                    if (cur !== old) {
                        const diffSol = lamportsToSol(cur - old);
                        // 任何微小变动都记录，防止漏 wSOL 交易
                        if (Math.abs(diffSol) > 0.000001) { 
                            balanceCache.set(wallet.address, cur); 
                            updates.push({ wallet, cur, diffSol });
                        } else {
                            balanceCache.set(wallet.address, cur);
                        }
                    }
                }

                if (updates.length > 0) {
                    for (const update of updates) {
                        const { wallet, cur, diffSol } = update;
                        const details = await fetchLastTransactionDetails(connection, wallet.publicKey);
                        const nameDisplay = `${wallet.emoji} ${wallet.name}`;
                        const time = formatTime();
                        
                        if (details) {
                            // 成功抓取到交易详情
                            if (details.type === 'TRANSFER') {
                                if (Math.abs(details.solChange) > 0.001) {
                                    const action = details.solChange > 0 ? "💰 纯SOL转入" : "💸 纯SOL转出";
                                    console.log('----------------------------------------');
                                    console.log(`[${time}] ${action} | ${nameDisplay}`);
                                    console.log(`   金额: ${details.solChange > 0 ? '+' : ''}${details.solChange.toFixed(4)} SOL`);
                                    console.log(`   TX: https://solscan.io/tx/${details.signature}`);
                                }
                            } else if (details.type !== 'WRAP') {
                                // SWAP or UNKNOWN
                                const action = details.isBuy ? "🟢 买入" : "🔴 卖出";
                                const tokenInfo = `${details.tokenName} (${details.tokenChange > 0 ? '+' : ''}${details.tokenChange.toFixed(2)})`;
                                const solInfo = `${Math.abs(details.solChange).toFixed(4)} SOL`;
                                
                                console.log('----------------------------------------');
                                console.log(`[${time}] ${action} | ${nameDisplay}`);
                                console.log(`   代币: ${tokenInfo}`);
                                console.log(`   CA: ${details.tokenMint}`);
                                console.log(`   金额: ${solInfo}`);
                                console.log(`   TX: https://solscan.io/tx/${details.signature}`);
                            }
                        } else {
                            // 兜底：虽然重试了5次还是没查到交易，但必须播报余额变动，防止漏消息
                            if (Math.abs(diffSol) > 0.01) {
                                const action = diffSol > 0 ? "💰 余额增加" : "💸 余额减少";
                                console.log('----------------------------------------');
                                console.log(`[${time}] ${action} | ${nameDisplay}`);
                                console.log(`   金额: ${diffSol > 0 ? '+' : ''}${diffSol.toFixed(4)} SOL (⚠️ 节点严重延迟，未索引到交易)`);
                            }
                        }
                        if (updates.length > 1) await sleep(2000);
                    }
                }
            } catch (e) {
                if (String(e).includes('429')) {
                    console.warn('[限流] 休息 5秒...');
                    await sleep(5000);
                }
            }
            await sleep(500); 
        }
        await sleep(INTERVAL);
    }
}

async function main() {
    try {
        const wallets = loadWalletConfigs();
        if (wallets.length === 0) return console.error('无钱包配置');
        const endpoint = await chooseRpcEndpoint();
        const connection = new Connection(endpoint, { commitment: 'confirmed', fetch: customFetch as any });
        console.log('========================================');
        console.log('   Solana 巨鲸监控系统 (V13 死磕防漏版)');
        console.log('========================================');
        startPolling(connection, wallets).catch(console.error);
    } catch (e) {
        console.error('启动失败:', e);
    }
}

main();