🐳 Solana 巨鲸/聪明钱监控系统 (V17 引流版)
Solana Smart Money Monitor V17 - Telegram Alert & Affiliate Edition

这是一个企业级的 Solana 链上监控系统，专为捕捉“聪明钱”和“内幕钱包”动向而生。它不仅是一个监控脚本，更是一个自动化的 Alpha 信号生成器。

V17 版本集成了 Telegram 自动推送、RugCheck 安全评分以及自定义邀请链接，非常适合用于运营付费信号群或个人快速跟单。

🔥 核心优势
⚡ 毫秒级极速捕捉：支持 Alchemy/Helius 节点 1秒/轮 的超高频轮询，几乎与链上同步。

📱 Telegram 自动报警：

自动推送精排版的 HTML 消息到频道或私聊。

消息包含代币信息、价格市值、安全评分及一键跟单链接。

💰 商业变现/引流：

Axiom / GMGN 定制：所有推送链接自动携带你的专属邀请码（ref / invite），流量直接变现。

Axiom 直达：集成 Axiom Trade 专业交易终端链接。

🛡️ 风险过滤引擎：

RugCheck 直显：直接调用 API 显示代币安全分（✅安全 / ⚠️警告 / ☠️危险），无需人工查验。

去噪逻辑：自动过滤 wSOL 打包、小额 Gas 费转账，只推送 Swap 买卖和大额转账。

🧠 智能解析内核：

上帝视角：通过 Transaction Log 精准识别 Jupiter/Raydium/Pump.fun 的交易行为。

CA 直显：每笔交易强制附带合约地址，方便复制。

🛠️ 技术栈
核心语言: TypeScript / Node.js

区块链交互: @solana/web3.js

消息推送: node-telegram-bot-api

数据源: Helius/Alchemy (RPC), DexScreener (价格), RugCheck (安全)

网络增强: https-proxy-agent (支持代理直连)

🚀 快速部署指南
1. 安装依赖
确保 Node.js 版本 >= 16。

Bash

# 安装核心依赖
npm install

# 确保安装了 Telegram SDK 和类型定义
npm install node-telegram-bot-api
npm install --save-dev @types/node-telegram-bot-api
2. 配置文件 (src/monitor.ts)
打开 src/monitor.ts 顶部，填入你的配置信息：

TypeScript

// 1. RPC 节点 (强烈建议使用 Alchemy 免费版以支持 1秒轮询)
const CUSTOM_RPC_URL = 'https://solana-mainnet.g.alchemy.com/v2/你的API_KEY';

// 2. Telegram 机器人配置
const TG_BOT_TOKEN = '123456:ABC-DEF...'; // 找 @BotFather 获取
const TG_CHAT_ID = '-100xxxxxx';          // 你的频道或群组 ID

// 3. 引流/邀请码配置 (修改为你自己的)
const REF_CONFIG = {
    gmgn: 'rank1143',  // 你的 GMGN 邀请码
    axiom: 'rank1143'  // 你的 Axiom 邀请码
};

// 4. 网络代理 (解决国内无法连接 TG/RPC 问题)
const PROXY_URL = 'http://127.0.0.1:7890';
3. 导入钱包数据
在项目根目录创建 wallets.json。格式如下：

JSON

[
  {
    "address": "GjXobpiEexQqqLkghB29AtcwyJRokbeGDSkz8Kn7GGr1",
    "name": "聪明钱-01",
    "emoji": "👻"
  }
]
提示：如果你有大量原始数据，请使用 python3 fix_wallets.py 脚本自动清洗和格式化。

4. 启动系统
Bash

npm start
📱 推送效果预览 (Telegram)
当监控到买入信号时，你的频道将收到如下消息：

🟢 Smart Money Buy! 👻 Wallet: 聪明钱-KOL GjXo...GGr1

💊 Token: Pnut 📊 Amt: +5000.00 💰 Cost: 2.50 SOL 💲 Price: $0.0012 | MC: $1.2M 🛡️ Risk: ✅ 安全(120)

🎯 CA: 8wXt...pump (点击复制)

🛠️ Quick Links: [GMGN] | [Axiom] | [RugCheck] (链接已自动绑定你的邀请码)

⚠️ 流量与成本控制
本系统默认开启 极速模式 (1秒/次)。

Alchemy 用户：免费版每月 3亿 CU，完全足够跑 1秒轮询，建议使用 Alchemy。

Helius 用户：免费版每月 100万 Credits。请务必将代码底部的 INTERVAL 改为 30000 (30秒)，否则额度将在 2 天内耗尽。

📂 项目结构
Plaintext

sol-whale-monitor/
├── src/
│   └── monitor.ts          # V17 核心主程序
├── scripts/
│   └── fix_wallets.py      # 钱包数据清洗工具
├── wallets.json            # 监控名单
├── package.json
└── README.md
🤝 贡献与免责声明
本项目仅供学习和区块链数据分析研究使用。

加密货币投资风险极高，工具提供的安全评分仅供参考，不构成投资建议。

License: MIT

Happy Hunting! 🐳