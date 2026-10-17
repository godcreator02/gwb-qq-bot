# Claude Code 自定义渠道与现有会话接入

核查日期：2026-10-11。仅查官方文档和 Anthropic 官方插件源码；没有安装、启动、改配置或实测 QQ。以下为研究笔记，不是已经验证的本机能力。无整句原文引用；各来源均按 200-word 摘要预算压缩。

## 能否把 QQ 接入正在使用的同一个会话？

### Takeaway
可以用官方 Channels 自定义协议把 QQ 输入送入运行中的 Claude Code 会话。**它不是完整聊天记录的自动镜像：回 QQ 仍需模型调用渠道的 reply 工具。**

### Cited Findings
- Channels 的定位就是把外部事件推入已打开的本机会话，官方现成渠道包括 Telegram、Discord、iMessage，另有 fakechat 演示；当前列表无 QQ。关闭会话后不接收事件，常驻需要保持 Claude 进程运行。[Channels](https://code.claude.com/docs/en/channels)
- 自定义服务由 Claude Code 启动，本机 stdio MCP 通信；声明 `claude/channel`，发送 `notifications/claude/channel`，内容为 `content` 加可选 `meta`。忙时消息排队，下一轮合并处理；通知写成功不代表已处理。[协议](https://code.claude.com/docs/en/channels-reference)
- 双向通道使用普通 MCP 回复工具及服务端 instructions，告知 Claude 何时如何回信；没有通用的助手全文输出订阅接口列在该契约中。[协议](https://code.claude.com/docs/en/channels-reference)
- 官方 Discord 实现明确告知模型：终端 transcript 不会转到对方聊天，用户应看到的内容必须经过 reply；它还提供编辑消息、附件、反应等工具。[官方源码](https://github.com/anthropics/claude-plugins-official/blob/main/external_plugins/discord/server.ts)

### Inferences
- 可以省去“派任务、生成 ticket、再 report”的业务协议，QQ 变为同一会话的输入渠道；但如果需求是“agent 完全不知道 QQ，只正常回答，全文必定自动转过去”，单独 Channels 尚不满足。[协议依据](https://code.claude.com/docs/en/channels-reference)
- 需要确定性回传时，桥接层还须另有输出观察/遗漏检查，不能把模型调用 reply 当成无条件保证。[官方实现依据](https://github.com/anthropics/claude-plugins-official/blob/main/external_plugins/discord/server.ts)

### Gaps
- 未实测 QQ。没有找到保证每个渠道输入必然调用 reply 的官方契约；官方通用协议不承诺把终端发起轮次的回答同步到渠道。
- 离线缓冲、去重、断线重发与消息已处理确认，要由桥接层设计和验收。

## 自定义渠道如何启用，能否随时挂到旧会话？

### Takeaway
这是研究预览；自定义本地开发与组织批准插件是两条不同入口。官方流程按启动参数启用渠道，需要重启进程；复用旧会话历史可考虑 resume，但不能据此宣称任意现有进程可热接入。

### Cited Findings
- 本地未批准渠道用 `--dangerously-load-development-channels server:<name>` 或 `plugin:<name>@<marketplace>`；需交互确认，`-p` 和 Agent SDK 会忽略该开发旗标。组织策略仍生效。[协议](https://code.claude.com/docs/en/channels-reference)
- 通常 `--channels` 使用 Anthropic 批准名单；Team/Enterprise 可设置 `allowedChannelPlugins` 批准内部 marketplace 渠道。这与本地开发绕过名单不同。Channels 仍是 research preview，旗标与协议可能变化。[Channels](https://code.claude.com/docs/en/channels)
- Channels 支持 claude.ai 登录或 Anthropic Console API key；不支持 Bedrock、Google Cloud Agent Platform、Microsoft Foundry。Team/Enterprise 需管理员启用；Console 默认允许，部署托管配置时另按组织开关处理。[Channels](https://code.claude.com/docs/en/channels)
- 官方安装步骤要求退出，再带渠道旗标重启。`-p` 一般渠道并非一律不支持；受限的是上述自定义开发旗标。[Channels](https://code.claude.com/docs/en/channels)
- CLI 的 `--resume` 可选择旧会话，`--fork-session` 才另建会话 ID；因此 resume 本身不等于新会话。[CLI reference](https://code.claude.com/docs/en/cli-reference)
- 渠道可声明 `claude/channel/permission` 转发工具审批，双端以先收到的答复为准；项目信任、MCP 同意仍留在本地。[协议](https://code.claude.com/docs/en/channels-reference)

### Inferences
- 待验证的候选启动法：`claude --resume <session-id> --dangerously-load-development-channels server:qq`。这是组合两个官方能力的推断，查到的文档未给 QQ 或此组合的直接示例，不当成已实测支持。[CLI](https://code.claude.com/docs/en/cli-reference)；[渠道](https://code.claude.com/docs/en/channels-reference)
- 建议将 QQ 绑定到启动了渠道的一个会话，避免“每条消息恢复一遍”的派发感觉；未来重新启动时恢复历史，并重建渠道连接。[生命周期依据](https://code.claude.com/docs/en/channels)

### Gaps
- 未找到“给没有渠道旗标的现有进程动态添加渠道”的官方热挂载命令。`/reload-plugins` 能加载插件，不应直接推断它能替代渠道的会话启用旗标。
- 尚未验证本机 Claude Code 版本、登录方式、组织策略、MCP 协议协商版本。

## 如果要求自动输出转发，还有什么官方路线？

### Takeaway
Agent SDK 的长连接输入和响应流更适合自行托管聊天入口；Remote Control 更接近“另一块屏幕接着聊”，但文档公开的是 Claude 自家客户端。

### Cited Findings
- SDK Streaming Input 是持久交互进程，支持多条输入顺序排队、中断、权限请求、实时响应与上下文保持。[Streaming Input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- Python `ClaudeSDKClient` 的多次 query 自动持续同一会话；`receive_response()` 迭代本轮输出。会话 ID 可 resume，SDK 也能枚举会话、读取消息。[Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- Remote Control 可在现有会话输入 `/remote-control` 启用，在 claude.ai 或 Claude 手机端继续；本机进程要保持运行。它同步消息、回复及工具活动，运行与文件访问留在本机。需要适用订阅，不接受 API-key 认证。[Remote Control](https://code.claude.com/docs/en/remote-control)

### Inferences
- 自己托管 SDK 长连接，可以由程序读取正常输出并转发 QQ，不必模型再调 report/reply；但这是接入自己管理的运行时，不等同于附着桌面上另一个已运行进程。[SDK 输入](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)；[SDK 会话](https://code.claude.com/docs/en/agent-sdk/sessions)
- `resume` 恢复磁盘历史，不是“与任意现存进程共享实时输入输出”的证据；直接双开同一历史文件也不能当成官方会话接入方案。[Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)

### Gaps
- 未找到供 QQ 等第三方接入 Remote Control 的公开客户端 SDK/协议；因此不能把 Remote Control 标成已开放自定义渠道。
- SDK 方案的终端共同参与、会话所有权、重启恢复与 QQ 重复投递仍须实施时验收。
