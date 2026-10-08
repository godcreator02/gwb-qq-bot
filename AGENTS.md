# gwb-qq-bot

这份 AGENTS.md 由 `docs-site/content/docs/outputs/agents.mdx` 生成：改那份正本，再运行 `pnpm doc:render`。

gwb 插件 `@godcreator/gwb-qq-bot`（`plugins/qq-bot/`）：QQ 官方机器人的私聊入口——收私聊消息，按斜杠命令分到任务组，交给组的执行端（经 inject 的 `gwbZcode` / `gwbClaudecode`），
agent 做完调 `qq-bot.report` 发回原私聊；服务 `gwbQqBot` 给别的插件主动私聊主人、注册任务组与直接命令。每个人在自己的 home 里配自己的机器人，不处理群聊。

## 硬约束

- 源码分三块：`src/qq/`（连接与收发）、`src/notify/`（通知）、`src/dispatch/`（派任务：斜杠命令分发、任务组、会话、队列），共用 `src/storage/chat-table.ts`，在 `src/rounds.ts` 里接起来。`qq/` 不 import `notify/`、`dispatch/`；`notify/` 与 `dispatch/` 互不 import
- 只处理私聊：群事件只记事件类型，不进任务、不回消息
- 白名单外的消息一律静默拒绝（记日志与 recentRejected），绝不回消息
- 消息第一个空白之前的那一段和某个命令完全相同才算命令，不做前缀匹配、不设别名；以 `/` 开头却不是命令的回「没有指令」，不派出
- 命令名重名、用保留字、超长直接报错，不覆盖、不自动改名
- 每个私聊的每个任务组一次只做一轮，后来的消息排在这一组自己的队列；不同的组可以同时做，指向同一个目录也不锁
- 回报只认本轮编号，不当凭证；没有后台轮询，执行端只在人发 /状态 或这一组这一轮没回报又来新消息时问一次
- 派任务失败把原话告诉人、这一轮作废；不留需要人手工解除的中间状态，不自动重发
- 执行端适配层（`src/dispatch/executors/`）是本插件私有的，接口按 qq-bot 要的定；执行端经 cordis 服务 inject，不按名字调命令
- 不依赖协作站：协作站经 `gwbQqBot.registerTaskGroup` 注册自己的任务组，依赖只朝协作站 → qq-bot 一个方向（反过来写 peer 会成环、发版被拒）；qq-bot 里不写和协作站有关的代码
- 官方接口的回执在入口校验形状，不对就报错或丢弃，不猜字段：`expires_in` 官方回数字字符串、两种都收，这是照官方文档核对过的，不是放宽校验
- access token 与 AppSecret 不进日志、不进命令回执
- 结果先发被动回复，被动发不出去或过了窗口只改发一次主动消息，再不行记进没送达等 /状态
- 协议字段名、事件位值集中在 `src/qq/qq-protocol.ts`；接口报错先对下面的官方文档核对再改，改了同步插件页钉码
- 服务、命令名、参数与回执形状是契约：改了同一个提交里改正本 `content/docs/outputs/skills/qq-bot.mdx` 并 render，按 gwb-release 判断升哪一位

## QQ 官方文档

- 文档首页：https://bot.q.qq.com/wiki/ ；管理端（配机器人、白名单、指令）：https://q.qq.com
- 指令与快捷菜单（只能在管理端手动配，没有接口）：https://bot.q.qq.com/wiki/#_9-1-2-指令配置
- 获取 access token：https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html
- WebSocket 网关：https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/websocket.html
- 消息收发规则（被动回复窗口、主动消息限额）：https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html
- 单聊消息事件：https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/c2c_message_create.html
- 发送单聊消息：https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html
- 接口变更记录：https://bot.q.qq.com/wiki/develop/api-v2/changelog.html

## 怎么构建与验证

仓根：`pnpm build`、`pnpm check`（typecheck + oxlint + vitest）。

- 隔离 home 验证：`devkit.dev {"home":"<home 名>","dir":"<仓根>","packages":["plugins/qq-bot"]}`，同一个 home 里装上 gwb-zcode / gwb-claudecode
- 端到端实测要有测试机器人、ZCode 桌面端开着，步骤读 skill「qq-bot」；派出的测试任务只做无害的事
- 发版 `devkit.release`，升版本号前读 skill「gwb-release」
- 文档站在 `docs-site/`：改 mdx 正本后 `pnpm doc:render`；看页面先 `pnpm build` 再 `pnpm start`（http://127.0.0.1:4337），不用 dev

写插件读 skill「gwb-devkit」，写文档读「docs-writing」，钉码核对与确认读「docs-site」，记轨迹读「trajectory」。
