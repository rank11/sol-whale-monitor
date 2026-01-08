import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
import TelegramBot from 'node-telegram-bot-api';

/**
 * Solana 巨鲸监控系统 (V17 Telegram 自动推送版)
 * * 核心升级：
 * 1. [通知] 集成 Telegram Bot，自动推送精美排版的交易信号。
 * 2. [过滤] 仅推送 Swap 和 大额转账，拒绝噪音。
 * 3. [引流] 消息内嵌 Axiom/GMGN 专属邀请链接。
 */

// ==================== 1. 核心配置 (请修改这里) ====================

// [RPC] 你的私有节点 (Alchemy/Helius)
const CUSTOM_RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=你的Key'; 

// [Telegram] 机器人配置
const TG_BOT_TOKEN = '你的Bot_Token填这里'; // 例如: 7123456:AAHy...
const TG_CHAT_ID = '你的Chat_ID填这里';     // 例如: 123456789 或 -100xxxx

// [引流] 邀请码
const REF_CONFIG = {
    gmgn: 'rank1143',
    axiom: 'rank1143'
};

// [网络] 代理配置 (Clash: 7890)
const PROXY_URL = 'http://127.0.0.1:7890'; 
const proxyAgent = new HttpsProxyAgent(PROXY_URL);

const customFetch = (url: string, options: any = {}) => {
    return fetch(url, { ...options, agent: proxyAgent });
};

// ==================== 2. 初始化 Bot ====================
let bot: TelegramBot | null = null;
if (TG_BOT_TOKEN && TG_BOT_TOKEN.length > 10) {
    // 使用代理初始化 Bot，解决国内发不出去的问题
    bot = new TelegramBot(TG_BOT_TOKEN, { 
        polling: false,
        request: { agent: proxyAgent } 
    });
    console.log('[系统] Telegram Bot 已初始化');
}

// 发送 TG 消息函数
async function sendTgMessage(text: string) {
    if (!bot || !TG_CHAT_ID) return;
    try {
        await bot.sendMessage(TG_CHAT_ID, text, { 
            parse_mode: 'HTML', 
            disable_web_page_preview: true 
        });
    } catch (e: any) {
        console.error(`[TG报错] ${e.message}`);
    }
}

// ==================== 3. 代币与安全数据引擎 ====================

interface TokenMarketData {
    symbol: string;
    name: string;
    priceUsd: string;
    fdv: number;       
    liquidity: number; 
    pairAddress: string;
}

interface RugCheckData {
    score: number;
    riskLevel: string; 
    isNew: boolean;    
}

const tokenCache = new Map<string, TokenMarketData>();
const rugCache = new Map<string, RugCheckData>();
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

function formatNumber(num: number): string {
    if (!num) return '$0';
    if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
    if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
}

function formatPrice(priceStr: string): string {
    const price = parseFloat(priceStr);
    if (!price) return '$0';
    if (price < 0.0001) return `$${price.toExponential(2)}`;
    return `$${price.toFixed(6)}`; 
}

async function fetchTokenMarketData(mint: string): Promise<TokenMarketData | null> {
    if (tokenCache.has(mint)) return tokenCache.get(mint)!;
    try {
        const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
        const res = await customFetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.pairs || data.pairs.length === 0) return null;
        const bestPair = data.pairs.sort((a: any, b: any) => b.liquidity.usd - a.liquidity.usd)[0];
        const tokenData: TokenMarketData = {
            symbol: bestPair.baseToken.symbol,
            name: bestPair.baseToken.name,
            priceUsd: bestPair.priceUsd,
            fdv: bestPair.fdv || 0,
            liquidity: bestPair.liquidity?.usd || 0,
            pairAddress: bestPair.pairAddress
        };
        tokenCache.set(mint, tokenData);
        return tokenData;
    } catch (e) { return null; }
}

