---
name: qq-bot
description: 配置 QQ 机器人、绑定私聊、查聊天与任务状态、诊断消息没回应时读；QQ 派来的任务做完怎么回报也在这里。
---

# QQ 机器人 → 本机 agent

gwb 插件 `@godcreator/gwb-qq-bot`：常驻连 QQ 开放平台的 WebSocket 网关，收私聊消息，把任务交给这个私聊绑定的执行端（ZCode 或 Claude Code），
agent 做完调 `qq-bot.report`，结果发回原私聊。同一个私聊一次做一件，后面的排队。只处理私聊：每个人在自己的 home 里配自己的机器人，群里 @ 机器人不处理。
命令：`qq-bot.status`、`qq-bot.bind`、`qq-bot.unbind`、`qq-bot.report`、`qq-bot.notify`、`qq-bot.reconnect`；参数与回执用 `search {"prefix":"qq-bot."}` 看 usage。

## 你是执行 QQ 任务的 agent：怎么回报

任务说明末尾有一段「[本轮回报]」，写着本轮编号和 home 名。做完后：

1. 找连到那个 home 的 gwb MCP 服务（每个服务的说明里写着「你连上的是 home「…」」），调 `run {"command":"qq-bot.report","args":{"round":"<本轮编号>","text":"<给手机看的结果>"}}`
2. `text` 写给人在手机上看：做了什么、结果怎样、要人补什么信息，300 字以内（上限 2000，超了会被拒，缩短后用同一个编号再交）
3. 一轮只报一次；调用超时就用同样的参数再调一次，别换内容

**完成判据**：回执 `{ recorded: true }`。`duplicate: true` 表示这一轮已经记下过同样的结果。

## 配置（设置的 qq-bot 分区）

1. 在 QQ 开放平台（q.qq.com）创建机器人，拿 AppID 与 AppSecret；新版后台在「开发设置 → 开发体验号码」添加自己的 QQ
2. 填 `app-id`、`app-secret`（secret 走凭据保管，不经会话）；`sandbox` 保持 false（true 只兼容旧沙箱接口）
3. `default-workspace` 填主人私聊的工作区（绝对路径）
4. 调 `qq-bot.reconnect` 连接
5. 手机 QQ 给机器人发一条私聊 → `qq-bot.status` 的 `recentRejected` 里出现你的 openid → 填进 `allowed-openids`，同一个填进 `owner-openid`（openid 每个机器人各不相同，不是 QQ 号；白名单改了即时生效）

**完成判据**：`qq-bot.status` 的 `gateway` 是 `open`；私聊发 `/帮助` 收到说明。

一个机器人同一时间只连在一个 home 上：两个 home 用同一个 AppID 会互相顶掉网关连接。机器人换 home 时，旧 home 先清空 `app-id` 再 `qq-bot.reconnect`（会报没配置、不再连接），新 home 再配。

## 绑定私聊

1. 在私聊发 `/帮助`
2. `qq-bot.status` 的 `chats` 里找到这个私聊的 `id`（`c2c:<openid>`）
3. 绑定：`qq-bot.bind {"chat":"<id>","workspace":"<目录绝对路径>","title":"<回执里叫它的名字>","agent":"zcode"}`
   - 协作仓：先查 `collab.projects` 拿到协作仓路径与项目名，`workspace` 填协作仓根、`title` 填项目名，再加 `"collab":true`——提示词会写明改动经 `collab.submit` 提交
   - `agent` 可选 `zcode`（缺省）或 `claudecode`，必须是装着的执行端；`qq-bot.status` 的 `executors` 列着装了哪些
   - 主人私聊不绑也能用：按 `default-workspace` 交给 ZCode
4. 读回 `qq-bot.status` 核对 `binding`

这个私聊还有在做或排队的任务时，`bind` / `unbind` 会拒绝，等它做完。改绑后下一轮用新会话。

## QQ 那头的指令

- 直接发任务文本：在绑定的目录里真的执行，权限遵循所选执行端（ZCode 完全访问、Claude Code bypassPermissions）
- `/状态`：补发没送达的结果；没有就报这一轮在做什么
- `/新会话`：下一轮起换一个新会话
- `/帮助`：指令说明

## 消息没回应、结果没回来

- `qq-bot.status` 看 `gateway`（stopped 没配置或没连接，connecting 在重连，open 正常）与 `recentRejected`（白名单外的人）
- 凭据错误看工作台日志里「拿 access token 失败」；日志先记「QQ 入站事件：…」再处理，没有这条就查连接与平台投递
- 回「派单失败：…」：原话就是执行端的报错（比如 ZCode 没开、开了多个工作区窗口）；可能已经发出去了的原话里会写，去执行端侧栏看，别直接重发
- agent 做完了却没回报：发 `/状态`，qq-bot 会问一次执行端，做完了就把最后的回答发回来并接着做排队的下一条
- 结果被动、主动都没发出去（频控、关了主动消息）：发 `/状态` 补发

## 官方接口的限制

- 被动回复（挂在触发消息上）：单聊 60 分钟窗口、每条消息 4 次；过了窗口或次数用完改主动消息
- 每条回复都引用它回答的那条消息：结果引用派出这一轮的任务，`/状态` 补发的也一样
- 用户可在 QQ 客户端关闭「接收机器人主动消息」，关了就只剩被动窗口
- 回复里的链接：域名没在开放平台报备会被腾讯过滤

## 主人通知

`qq-bot.notify {"id":"…","text":"…"}` 主动私聊 `owner-openid`，正文最多 600 字，同一个 id 只发一次，发不出去不重发；回执 `delivered` 为 true 才是发出去了。别的插件 inject 服务 `gwbQqBot` 调 `notify`。
