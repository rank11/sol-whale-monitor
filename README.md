🐳 Solana 巨鲸监控系统 (V13 极速死磕版)
这是一个专为高频监控 Solana 链上“聪明钱”和“巨鲸”地址设计的专业级监控系统。

V13 版本针对 实时性 和 数据准确性 进行了极致优化。它不仅能以秒级频率轮询数百个钱包，还内置了强大的交易解析引擎，能够精准识别 Swap、转账、以及 wSOL 包装行为，彻底解决了“0 金额误报”和“代币名称乱码”等痛点。

✨ 核心特性 (V13 升级)
⚡ 1秒极速轮询：采用批量并发轮询机制，支持对 300+ 个钱包进行秒级监控，几乎零延迟捕捉链上动向。

🛡️ 死磕防漏机制：内置指数级重试逻辑。如果余额变动但 RPC 尚未索引到交易详情，系统会连续重试 5 次（死磕模式），确保不漏掉任何一笔交易。

🧠 智能交易解析：

上帝视角：通过解析 Transaction Log 精准区分 Swap (买卖)、Transfer (转账) 和 Wrap (SOL打包)。

精准计费：自动合并 Native SOL 和 wSOL 的变动，彻底修复 "0.0000 SOL" 误报 bug。

CA 直显：每笔交易强制显示代币合约地址 (CA)，方便直接复制去看线。

💎 代币深度识别：优先调用 DexScreener API 获取准确的代币名称（如 Pnut, ChillGuy），自动清洗链上乱码。

🌐 内置代理支持：原生集成 https-proxy-agent，直连 Solana RPC 和 DexScreener API，解决网络连接问题。

🛠️ 技术栈
Runtime: Node.js & TypeScript

Solana SDK: @solana/web3.js

Network: node-fetch + https-proxy-agent

RPC: 支持 Helius, Alchemy, QuickNode 等私有节点

🚀 快速开始
1. 环境准备
Node.js (v16+)

npm 或 yarn

科学上网环境 (Clash/V2Ray 等)

2. 安装依赖
Bash

npm install
3. 关键配置 (必读⚠️)
打开 src/monitor.ts 文件顶部，修改以下两处配置：

A. 配置 RPC 节点 (决定速度) 为了实现 1秒 轮询，强烈建议使用 Helius 或 Alchemy 的免费私有节点。公共节点极大概率会漏单或报错。

TypeScript

// 在 src/monitor.ts 第 18 行左右
const CUSTOM_RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=你的API_KEY';
B. 配置代理 (解决网络报错) 根据你的梯子软件端口修改：

TypeScript

// 在 src/monitor.ts 第 21 行左右
const PROXY_URL = 'http://127.0.0.1:7890'; // Clash通常是7890，v2ray通常是10808
4. 准备钱包数据
在项目根目录创建 wallets.json。 如果你有大量格式混乱的原始数据，可以使用项目自带的修复脚本：

新建 wallets.json，把你的原始数据粘贴进去（哪怕格式不对）。

运行修复脚本：

Bash

python3 fix_wallets.py
脚本会自动清洗数据、补全名字并生成标准的 wallets.json。

5. 启动监控
Bash

npm start
📊 输出示例
启动后，你将看到如下清晰的日志：

Plaintext

========================================
   Solana 巨鲸监控系统 (V13 极速版)
========================================
[系统] 监控 359 个钱包，分 8 组轮询...
[极速模式] 轮询间隔: 1000ms (注意流量消耗)
...

----------------------------------------
[19:25:43] 🟢 买入 | 👻 聪明钱-01
   代币: Pnut (+1000.00)
   CA: 8wXt...pump  <-- 直接复制这个CA
   金额: 1.0724 SOL
   TX: https://solscan.io/tx/2TU...
----------------------------------------
[19:28:10] 💸 纯SOL转出 | 🐋 交易所提现
   金额: -50.0000 SOL
   TX: https://solscan.io/tx/5pq...
⚠️ 流量消耗预警
当前代码默认开启 1000ms (1秒) 轮询频率。对于 359 个钱包：

每日消耗：约 700,000 (70万) 积分/请求数。

Helius 免费版：额度 100万/月 -> 仅够跑 1.5 天。

Alchemy 免费版：额度 3亿/月 -> 随便跑，永不枯竭。

建议：如果你使用 Helius，请在 src/monitor.ts 底部将 INTERVAL 改为 30000 (30秒)；如果你申请到了 Alchemy，保持 1秒 即可。

📂 项目结构
sol-whale-monitor/
├── src/
│   └── monitor.ts          # V13 核心监控代码
├── fix_wallets.py          # 钱包数据清洗脚本 (Python)
├── wallets.json            # 监控目标配置文件
├── package.json
└── tsconfig.json
常见问题 (FAQ)
Q: 为什么显示 "余额增加... (延迟,未索引到交易)"？ A: 这是因为你轮询速度太快（1秒），RPC 节点还没来得及把那笔交易存入数据库。V13 版本会自动重试 5 次（耗时约 15秒），如果 5 次后还查不到，就会显示这条兜底日志，确保你知道钱动了。

Q: 为什么有些代币名字还是显示未知？ A: 对于刚刚发射几秒钟的土狗盘，DexScreener 和链上 Metadata 可能都还没生成。此时系统会优先显示 未知代币 并提供 CA，你可以直接复制 CA 去看线。

Q: 报错 fetch failed 或 Socket Error？ A: 99% 是代理没配置好。请检查 src/monitor.ts 里的 PROXY_URL 端口是否正确。

Disclaimer: 本工具仅供学习与研究使用，加密货币投资风险巨大，请自行把控风险。