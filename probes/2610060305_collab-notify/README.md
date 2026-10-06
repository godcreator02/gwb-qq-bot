`node probe.mjs`

## 问什么

协作站检查结论适配器能否调用真实 QQ 主人通知，重载与重复通知是否去重？

## 怎么运行

Node.js 24，零第三方依赖。input 保存被测模块独立快照与模拟 MR 数据；运行中的隔离 home qqbotb-2610052319 已配置 QQ 主人。mcp.mjs 只在本地读取该 home 自己的凭据，不打印。会发一条明确标记为模拟 MR 的 QQ 私聊；不会操作 Gitea 或真实仓库。

## 结论

运行记录写入 runs。断言通知送达、适配器重载不再次调用、相同通知 id 重交得到 delivered=true 与 duplicate=true。此实验不覆盖真实 Gitea webhook 到检查器的上游链路。

## 运行那次的环境

2026-10-06，Windows，Node.js 24。被测 collab 模块为本轮源码的冻结 ESM，hash 记录在运行输出；基线 commit 与安装版本另存 input/versions.json。不依赖仓库 node_modules。
