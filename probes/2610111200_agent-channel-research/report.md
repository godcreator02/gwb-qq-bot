# 把 QQ 接入同一个 Agent 会话

核查日期：2026-10-11。按上下文，将问题中的三个产品理解为 **Codex、Claude Code、ZCode**。

**三者都有接近这个需求的能力，但没有一个已确认提供开箱即用的自定义 QQ 渠道。** Claude Code 已公开自定义 Channels 协议，能向运行中会话送入消息；不过回 QQ 仍靠模型调用渠道回复工具。Codex 的 App Server 更适合“QQ 只是另一块输入输出界面”：程序能向线程发消息并读取正常回答事件。ZCode 官方已支持聊天渠道连接桌面已有会话，但本轮没有找到开放给第三方的自定义渠道注册协议。关键区别是：**恢复同一份历史、接入同一个运行中的会话、自动转发普通回答，是三个不同的能力。** 本报告依据官方文档、官方源码及本机只读检查；未做真实 QQ 收发测试。

| 产品 | 公开自定义渠道 | 同一运行中会话 | 普通回答自动回 QQ | 主要边界 |
|---|---|---|---|---|
| Claude Code | 有，Channels | 可以，但须启用渠道；任意旧进程热挂载未确认 | Channels 本身不提供，仍用 `reply` 工具 | 研究预览；自定义开发模式有启动限制 |
| Codex | 未找到 Channels 注册协议；有 App Server 客户端协议 | 官方支持 TUI 连接同一 App Server；任意桌面会话接入未确认 | 可以由桥接程序消费回答事件 | App Server/传输仍有实验性边界 |
| ZCode | 官方内置 Bot Channel；未找到公开自定义注册契约 | 官方内置入口支持已有桌面会话 | 自定义 QQ 路线尚需实现和验证 | 当前自有桥接依赖内部服务 |

**Claude Code 最接近“官方自定义渠道”，但不是自动镜像。** 自定义 stdio MCP 服务声明 `claude/channel`，通过 `notifications/claude/channel` 把消息推入会话；忙时排队。双向通信通过普通 MCP 回复工具完成。官方 Discord 实现明确区分终端记录与渠道回复：用户在 Discord 看到的内容须经 `reply` 发出。因此它能去掉“派任务、生成任务编号、调用 `qq-bot.report`”的业务流程，但不能承诺模型只在终端正常回答，QQ 就必然收到全文。([渠道协议](https://code.claude.com/docs/en/channels-reference)，[官方 Discord 源码](https://github.com/anthropics/claude-plugins-official/blob/main/external_plugins/discord/server.ts))

本地未批准的 QQ 渠道须用 `--dangerously-load-development-channels` 启动并交互确认，`-p` 与 Agent SDK 会忽略这个开发旗标；组织还可通过批准内部渠道插件走另一条配置路径。官方流程要求带渠道参数重启，不能据此宣称随时热接入任意旧进程。若要求程序自动转发普通回答，Agent SDK 的持久输入与响应流更合适，但接入的是自己托管的运行时。Remote Control 能继续现有会话，目前查到的是 Claude 自家网页和手机入口。([Channels](https://code.claude.com/docs/en/channels)，[开发限制](https://code.claude.com/docs/en/channels-reference)，[SDK](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)，[远程控制](https://code.claude.com/docs/en/remote-control))

**Codex 的 App Server 最贴合“输入输出桥接，不要求 agent 回报”。** 它公开会话发现、输入、转向、中断、审批与回答事件：桥接层发送 `turn/start`，读取 `item/agentMessage/delta` 等事件，即可把正常回答转到 QQ。`thread/resume` 会加载并订阅线程，单纯 `thread/read` 只是读取。模型无需认识 QQ 或调用专用报告工具。([App Server](https://learn.chatgpt.com/docs/app-server)，[官方集成定位](https://developers.openai.com/blog/codex-as-a-platform))

官方 CLI 已给出共享入口：先用 `codex app-server --listen ws://127.0.0.1:4500` 启动服务，再让 TUI 用 `codex --remote ws://127.0.0.1:4500` 接入。因此“电脑终端和 QQ 共用服务中的一个线程”有明确基础；但“直接接管当前 Codex 桌面应用里的任意聊天”仍缺端点发现与连接证据。文档也将 App Server 标为实验性，WebSocket 不作生产支持承诺。([CLI Reference](https://learn.chatgpt.com/docs/cli/reference))

本机 `codex-cli 0.162.0-alpha.2` 的只读帮助还出现了 `agents`、`queue --thread`、`app-server proxy` 等共享会话入口。这值得继续验证，**只能算本机 alpha 帮助证据**，不能写成已完成消息投递、回复订阅或桌面会话接入，更不能当作稳定版保证。

**ZCode 已有“继续桌面会话”的产品能力，开放 QQ 扩展仍不明确。** Bot Channel 文档列出微信、飞书，Remote Control 可选择桌面已有会话继续聊天；它们证明多入口会话成立。可是本轮查阅的 Plugin、Hooks、MCP 与渠道文档没有提供自定义 Bot Channel provider 注册接口，不能把内置渠道直接理解成开放渠道 SDK。([Bot Channel](https://zcode.z.ai/cn/docs/bot-channel)，[Remote Control](https://zcode.z.ai/cn/docs/remote-control)，[Plugin](https://zcode.z.ai/cn/docs/plugin))

你现有的 [gwbZcode 接口](D:/unitfolders/evew5-gwbapps/gwb-agents/plugins/zcode/src/api.ts:26) 已能往指定桌面会话续发消息，但还缺会话枚举和完整回复订阅；实现依赖内部服务。官方 Stop hook 的 `last_assistant_message` 可作为自动取出收尾回答的候选，仍未解决入站唤醒。社区 `zcode-acp` 则启动独立 headless app-server，不能作为接入原桌面活会话的证据。([Hooks](https://zcode.z.ai/cn/docs/hooks)，[社区实现](https://github.com/william0wang/zcode-acp))

**按你的需求，优先验证 Codex 同一运行时的输入与输出通道。** 最小验收只需：电脑先聊几轮，QQ 绑定这条线程，双方交替输入，正常回答自动回 QQ；再检查忙时输入和一次断线重连。若指定必须是眼前已有的桌面聊天，应先证明它所属的服务可连接。Claude Channels 适合接受渠道 `reply` 机制的情形；ZCode 则先核实官方自定义渠道开放情况，再决定是否继续维护内部桥接。
