import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';

/**
 * Solana 巨鲸监控系统 (V12 CA增强版)
 * * 核心升级：
 * 1. [新增] 强制显示代币合约地址 (CA)，方便复制查询。
 * 2. [优化] 修复日志中出现大量空行的问题。
 * 3. [清洗] 进一步优化代币名称显示逻辑。
 */

// ==================== 1. 基础配置 ====================
const PROXY_URL = 'http://127.0.0.1:7890'; // 请确认端口
const proxyAgent = new HttpsProxyAgent(PROXY_URL);

const customFetch = (url: string, options: any = {}) => {
    return fetch(url, { ...options, agent: proxyAgent });
};

// ==================== 2. 代币解析工具 ====================
const tokenMetadataCache = new Map<string, string>();
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
tokenMetadataCache.set(WSOL_MINT, 'SOL');
tokenMetadataCache.set('EPjFWdd5VenBxibDrxxPoNr6mVteov4ZHq9s6upZeY81', 'USDC');
tokenMetadataCache.set('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USDT');

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

function isStandardTicker(str: string): boolean {
    // 允许英文字母、数字、美元符、空格
    return /^[A-Za-z0-9$ ]+$/.test(str);
}

/**
 * 尝试从 DexScreener 获取代币信息
 */
async function fetchFromDexScreener(mint: string): Promise<string | null> {
    try {
        const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
        const res = await customFetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.pairs && data.pairs.length > 0) {
            return data.pairs[0].baseToken.symbol;
        }
        return null;
    } catch (e) { return null; }
}

/**
 * 获取代币符号 (优先 API -> 链上 -> 缩写)
 */
async function getSymbolFromMint(connection: Connection, mintAddress: string): Promise<string> {
    if (tokenMetadataCache.has(mintAddress)) return tokenMetadataCache.get(mintAddress)!;
    
    // 默认显示缩写，作为保底
    const shortName = `${mintAddress.slice(0, 4)}..${mintAddress.slice(-4)}`;
    
    // 1. 优先尝试 DexScreener (数据最干净)
    try {
        const apiSymbol = await fetchFromDexScreener(mintAddress);
        if (apiSymbol) {
            tokenMetadataCache.set(mintAddress, apiSymbol);
            return apiSymbol;
        }
    } catch (e) {}

    // 2. 尝试链上 Metaplex 解析 (针对刚发的新币)
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
            
            // 简单的清洗：如果名字太长或者包含乱码，可能不想显示
            if (symbol && symbol.length < 15) {
                tokenMetadataCache.set(mintAddress, symbol);
                return symbol;
            }
        }
    } catch (e) {}

    // 3. 实在不行，返回缩写，但因为我们现在会显示 CA，所以缩写也无所谓
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
    const envRpc = process.env.SOLANA_RPC_ENDPOINT;
    if (envRpc) return envRpc;
    for (const endpoint of PUBLIC_RPC_ENDPOINTS) {
        try {
            const conn = new Connection(endpoint, { fetch: customFetch as any });
            const v = await conn.getVersion();
            console.log(`[连接] 成功: ${endpoint} (v${v['solana-core']})`);
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

// ==================== 5. 交易解析逻辑 ====================

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
    try {
        let signatures = await connection.getSignaturesForAddress(pubKey, { limit: 3 });
        if (signatures.length === 0) {
            await sleep(2000);
            signatures = await connection.getSignaturesForAddress(pubKey, { limit: 3 });
        }
        if (signatures.length === 0) return null;
        
        const validSig = signatures.find(s => !s.err);
        if (!validSig) return null;
        const sig = validSig.signature;
        
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

        // --- 逻辑分支 ---
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
                                console.log(`   CA: ${details.tokenMint}`); // <--- 新增 CA 显示
                                console.log(`   金额: ${solInfo}`);
                                console.log(`   TX: https://solscan.io/tx/${details.signature}`);
                            }
                        } else {
                            if (Math.abs(diffSol) > 0.01) {
                                const action = diffSol > 0 ? "💰 余额增加" : "💸 余额减少";
                                console.log('----------------------------------------');
                                console.log(`[${time}] ${action} | ${nameDisplay}`);
                                console.log(`   金额: ${diffSol > 0 ? '+' : ''}${diffSol.toFixed(4)} SOL (延迟,未索引到交易)`);
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
        console.log('   Solana 巨鲸监控系统 (V12 CA增强版)');
        console.log('========================================');
        startPolling(connection, wallets).catch(console.error);
    } catch (e) {
        console.error('启动失败:', e);
    }
}

main();