🐳 Solana 巨鲸监控系统 (V12 增强版)
这是一个专为监控大量 Solana 钱包（如“聪明钱”或“巨鲸”）而设计的高级监控系统。

相比于传统的 WebSocket 监控，本项目针对**公共节点（Public RPC）**进行了深度优化，能够同时稳定监控数百个钱包而不触发 429 Too Many Requests 限流，并且内置了强大的交易解析引擎，能够精准识别代币名称、合约地址（CA）以及具体的买卖行为。

✨ 核心特性
🛡️ 独家抗 429 机制：抛弃传统的 WebSocket 长连接，采用分组批量轮询 (Batch Polling) + 队列处理策略。实测可使用免费公共节点稳定监控 300+ 个钱包。

🌐 内置代理支持：原生集成 https-proxy-agent，完美解决国内网络环境下的 fetch failed 问题，直连 Solana RPC 和 DexScreener API。

🧠 智能交易解析：

上帝视角：通过解析 Transaction Log，精准区分 Swap (买卖)、Transfer (转账) 和 Wrap (SOL打包)。

精准计费：自动合并 Native SOL 和 wSOL 的变动，防止因 wSOL 转换导致的“0 金额”误报。

💎 代币深度识别：

多重数据源：优先使用 DexScreener API 获取准确的代币名称（如 Pnut, ChillGuy），链上 Metadata 作为备选。

名称清洗：自动过滤链上乱码、日文或特殊符号，强制显示标准 Ticker。

CA 直显：每笔交易强制显示代币合约地址 (CA)，方便直接复制去看线。

🔄 防漏单重试：内置“回马枪”机制，如果余额变动但 RPC 尚未索引交易详情，会自动暂停重试，大幅降低漏单率。

🛠️ 技术栈
Runtime: Node.js & TypeScript

Solana SDK: @solana/web3.js

Network: node-fetch + https-proxy-agent (代理增强)

API: DexScreener (元数据补全)

🚀 快速开始
1. 环境准备
确保你已安装 Node.js，并拥有一个可用的代理工具（如 Clash 或 v2ray）。

2. 安装依赖
Bash

npm install
或者手动安装核心库：

Bash

npm install @solana/web3.js https-proxy-agent node-fetch
npm install --save-dev typescript ts-node @types/node
3. 配置代理 (至关重要)
打开 src/monitor.ts，找到顶部配置区域，填入你的本地代理端口：

TypeScript

// Clash 通常是 7890，v2ray 通常是 10808
const PROXY_URL = 'http://127.0.0.1:7890'; 
4. 配置监控钱包
在项目根目录创建或修改 wallets.json 文件。格式如下：

JSON

[
  {
    "address": "GjXobpiEexQqqLkghB29AtcwyJRokbeGDSkz8Kn7GGr1",
    "name": "聪明钱-1号",
    "emoji": "👻"
  },
  {
    "address": "DxM1hfY8FQ8dNGrucuJzhJcF8KRbjk8WBwrgKvQ9spPv",
    "name": "巨鲸-KOL",
    "emoji": "🐋"
  }
]
💡 小贴士：如果你有大量原始格式的数据，可以使用项目附带的 fix_wallets.py 脚本自动转换并清洗格式。

5. 启动监控
Bash

npm start
📊 输出示例
系统启动后，你将看到如下清晰的日志：

Plaintext

========================================
   Solana 巨鲸监控系统 (V12 CA增强版)
========================================
[系统] 监控 359 个钱包，分 8 组轮询...
[初始化] 建立余额基准...
[初始化] 完成，开始监控交易...

----------------------------------------
[19:25:43] 🟢 买入 | 👻 Miku榜一
   代币: Pnut (+1000.00)
   CA: 8wXt...pump
   金额: 1.0724 SOL
   TX: https://solscan.io/tx/2TU...
----------------------------------------
[19:28:10] 💸 纯SOL转出 | 🐋 交易所提现
   金额: -50.0000 SOL
   TX: https://solscan.io/tx/5pq...
----------------------------------------
[19:30:05] 🔴 卖出 | 👻 土狗猎手
   代币: ChillGuy (-50000.00)
   CA: DF5x...pump
   金额: 3.5200 SOL
   TX: https://solscan.io/tx/33W...
⚠️ 常见问题
1. 为什么显示 Error: fetch failed？
原因：Node.js 无法连接到 Solana 节点或 DexScreener API。 解决：请检查 src/monitor.ts 中的 PROXY_URL 是否与你的梯子端口一致（Clash 默认为 7890）。

2. 为什么有时候显示“未索引到交易”？
原因：Solana 公共节点的某些 API 存在延迟，余额变了但交易记录还没同步。 解决：V12 版本已内置重试机制，会自动等待 2 秒后再次查询。如果依然失败，说明节点延迟极高，建议稍后由系统自动恢复。

3. 如何监控几百个钱包不报错？
原理：本系统将钱包分为 50 个一组，每组之间强制休眠 0.2~0.5 秒，且在检测到交易详情时使用“单线程队列”排队查询。这是为了适应免费公共节点的速率限制（Rate Limits）。

📂 项目结构
sol-whale-monitor/
├── src/
│   └── monitor.ts          # V12 核心监控代码
├── scripts/
│   └── fix_wallets.py      # (可选) 钱包数据清洗脚本
├── wallets.json            # 钱包配置文件
├── package.json
└── README.md
🤝 贡献与许可
MIT License. 仅供学习研究使用，请勿用于非法用途。