`node probe.mjs`

## 问什么

两个 home 装入的三个插件是否运行、依赖满足、设置分开且重载后任务记录仍在？

## 怎么运行

Node.js 24，零第三方依赖，两端工作台运行。只读两个 home 的 index、插件状态、QQ 状态和显式列出的普通设置；不读出凭据，不写任务，不触碰笔记。

## 结论

输出在 runs；断言三个插件 ACTIVE、unmetPeers 为空，保存重载后的任务回报状态与每端实际配置供核对。

## 运行那次的环境

2026-10-06，Windows，Node.js 24。安装包精确版本和 file spec 写入每次原始结果；被测源码基线与快照 hash 写入 input/versions.json。
