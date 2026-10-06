`node probe.mjs inspect`

## 问什么

QQ 自有回报凭证能否经 ZCode 与 Claude Code 两个独立插件直接回到原群，切换执行端后保留项目来源而创建新会话？

## 怎么运行

在本目录执行首行只读命令。零 npm 依赖，Node 24+。目标现场为 qqbotb-2610052319，两套机器人与对应原生执行端须可用；凭据从各自 home 本地读取，不写输出。
input/ 固定目标和已实测的群提及标识，并保存三个开发包 tgz，可在相同 home 依赖环境重新安装后复验；不依赖本仓源码或 node_modules。

`node probe.mjs bind` 通过 A 发送群 @ 帮助，让 B 观察来源并绑定用户指定的“混合型 MMC 样机”。
`node probe.mjs run zcode` 或 `node probe.mjs run claudecode` 切换本群执行端，A 发送一次无害任务，B 收到后要求执行端只调用本轮 qq-bot.report，禁止读写项目文件和其他外发。
观察器按 fs.watch 事件读取落盘结果，最长等 240 秒；没有定时查询原生任务。失败只保存现场，不自动重派。

## 结论

尚待 runs/ 的实际结果。构建、安装、回报存盘与 QQ 送达分别记录，不能把进程启动当作完成。

## 运行那次的环境

2026-10-06，Windows，Node v24.14.1。QQ 基线 98c25f5d44b31e8802d3ba035fe4e3354e1288f7；agent 仓沿用 ZCode 基线 4ecbe6b938bf8463fdd9c6dd0095421332af5c34，均带本轮未提交实现，input/ 开发包固定实际被测代码。外部 QQ 权限与本机登录可能随时间变化。
