# Codex 自定义渠道与会话直连

研究日期：2026-10-11。范围：官方 OpenAI 文档与本机 CLI 只读帮助。未运行新 agent、未向会话发消息、未启动或改变后台服务。

## 是否有可注册的原生自定义聊天 Channel

### Takeaway

本轮未找到面向本地 Codex 的公开自定义 Channel 注册协议。已找到明确的自定义客户端协议 App Server；不要把“未找到 Channels”写成“Codex 不支持直接接入会话”。

### Cited Findings

- OpenAI 的 Claude 插件迁移指南要求移除 Claude 的 `channels` 声明；依赖外部渠道入站消息的插件需联系 OpenAI，不能直接兼容移植。此结论限定在该指南的插件提交范围。— [Claude 插件迁移指南](https://developers.openai.com/plugins/guides/submit-claude-plugin)
- MCP Events 已公开，但可用范围列为网页 Work、桌面选择 Cloud 的 Work、dots，并未列本地 Codex；它不能作为本地 Codex Channels 已开放的证据。— [MCP Events](https://developers.openai.com/plugins/build/mcp-events)
- 官方将 App Server 定位为产品集成层，可维持对话、流式事件、打断和审批；SDK/exec 更偏程序化工作与批处理。— [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)

### Inferences

- 对 QQ 双向聊天，公开资料支持的方向是 QQ 作为 App Server 的客户端。模型本身无需识别 QQ，转发程序可收正常输出事件；这是依据官方产品集成层能力提出的架构建议，并非官方 QQ 插件。

### Gaps

- 查询范围包括 `learn.chatgpt.com`、`developers.openai.com` 的 app-server、CLI reference、plugins、channels/MCP/inbound/shared daemon 等主题；未检索到可供个人直接注册本地 Codex 渠道的完整公开接口。

## 能否连到同一个正在运行的会话

### Takeaway

独立 App Server 加 TUI 接入已有明确文档依据；“QQ 与 TUI 共用该服务”有技术基础。任意正在打开的桌面会话是否暴露同一可连接端点，尚未被本轮资料确认。

### Cited Findings

- 官方示例先启动 `codex app-server --listen ws://127.0.0.1:4500`，再以 `codex --remote ws://127.0.0.1:4500` 接入 TUI；也支持 Unix socket。文档将 app-server 标为实验性，WebSocket 不作生产支持承诺。— [CLI Reference](https://learn.chatgpt.com/docs/cli/reference)
- 同页说明 remote-control 用于受管理客户端和 SSH；自建本地协议客户端仍应使用 app-server 的监听入口。— [CLI Reference](https://learn.chatgpt.com/docs/cli/reference)
- App Server 订阅按连接维护；最后订阅者离开后，线程在无活动 30 分钟后卸载。`thread/read` 仅读，不加载或订阅；`thread/resume` 恢复并接收事件。— [App Server](https://learn.chatgpt.com/docs/app-server)

### 本机 alpha 附录（独立于官方网页证据）

- `codex --version` 返回 `codex-cli 0.162.0-alpha.2`。
- 只读 `codex agents --help`：浏览共享本地 daemon 会话。
- 只读 `codex --help`：`--no-daemon` 绕过共享后台服务。
- 只读 `codex app-server proxy --help`：`--sock <路径>` 将 stdio 代理到运行中的控制 socket。
- 只读 `codex queue --help`：`codex queue --thread <UUID或精确名称> --message <文本>` 将消息排入已有会话。
- 这是本机 alpha 帮助证据；未执行实际命令，未验证投递、回复或桌面归属，也未找到对应网页完整说明。不得视为公开稳定协议承诺。

### Inferences

- 应优先试验“连接会话所属的同一 runtime”，避免每条 QQ 消息另起一个恢复进程。现有 daemon、proxy、queue 降低了实现门槛。
- 共享 TUI + App Server 与桌面任意现有聊天实时接入必须区分；线程 ID 相同、历史可读取都不能单独证明二者共用正在执行的 agent。

### Gaps

- 缺少桌面会话到 daemon/socket 的官方发现与授权流程证据。
- 未验证多个客户端恢复同一活动线程时的配置归属、控制竞争、审批归属与重连行为。

## 实现双向 QQ 桥还需要哪些协议能力

### Takeaway

协议已覆盖会话发现、输入、输出和审批。断线补发与双入口协调仍应作为原型验收重点。

### Cited Findings

- 会话：`thread/list`、`thread/loaded/list`；输入：`turn/start`，忙时 `turn/steer`（校验活动 turn ID），停止 `turn/interrupt`。输出可监听 `item/agentMessage/delta` 和 `item/completed`，再以 `turn/completed` 判断结束。审批通过服务端请求与客户端决定往返。历史可用 `thread/read`；实验性 turns/items 分页带 cursor，但未见实时通知断点重放保证。— [App Server](https://learn.chatgpt.com/docs/app-server)
- 这些输出属于服务端事件，因此桥接层可以自动传递回复，无需提示模型执行“报告完成”工具。— [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)

### Inferences

- 建议原型验收：QQ 绑定一条 TUI 已聊过的线程；桌面与 QQ 交替输入；正常回复自动回传；忙时追加/排队语义明确；断线重连去重；审批一次处理；不改变现有权限策略。

### Gaps

- 公开文档没有足以在本轮确认 exactly-once、通知 cursor 重放、多客户端请求冲突保证的说明。
- 尚未对本机 alpha 版做实际收发测试。不得把帮助存在写成接入已成功。

来源用量：无自然语言长段原文引用；App Server 的最终综合答复建议控制在约 180 英文词等量，其余细節可分别引用 CLI Reference、platform 博文、MCP Events 与迁移指南。方法名为必要接口标识。
