`node probe.mjs A`

## 问什么

QQ 群自然语言“记一下”能否经 ZCode 写进隔离 home 的 notes 日志，再主动回报？

## 怎么运行

Node.js 24，零第三方依赖。本目录自带 QQ / MCP 客户端与固定目标输入。只在 qqbotb-2610052319 的测试笔记库创建一条带唯一标记的记录；不在 default 的真实笔记库造测试数据。

## 结论

成功：真实 QQ 入站、ZCode 回报 delivered、日志读回一条。原始结果 runs/2026-10-05T185324-392Z.json；追加只读核对命令 node verify-readback.mjs 确认标记恰好出现 1 次，块 id 20261006025317-pgs0rlx 与回报一致。未在 default 笔记库写测试数据。

## 运行那次的环境

2026-10-06，Windows，Node.js 24；QQ 基线 98c25f5d44b31e8802d3ba035fe4e3354e1288f7 加主动回报实现。具体版本、块标识、原始输出保存在 runs。
