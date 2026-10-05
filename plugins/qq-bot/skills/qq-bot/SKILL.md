---
name: qq-bot
description: 要配置或使用 QQ 官方机器人通道（在 QQ 上给 ZCode 派任务操作本地文件）、查机器人状态、诊断消息没回应时读。讲设置项、openid 白名单绑定、机器人那头的指令、被动回复窗口的限制、ZCode 桌面端的前提。
---

# QQ 机器人 → ZCode

gwb 插件 `@godcreator/gwb-qq-bot`：常驻连 QQ 开放平台的 WebSocket 网关收私聊与群 @ 消息，
把任务文本经命令总线转给运行中的 ZCode 桌面端（`zcode.create` / `zcode.send`），轮询 `zcode.status`，
做完把回答末尾回推 QQ。无界面，三条命令：`qq-bot.status` 查状态，`qq-bot.reconnect` 改完凭据后重连，
`qq-bot.probe` 实测官方接口限制的探针（真发消息，只做实测用）。

## 配置（设置的 qq-bot 分区）

1. 在 QQ 开放平台（q.qq.com）创建机器人，拿 AppID 与 AppSecret；新版后台在「开发设置 → 开发体验号码」添加自己的 QQ。
   群聊把机器人添加到自己管理的群，再通过 QQ 的提及选择器选中机器人。
2. `app-id`、`app-secret` 填进设置（secret 走凭据保管，不经会话），明确设置 `sandbox=false`，使用当前官方 `api.bot.qq.com`。
   为兼容已有 home，`sandbox` 的默认值仍是 true；true 只保留旧 `sandbox.api.sgroup.qq.com` 接入，不适用于新版后台配置流程。
3. `default-workspace` 填 ZCode 干活的目录（绝对路径，相当于 `zcode.create` 的 workspace）
4. 调 `qq-bot.reconnect` 连接
5. 手机 QQ 给机器人发一条消息 → `qq-bot.status` 的 `recentRejected` 里出现你的 openid →
   把它填进 `allowed-openids`（官方 API 给的标识，每个机器人各不相同，不是 QQ 号；改白名单即时生效，不用重连）

## QQ 那头的指令

- 直接发任务文本：同一用户（按 openid）固定映射到一个 ZCode 会话，接着聊上下文保留；任务会真的在这台电脑上执行（完全访问）
- `/状态`：查当前轮次；上轮结果没送达时发它取回
- `/新会话`：归档当前会话，下一条消息起新会话
- `/帮助`：指令说明

## 官方接口的限制（设计成这样就绕开了）

- 被动回复（引用触发消息）：群聊 5 分钟窗口、每条消息 5 次；单聊 60 分钟、每条消息 4 次。
  单聊任务做完基本都在窗口内、直接回推；群聊超窗口的结果不硬推，发 `/状态` 取
- 主动消息频控按当前官方文档与账号权限执行；本插件群聊不用主动消息发结果，单聊仅在被动失败时兜底。
  单聊的 30 天、4 个周期规则属于 `is_wakeup` 互动召回，不能当作普通主动消息的配额。
- 用户可在 QQ 客户端关闭「接收机器人主动消息」，关了就只剩被动窗口
- 回复里的链接：域名没在开放平台报备（要 ICP 备案）会被腾讯过滤，ZCode 回答里的链接可能显示不出
- IP 白名单以后台实际设置为准；已启用白名单时，出口 IP 变动后要在开放平台更新

上面的次数与长度限制要用 `qq-bot.probe` 实测核对，别只信文档：先在 QQ 上发一条消息当触发源，
`qq-bot.probe {"experiment":"count"}` 连发被动回复看第几条被拒（回执逐条带官方 code），
`qq-bot.probe {"experiment":"length"}` 逐档发 600~2500 字的消息找单条长度边界（仅单聊；它走主动消息）。

## 前提与排障

- **ZCode 桌面端要开着、只有一个工作区窗口**，这是 `zcode.*` 命令的前提；没开时派任务失败，
  机器人会把错误原文回给你
- 消息没回应：`qq-bot.status` 看 `gateway`（stopped = 没配置或没连接，connecting = 在重连，open = 正常）
  与 `recentRejected`（白名单外）；凭据错误看工作台日志里「拿 access token 失败」
- 网关日志先记录 `QQ 入站事件：GROUP_AT_MESSAGE_CREATE` / `C2C_MESSAGE_CREATE`，再解析、去重与校验白名单。
  没有这条日志，先查连接环境、AppID 和平台投递；有日志再查形状错误、重复投递、白名单、空正文与回复接口错误。
  日志不记录原始事件载荷，避免其中的鉴权字段外泄。只有 @ 没有正文会记录空正文并忽略。
- 会话映射存在插件内存里：工作台重启或重载插件后映射清空，会话本身还在 ZCode 侧栏里，`/新会话` 重开即可
- 群聊验证先发 `@机器人 /帮助`，无需派任务即可验证收发。群聊的 `member_openid` 以实际事件为准，未在白名单时人工核实后再添加。
- 新版「服务范围」的群聊开关允许任意用户将机器人加入群，属于公开服务范围，不要把它当作测试群开关。

## API 契约依据

- [鉴权](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html)：当前 token 地址也在 `api.bot.qq.com`。
- [事件订阅](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/payload.html)：群聊与私聊共用 `GROUP_AND_C2C_EVENT (1 << 25)`。
- [群聊回复](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html)：请求使用 `msg_id` / `msg_seq`；内部驼峰字段不直接发到接口。
- [调用指南](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/api-call-guide.html)：业务错误读取 `err_code`，同时兼容仍返回 `code` 的现网接口。