async function fetchRugCheckData(mint: string): Promise<RugCheckData> {
    if (rugCache.has(mint)) return rugCache.get(mint)!;
    try {
        const url = `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`;
        const res = await customFetch(url);
        if (res.status === 404) return { score: 0, riskLevel: 'unknown', isNew: true };
        if (!res.ok) return { score: 0, riskLevel: 'error', isNew: false };
        const data = await res.json();
        const score = data.score || 0;
        let level = 'good';
        if (score > 2000) level = 'danger';
        else if (score > 500) level = 'warn';
        const result = { score, riskLevel: level, isNew: false };
        rugCache.set(mint, result);
        return result;
    } catch (e) {
        return { score: 0, riskLevel: 'error', isNew: false };
    }
}

// ==================== 4. 基础工具 ====================
async function chooseRpcEndpoint(): Promise<string> {
    if (CUSTOM_RPC_URL && CUSTOM_RPC_URL.length > 20) return CUSTOM_RPC_URL;
    console.warn("⚠️ 未检测到私有节点 Key，使用公共节点可能导致 429 报错...");
    return 'https://api.mainnet-beta.solana.com';
}

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
    tokenData: TokenMarketData | null;
    rugData: RugCheckData | null;
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
    const maxRetries = 5;

    while (attempts < maxRetries) {
        try {
            signatures = await connection.getSignaturesForAddress(pubKey, { limit: 3 });
            if (signatures.length > 0 && !signatures[0].err) break;
        } catch (e) {}
        attempts++;
        if (attempts < maxRetries) await sleep(1000 + (attempts * 500));
    }

    if (signatures.length === 0) return null;
    const sig = signatures[0].signature;

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
            const [tokenData, rugData] = await Promise.all([
                fetchTokenMarketData(targetMint),
                fetchRugCheckData(targetMint)
            ]);

            return {
                signature: sig,
                tokenMint: targetMint,
                tokenData: tokenData,
                rugData: rugData,
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
                tokenData: null,
                rugData: null,
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
                tokenData: null,
                rugData: null,
                tokenChange: wSolDiff,
                solChange: nativeDiff,
                isBuy: wSolDiff > 0,
                type: 'WRAP'
            };
        }

        return {
            signature: sig,
            tokenMint: 'SOL',
            tokenData: null,
            rugData: null,
            tokenChange: totalSolFlow,
            solChange: totalSolFlow,
            isBuy: totalSolFlow > 0,
            type: 'TRANSFER'
        };

    } catch (e) {
        return null;
    }
}

// ==================== 6. 轮询与推送逻辑 ====================

const balanceCache = new Map<string, number>();

function chunkArray<T>(array: T[], size: number): T[][] {
    const res: T[][] = [];
    for (let i = 0; i < array.length; i += size) res.push(array.slice(i, i + size));
    return res;
}

function lamportsToSol(l: number) { return l / 1e9; }
function formatTime() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }

