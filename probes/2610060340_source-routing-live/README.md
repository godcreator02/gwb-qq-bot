`node probe.mjs verify`

## 问什么

升级后的两个机器人，能否保存旧任务、隔离真实来源，并将群任务派给用户选择的协作项目后通过回报发回原群？

## 怎么运行

在本目录执行首行命令。零 npm 依赖，需要 Node 24+、两套 home 正在运行、QQ 已配置。`inspect` 模式只保存快照；`verify` 还断言版本、ACTIVE、依赖、连接、群项目绑定、迁移备份和旧任务不复用。每次输出新增到 runs/，不覆盖基线。mcp.mjs 从对应 home 读取本机 MCP 凭据，不输出明文。

`node probe.mjs bind` 对 input/targets.json 保存的两个真实群来源执行 qq-bot.bind；项目必须先登记在各自 home 的 collab.projects，脚本不猜来源，不改项目文件。此写入模式基于用户已明确选择「混合型 MMC 样机」。B 的项目登记回执在 runs/home-b-project-setup.json，凭据经本机 credentials.copy 配置，文件只记状态。

`node live-message.mjs A`、`node live-message.mjs B` 分别发送真实 QQ 群 @ 任务。只要求读取后附来源信息并调用指定 MCP 的 zcode.report，不读写项目文件。观察器通过 fs.watch 合并账本变更事件，等正文标记及 delivered，再检查真实 home/AppID/群/project/workspace；不调用 zcode.status。api.mjs 是本目录独立 QQ API 辅助代码，凭据只在本机使用，输出脱敏。写入与真实发送仅用于已授权的这两套测试机器人。

## 结论

两次真实链路通过：A→B 见 runs/2026-10-05T194320-345Z.json，B→A 见 runs/2026-10-05T194355-861Z.json，均识别 scene=group、title=混合型 MMC 样机并送回原群。最终两端 0.2.1-dev.20261006034218、网关 open、插件 ACTIVE、无 unmetPeers；v1 备份及原 1/2 条任务记录完整保留，来源会话不复用旧 taskId，见 runs/2026-10-05T194449-123Z-verify.json。多群与个人私聊的隔离由另一独立离线实验验证，本目录不把单群双 bot 实测外推成多真实群的验收。

## 运行那次的环境

2026-10-06，Windows，Node v24.14.1，源码基线 98c25f5d44b31e8802d3ba035fe4e3354e1288f7 + 本轮来源隔离工作区改动；完整安装证据在 runs/dev-build.json。default 与 qqbotb-2610052319；实际身份和 AppID 在 input/targets.json，跨应用映射在 input/peer-ids.json。群笔记库未指定。运行依赖本机账户权限和平台投递，未来环境变化可能改变实测结果；脚本本身不依赖仓的源码或依赖树。
