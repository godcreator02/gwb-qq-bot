# ZCode 自定义渠道与已有会话接入

核查日期：2026-10-11（Asia/Shanghai）。只读研究与本文件写入；未启动 agent、未发消息、未安装插件、未验证真实 QQ 收发。

## 已有桌面会话能否直接从聊天渠道继续？

### Takeaway
可以。官方 Bot Channel 与 Remote Control 的定位就是继续操作桌面端已有会话；这项产品能力已有明确文档。它不能单独证明第三方可以注册 QQ 渠道。

### Cited Findings
- 官方 Bot Channel 文档明确说明两种入口操作桌面已有会话、执行环境仍沿用桌面工作区；Bot 面向长期回访，可发消息、查看进度，管理工作区访问范围。其配置流程列微信与飞书，后续计划列钉钉、Discord、企业微信。— [Bot Channel](https://zcode.z.ai/cn/docs/bot-channel)
- Remote Control 让手机选择当前桌面窗口里的工作区、任务与会话，读取执行过程并继续输入；桌面端须运行联网。— [Remote Control](https://zcode.z.ai/cn/docs/remote-control)
- 官方首页另列 Telegram，和 Bot Channel 使用文档支持名单不完全一致；QQ 在本次检查的这些官方渠道页面中未列出。— [官网首页](https://zcode.z.ai/cn)
- 当前公开更新页最新条目为 3.14.5（2026-10-09）；本次可读部分没有新增自定义渠道注册接口的说明。该页底部存在加载更多，未穷尽历史。— [更新日志](https://zcode.z.ai/cn/changelog)

### Inferences
- “产品支持其他聊天入口”与“公开第三方渠道开发契约”必须分开判断；前者已确认，后者见下一节。

### Gaps
- 未对用户当前 ZCode 安装版本做运行时验收；不承诺官方网页列出的所有渠道均已在本机开放。
- 官方名单不一致，无法仅凭这些页面判定 Telegram 的版本、地区与灰度限制。

## 是否有官方自定义 Channel、QQ 注册 API 或 SDK？

### Takeaway
在本次查阅的 Bot Channel、Remote Control、Plugin、Hooks、MCP、安装、Q&A、当前更新页及定向搜索范围内，未找到官方公布的自定义 Bot Channel provider 注册协议或 QQ 适配开发文档。结论是“未找到公开契约”，不是“技术上不可能”。

### Cited Findings
- 官方 Plugin 组件与 manifest 开发说明列出 Skills、Commands、Agents、MCP、Hooks，未列 Bot Channel provider 组件、渠道注册回调或外部会话消息 API。— [Plugin 开发文档](https://zcode.z.ai/cn/docs/plugin)
- Hooks 包含 SessionStart、UserPromptSubmit、PreToolUse、PermissionRequest、PostToolUse、PostToolUseFailure、Stop；Stop 输入有 `last_assistant_message`，可给正在结束的模型循环注入反馈。— [Hooks](https://zcode.z.ai/cn/docs/hooks)
- MCP 文档介绍向 Agent 接入外部工具服务，未列向空闲会话推送一条用户消息并自动启动轮次的渠道协议。— [MCP](https://zcode.z.ai/cn/docs/mcp-services)

### Inferences
- Stop hook 可以作为自动提取收尾回复的候选出口，agent 未必需要显式调用 `qq-bot.report`；但这只是输出侧方案，不能从这些 hook 推导出完整双向渠道，尤其不能推导出空闲会话的入站唤醒。
- 仅安装一个普通 QQ MCP 工具并不构成已证明的持续聊天入口。还需要有人负责入站路由、启动/转向会话、回复归属及持续读取。

### Gaps
- 未找到公开的 custom channel package/manifest 示例、渠道注册 API、官方 SDK 或自定义 Bot 收发协议；应向官方核实开放计划，或以现有内部桥接为独立方案评估。
- 检索词包含 `site:zcode.z.ai 自定义 渠道`、`site:zcode.z.ai 自定义渠道`、`site:zcode.z.ai QQ`、`site:zcode.z.ai ACP`；无结果只反映该范围公开检索，不能证明私有或未索引接口不存在。

## 现有内部桥接及社区 ACP 能否替代？

### Takeaway
用户现有 gwbZcode 代码已经能往运行中桌面会话发消息，但依赖 ZCode 内部服务。社区 ACP 另有多入口共享会话方案，它启动的是独立 headless app-server，不能当作已经支持接管原桌面活会话的证据。

### Cited Findings
- 本机 `GwbZcodeApi.send` 接收 workspace、task 与 prompt，文档约定向已有会话续聊，忙时排队，可选立即打断；公开服务面为 open/create/send/status/archive，尚无列会话与订阅消息方法。— [本机 api.ts](D:/unitfolders/evew5-gwbapps/gwb-agents/plugins/zcode/src/api.ts:26)
- 内部发送调用 `zcodeTaskService.sendPrompt`，立即发送调用 `zcodeAgentService.sendConversationCommandV4`；status 当前读取最新轮快照。— [本机 round.ts](D:/unitfolders/evew5-gwbapps/gwb-agents/plugins/zcode/src/round.ts:74)
- 桥接经主进程 Node inspector 与窗口 React services；代码和仓规明确把 ZCode 内部结构集中在 desktop.ts/round.ts。当前发送前强制设置 yolo，这也是现有仓规。— [desktop.ts](D:/unitfolders/evew5-gwbapps/gwb-agents/plugins/zcode/src/desktop.ts:5)、[仓库 AGENTS](D:/unitfolders/evew5-gwbapps/gwb-agents/AGENTS.md)、[round.ts](D:/unitfolders/evew5-gwbapps/gwb-agents/plugins/zcode/src/round.ts:98)
- 社区项目 william0wang/zcode-acp 自述启动 `zcode app-server --stdio` 子进程，将内部事件转为 ACP；不是 ZCode 官方项目。— [社区 README](https://github.com/william0wang/zcode-acp)
- 该社区方案可让编辑器 stdio 客户端和手机 WebSocket 客户端驱动同一 bridge 会话，并支持会话恢复。共享的是该 bridge 的 AgentApp，编辑器断开会结束其远端附件。— [社区 Remote Access](https://github.com/william0wang/zcode-acp/blob/main/docs/REMOTE.md)
- 社区协议文档明确将其描述为 ZCode CLI 的内部协议。— [社区 Protocol](https://github.com/william0wang/zcode-acp/blob/main/docs/PROTOCOL.md)

### Inferences
- 若坚持“原 ZCode 桌面那个会话 + QQ”，当前已知可行工程路线是延伸现有桌面桥接：绑定会话、输入转发、自动输出回传。它是内部协议适配，升级兼容与完整消息读取需验证。
- 若接受改用社区 bridge 托管的会话，可研究 ACP/WebSocket 接 QQ；这会改变会话宿主，不能悄悄当成满足原需求。用户本机现有仓规还明确禁止绕去无界面 CLI，实施前应先重新对齐路线。

### Gaps
- 本次没有实时发指令、订阅内部事件、修改权限模式或运行 QQ 回环测试，静态源码证明接口与依赖，不能替代运行时验收。
- 第三方恢复桌面会话历史、同步任务索引不等于同时接入桌面正在执行的进程；此点没有官方保证或本次实测支持。
- 引文预算：所有网页均为概述；无连续自然语言直接引文。每源直接引用仅协议标识/名称，少于 25 词；每源概述远少于 200 英文词等量。建议总报告只保留“官方内置会话入口已支持、公开自定义注册契约未找到、内部桥接已有入站能力”三点，避免把每篇文档展开。