async function startPolling(connection: Connection, wallets: WalletConfig[]) {
    const INTERVAL = 1000; 
    const CHUNK_SIZE = 50;
    
    const chunks = chunkArray(wallets, CHUNK_SIZE);
    console.log(`[系统] 监控 ${wallets.length} 个钱包...`);
    console.log(`[推送] Telegram 推送已开启`);

    console.log('[初始化] 建立余额基准...');
    for (const chunk of chunks) {
        try {
            const infos = await connection.getMultipleAccountsInfo(chunk.map(w => w.publicKey));
            infos.forEach((info, i) => {
                balanceCache.set(chunk[i].address, info ? info.lamports : 0);
            });
            await sleep(100);
        } catch (e) {}
    }
    console.log('[初始化] 完成，开始监控...\n');

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
                    const tasks = updates.map(async (update) => {
                        const { wallet, cur, diffSol } = update;
                        const details = await fetchLastTransactionDetails(connection, wallet.publicKey);
                        const nameDisplay = `${wallet.emoji} ${wallet.name}`;
                        const time = formatTime();
                        
                        if (details) {
                            if (details.type === 'TRANSFER') {
                                // 只有大额转账 (>10 SOL) 才推送到 TG，防止刷屏
                                const isLargeTransfer = Math.abs(details.solChange) > 10;
                                
                                // 控制台正常打印
                                if (Math.abs(details.solChange) > 0.001) {
                                    const action = details.solChange > 0 ? "💰 纯SOL转入" : "💸 纯SOL转出";
                                    const logMsg = `[${time}] ${action} | ${nameDisplay}\n   金额: ${details.solChange.toFixed(4)} SOL`;
                                    console.log(logMsg);

                                    if (isLargeTransfer) {
                                        const tgMsg = `<b>${action}</b> | ${nameDisplay}\n<code>${wallet.address}</code>\n\n💎 <b>金额:</b> ${details.solChange > 0 ? '+' : ''}${details.solChange.toFixed(2)} SOL\n🔗 <a href="https://solscan.io/tx/${details.signature}">Solscan</a>`;
                                        await sendTgMessage(tgMsg);
                                    }
                                }
                            } else if (details.type !== 'WRAP') {
                                // === SWAP 推送 (核心) ===
                                const action = details.isBuy ? "🟢 买入" : "🔴 卖出";
                                const symbol = details.tokenData?.symbol || details.tokenMint.slice(0,4);
                                const tokenChange = `${details.tokenChange > 0 ? '+' : ''}${details.tokenChange.toFixed(2)}`;
                                const solInfo = `${Math.abs(details.solChange).toFixed(4)} SOL`;
                                
                                const price = details.tokenData ? formatPrice(details.tokenData.priceUsd) : 'N/A';
                                const mc = details.tokenData ? formatNumber(details.tokenData.fdv) : 'N/A';
                                
                                let rugEmoji = '⏳';
                                let rugText = '检测中';
                                if (details.rugData) {
                                    if (details.rugData.isNew) { rugEmoji = '🆕'; rugText = '新盘'; }
                                    else {
                                        const s = details.rugData.score;
                                        if (s < 500) { rugEmoji = '✅'; rugText = `安全(${s})`; }
                                        else if (s < 1500) { rugEmoji = '⚠️'; rugText = `警告(${s})`; }
                                        else { rugEmoji = '☠️'; rugText = `危险(${s})`; }
                                    }
                                }

                                // 控制台打印
                                console.log('----------------------------------------');
                                console.log(`[${time}] ${action} | ${nameDisplay}`);
                                console.log(`   代币: ${symbol} (${tokenChange})`);
                                console.log(`   CA: ${details.tokenMint}`);
                                console.log(`   金额: ${solInfo}`);

                                // TG 推送内容构造
                                const gmgnLink = `https://gmgn.ai/sol/token/${details.tokenMint}?ref=${REF_CONFIG.gmgn}`;
                                const axiomLink = `https://axiom.trade/trade/${details.tokenMint}?invite=${REF_CONFIG.axiom}`;
                                const rugLink = `https://rugcheck.xyz/tokens/${details.tokenMint}`;

                                const tgMsg = `
${action === "🟢 买入" ? "🟢 <b>Smart Money Buy!</b>" : "🔴 <b>Smart Money Sell!</b>"}
👻 <b>Wallet:</b> ${nameDisplay}
<code>${wallet.address}</code>

💊 <b>Token:</b> ${symbol}
📊 <b>Amt:</b> ${tokenChange}
💰 <b>Cost:</b> ${solInfo}
💲 <b>Price:</b> ${price} | <b>MC:</b> ${mc}
🛡️ <b>Risk:</b> ${rugEmoji} ${rugText}

🎯 <b>CA:</b> <code>${details.tokenMint}</code>

🛠️ <b>Quick Links:</b>
<a href="${gmgnLink}">GMGN</a> | <a href="${axiomLink}">Axiom</a> | <a href="${rugLink}">RugCheck</a>
`;
                                await sendTgMessage(tgMsg);
                            }
                        }
                    });
                    await Promise.all(tasks);
                }
            } catch (e) {
                console.error(e);
            }
            await sleep(50); 
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
        console.log('   Solana 巨鲸监控 (V17 TG推送版)');
        console.log('========================================');
        
        startPolling(connection, wallets).catch(console.error);
    } catch (e) {
        console.error('启动失败:', e);
    }
}

main();