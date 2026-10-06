`node probe.mjs A`（反方向运行 `node probe.mjs B`）

## 问什么

QQ 群自然语言任务能否经目标 home 的 MCP 主动回报，并立即发送结果，不再等待定时查询？

## 怎么运行

Node.js 24，零第三方依赖。两端只接收 @；本目录 input 固定了按应用和群区分的目标标识。按目标 home 读取本地凭据，凭据不进入输出。ZCode 桌面端需运行，MCP 配置包含 gwb 和 gwb_botb。测试只允许调用结果回报工具，不改文件。

脚本监听接收方任务文件的原子更新，最长 180 秒；仅发送 HTTP 成功不算通过，必须看到真实回报正文和 delivered 状态。runs 保留每次输出。

## 结论

A → B、B → A 各一轮成功：ZCode 调对应 home 的 zcode.report，结果都为 delivered。原始成功记录为 runs/2026-10-05T184922-056Z.json 与 runs/2026-10-05T185000-115Z.json。早期实验观察器抢读原子更新文件导致 Windows EPERM，失败原文保留在 runs/01-file-observer-failures.txt；修正为文件事件触发、300 ms 合并事件后先查询内存状态再读盘。没有把发送 HTTP 成功当作链路通过。

## 运行那次的环境

2026-10-06，Windows，Node.js 24。QQ 基线 98c25f5d44b31e8802d3ba035fe4e3354e1288f7 加本轮改动；安装版号与源码快照保存在 input/versions.json 及同目录；原始结果见 runs。
