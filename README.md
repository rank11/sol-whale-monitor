Markdown

# 🐳 Solana Smart Money Monitor (V18 Enterprise)
# Solana 巨鲸/聪明钱监控系统 (V18 企业级热更新版)

[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Runtime-Node.js-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[English]**
A professional-grade Solana blockchain monitor designed to track "Smart Money" and "Whales" in real-time.
Features include **Hot-Reloading** (update wallets without restarting), **Telegram Alerts** with rich HTML formatting, **Anti-Spam Filtering**, **RugCheck Integration**, and **Automated Affiliate Linking** (Axiom/GMGN) for monetization.

**[中文]**
这是一个企业级的 Solana 链上监控系统，专为捕捉“聪明钱”和“巨鲸”动向而生。
核心功能包括 **配置热更新**（无需重启即可更新监控名单）、**Telegram 自动报警**（精美排版）、**垃圾交易过滤**、**RugCheck 安全评分直显**，以及 **自动引流变现**（集成 Axiom/GMGN 专属邀请链接）。

---

## ✨ Key Features (核心功能)

* **⚡ Zero-Downtime Hot Reload (热更新)**:
    * Monitor `wallets.json` changes in real-time. Add/remove wallets instantly without restarting the script.
    * 实时监听 `wallets.json` 文件，修改名单后立即生效，无需重启脚本，确保不错过任何交易。
* **📱 Smart Telegram Alerts (智能推送)**:
    * Sends formatted alerts with Token Info, MC, Price, and **RugCheck Risk Score**.
    * 发送包含代币信息、市值、价格及 **RugCheck 安全评分** 的精美 HTML 消息。
* **💰 Monetization Ready (引流变现)**:
    * Auto-appends your referral codes (`ref`/`invite`) to GMGN, Axiom, and Photon links.
    * 所有推送链接自动携带你的专属邀请码，流量直接变现。
* **🛡️ Anti-Spam & Risk Filter (防噪风控)**:
    * Filters out small transactions (`< 0.5 SOL`) and spam token transfers.
    * 自动过滤小额转账（如 `< 0.5 SOL`）和无意义的垃圾交互。
* **🤖 Production Ready (生产级部署)**:
    * Supports PM2 process management for 24/7 uptime.
    * 支持 PM2 进程守护，实现 7x24 小时无人值守运行。

---

## 🛠️ Environment Setup (环境配置)

### 1. Prerequisites (前置要求)
* **Node.js**: `v16.0.0` or higher (建议 v18+).
* **RPC Provider**: A private RPC key from [Helius](https://helius.dev) or [Alchemy](https://alchemy.com).
    * *Note: Free tiers are sufficient for testing; standard tiers recommended for production.*
* **Network Proxy**: Required if you are in a region where Telegram/RPC is blocked (e.g., Clash at port 7890).

### 2. Installation (安装步骤)

```bash
# 1. Clone the repository (克隆项目)
git clone [https://github.com/your-repo/sol-whale-monitor.git](https://github.com/your-repo/sol-whale-monitor.git)

# 2. Enter the directory (进入目录)
cd sol-whale-monitor

# 3. Install dependencies (安装依赖包)
# This installs web3.js, telegram-bot-api, etc.
npm install

# 4. Install PM2 globally (全局安装 PM2 进程守护工具)
# Required for 24/7 background running.
npm install pm2 -g
⚙️ Configuration (详细配置)
1. System Config (src/monitor.ts)
Open src/monitor.ts and update the top section: 打开 src/monitor.ts 顶部，修改以下关键参数：

TypeScript

// [RPC] Private Node Key (Alchemy is recommended for high TPS)
// 推荐使用 Alchemy 以支持 1秒/次 的高频轮询
const CUSTOM_RPC_URL = '[https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY](https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY)';

// [Telegram] Bot Credentials
// 获取方式: @BotFather -> /newbot
const TG_BOT_TOKEN = '123456:ABC-DEF...'; 
// 获取方式: @userinfobot -> ID field
const TG_CHAT_ID = '123456789';      

// [Filters] Minimum SOL amount to trigger alert
// 最小推送金额：低于 0.5 SOL 的交易将被忽略，防止刷屏
const MIN_SOL_THRESHOLD = 0.5; 

// [Affiliate] Your Invite Codes
// 你的引流邀请码
const REF_CONFIG = {
    gmgn: 'rank1143',
    axiom: 'rank1143'
};

// [Network] Proxy Address (e.g., Clash uses 7890)
// 代理地址，解决国内连不上 TG 的问题
const PROXY_URL = '[http://127.0.0.1:7890](http://127.0.0.1:7890)'; 
2. Wallet List (wallets.json)
Create or edit wallets.json in the root directory: 在根目录创建或编辑 wallets.json：

JSON

[
  {
    "address": "GjXobpiEexQqqLkghB29AtcwyJRokbeGDSkz8Kn7GGr1",
    "name": "Smart Money 01",
    "emoji": "👻"
  },
  {
    "address": "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
    "name": "Alpha Hunter",
    "emoji": "⚔️"
  }
]
🚀 Usage Instructions (指令操作注解)
Mode 1: Development (开发/调试模式)
Use this mode to see logs in your terminal instantly. 此模式适合调试，日志会直接打印在终端窗口，关闭窗口即停止。

Bash

# Start the monitor using ts-node
# 使用 ts-node 直接启动监控
npm start
Mode 2: Production (生产/后台模式)
Recommended! Use PM2 to keep the script running 24/7 in the background. 强烈推荐！ 使用 PM2 让脚本在后台永久运行，即使关闭终端或服务器重启也能自动恢复。

Bash

# 1. Start the process (启动后台进程)
# --interpreter specifies using ts-node to run TypeScript directly
pm2 start src/monitor.ts --interpreter ./node_modules/.bin/ts-node --name "sol-monitor"

# 2. View logs (查看实时日志)
# Check if everything is running correctly
pm2 logs

# 3. Monitor status (查看进程状态)
# View CPU and Memory usage
pm2 monit

# 4. Stop the process (停止监控)
pm2 stop sol-monitor

# 5. Restart the process (重启监控)
pm2 restart sol-monitor
🔄 How Hot Reload Works (热更新说明)
Keep the script running (via npm start or pm2). 保持脚本运行。

Open wallets.json and add a new wallet address. 打开 wallets.json 并添加一个新的钱包地址。

Save the file (Ctrl+S). 保存文件。

The system will detect the change and reload automatically: 系统会自动检测到文件变化并重新加载：

[System] Config file changed. Reloading... [System] Reload success! Monitoring 360 wallets.

❓ FAQ (常见问题)
Q: ECONNRESET or FetchError? A: Usually a proxy issue. Check if your Clash/V2Ray is running and the port in monitor.ts matches (7890). A: 通常是代理问题。请检查梯子是否开启，以及代码里的端口 (7890) 是否正确。

Q: 400 Bad Request: chat not found? A: You must send /start to your bot in Telegram first to authorize it. A: 你必须先在 Telegram 里给你的机器人发送 /start，否则机器人没有权限给你发消息。

Q: Logs show "Unknown Token"? A: Extremely new tokens might not be indexed by DexScreener yet. The script will still show the CA for you to check manually. A: 极早期的土狗盘可能还没被 DexScreener 收录。脚本会直接显示合约地址 (CA) 供你手动查询。

⚠️ Disclaimer (免责声明)
This tool is for educational and research purposes only. Cryptocurrency trading involves high risk. 本项目仅供学习和研究使用。加密货币投资风险极高，请自行把控风险。