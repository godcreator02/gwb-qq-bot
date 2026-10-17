# 把 QQ 接入同一个 Agent 会话：Claude Code、Codex、ZCode 三家的渠道能力调研

复现：照 `report.md` 每段末尾列的官方文档与源码链接重新核对一遍（核查日期 2026-10-11；本机部分是 `codex --help` 等只读命令的输出）。没有做真实的 QQ 收发测试。

问的是：能不能让 QQ 私聊和电脑上的同一个 agent 会话共用一份上下文，agent 正常回答就自动回到 QQ，不用 agent 自己调命令回报。

| 文件 | 内容 |
| --- | --- |
| `report.md` | 结论与三家对比表 |
| `notes/claude.md` | Claude Code：Channels 协议、开发渠道的启动限制、Agent SDK、Remote Control |
| `notes/codex.md` | Codex：App Server 的会话与回答事件、`--remote` 共用一个服务 |
| `notes/zcode.md` | ZCode：内置 Bot Channel 与 Remote Control，没找到第三方自定义渠道的注册接口 |

这份调研原先放在 `b2o8l-sst-mmc-2026` 单元根上的 `reports/` 与 `research_notes/`，和 SST 项目无关，2026-10-17 挪进本仓。
