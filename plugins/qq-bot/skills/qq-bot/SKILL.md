---
name: qq-bot
description: 配置 QQ 机器人、绑定私聊、登记任务组、给插件注册任务组或直接命令、查任务状态、诊断消息没回应时读；QQ 派来的任务做完怎么回报也在这里。
---

# QQ 机器人 → 本机 agent

gwb 插件 `@godcreator/gwb-qq-bot`：保持一条到 QQ 开放平台 WebSocket 网关的长连接，收私聊消息，按斜杠命令分到任务组，交给组的执行端（ZCode 或 Claude Code），
agent 做完调 `qq-bot.report`，结果发回原私聊。只处理私聊：每个人在自己的 home 里配自己的机器人，群里 @ 机器人不处理。
命令：`qq-bot.status`、`qq-bot.bind`、`qq-bot.unbind`、`qq-bot.group.add`、`qq-bot.group.remove`、`qq-bot.group.list`、`qq-bot.report`、`qq-bot.notify`、`qq-bot.reconnect`；参数与回执用 `search {"prefix":"qq-bot."}` 看 usage。

## 你是执行 QQ 任务的 agent：怎么回报

任务说明末尾有一段「[本轮回报]」，写着本轮编号和 home 名；有「[任务组要求]」一段的照它做。做完后：

1. 找连到那个 home 的 gwb MCP 服务（每个服务的说明里写着「你连上的是 home「…」」），调 `run {"command":"qq-bot.report","args":{"round":"<本轮编号>","text":"<给手机看的结果>"}}`
2. `text` 写给人在手机上看：做了什么、结果怎样、要人补什么信息，300 字以内（上限 2000，超了会被拒，缩短后用同一个编号再交）
3. 一轮只报一次；调用超时就用同样的参数再调一次，别换内容

**完成判据**：回执 `{ recorded: true }`。`duplicate: true` 表示这一轮已经记下过同样的结果。

## 配置（设置的 qq-bot 分区）

1. 在 QQ 开放平台（q.qq.com）创建机器人，拿 AppID 与 AppSecret；新版后台在「开发设置 → 开发体验号码」添加自己的 QQ
2. 填 `app-id`、`app-secret`（secret 由凭据保管，不经会话）；`sandbox` 保持 false（true 只兼容旧沙箱接口）
3. `default-workspace` 填主人私聊默认组的工作区（绝对路径）；`idle-hours` 是任务组空闲多少小时后下一条开新会话，缺省 6
4. 调 `qq-bot.reconnect` 连接
5. 手机 QQ 给机器人发一条私聊 → `qq-bot.status` 的 `recentRejected` 里出现你的 openid → 填进 `allowed-openids`，同一个填进 `owner-openid`（openid 每个机器人各不相同，不是 QQ 号；白名单改了即时生效）

**完成判据**：`qq-bot.status` 的 `gateway` 是 `open`；私聊发 `/帮助` 收到指令列表。

一个机器人同一时间只连在一个 home 上：两个 home 用同一个 AppID 会互相断开对方的网关连接。机器人换 home 时，旧 home 先清空 `app-id` 再 `qq-bot.reconnect`（会报没配置、不再连接），新 home 再配。

## 任务组

直接发的文字进**默认组**，`/<组命令> 任务` 进对应的组。每个私聊的每个组各有一个会话和一条队列：同一组一次做一件，不同的组可以同时做。

- **默认组**：每个私聊一个，由绑定设；主人私聊没绑时用 `default-workspace`、交给 ZCode
- **命令登记的组**：给常用目录用，白名单里的每个私聊都能用，存在聊天表里（要先连上 QQ）
- **插件注册的组**：别的插件经服务 `gwbQqBot` 注册，插件卸载时自动撤掉

命令名规则：以 `/` 开头、不含空白，去掉斜杠后汉字算 2、其余算 1，总长不超过 16；`/帮助`、`/状态`、`/新会话` 是保留命令；和已有的任何命令重名都报错。去掉斜杠就是组名。

### 绑定私聊（设默认组）

1. 在私聊发 `/帮助`
2. `qq-bot.status` 的 `chats` 里找到这个私聊的 `id`（`c2c:<openid>`）
3. `qq-bot.bind {"chat":"<id>","workspace":"<目录绝对路径>","title":"<回执里叫它的名字>","agent":"zcode"}`
   - `agent` 可选 `zcode`（缺省）或 `claudecode`，必须是装着的执行端；`qq-bot.status` 的 `executors` 列着装了哪些
   - `instructions` 可选：原样附在任务说明的「[任务组要求]」一段里
4. 读回 `qq-bot.status` 核对 `binding`

默认组还有在做或排队的任务时 `bind` / `unbind` 拒绝，别的组不受影响。改绑后默认组下一条开新会话。

### 登记、删掉任务组

1. `qq-bot.group.add {"command":"/论文","title":"学位论文","workspace":"<目录绝对路径>","agent":"zcode"}`，可选 `instructions`、`idleHours`（正数，不给用设置 `idle-hours`）
2. `qq-bot.group.list` 核对：每个组带 `source`（`default` / `command` / `plugin`）

`qq-bot.group.remove {"command":"/论文"}` 只删命令登记的组；插件注册的由那个插件撤掉。这个组在任何私聊里还有在做或排队的任务时拒绝。

**完成判据**：`qq-bot.group.list` 里有这个组；私聊发 `/帮助` 列出它。

### 插件注册任务组与直接命令

inject `gwbQqBot`，类型从本包 `dist/index.d.ts` 取，注册包在 `ctx.effect` 里：

```ts
ctx.effect(() => ctx.gwbQqBot.registerTaskGroup({ command: '/mmc', title: '混合型 MMC 样机', workspace: 'D:\\…\\hybrid-mmc', agent: 'claudecode', instructions: '…' }))
ctx.effect(() => ctx.gwbQqBot.registerCommand({ command: '/血糖', description: '查最近的血糖', handle: async ({ text, senderOpenid }) => '…' }))
```

- 命令名不合规则、重名、`workspace` 不是已存在目录的绝对路径都抛异常；不检查执行端装没装，派任务时没装就把原因回给私聊
- 注册之前要先校验收到的命令名（比如让人起的命令），调 `ctx.gwbQqBot.commandNameProblem(command)`：不合规则回原因，合规回 `null`，不查重名；不自己抄一份规则
- QQ 没连上时也能注册
- 直接命令不排队、不开会话：`handle` 交回的文字按被动回复发回，抛错时回「指令 /xxx 出错：原话」

## QQ 里的指令

- 直接发任务文本：进默认组，在绑定的目录里真的执行，权限遵循所选执行端（ZCode 完全访问、Claude Code bypassPermissions）
- `/<组命令> 任务`：进那一组；只发组命令不写任务回用法
- `/状态`：补发没送达的结果；没有就逐组报空闲，或在做第几轮、排队几条
- `/新会话`：默认组下一条起开新会话；`/新会话 <组名>` 对那一组
- `/帮助`：列出保留命令、全部任务组和直接命令
- 以 `/` 开头但不是任何指令：回「没有指令」，不派出

回执与结果开头写组名，回执里带一行「会话 a1b2 · 第 3 轮」（会话号的末 4 位、这个会话的第几轮）。一个组空闲超过它的空闲时长，下一条开新会话，回执写明「已开新会话（空闲超过 N 小时）」。

## 消息没回应、结果没回来

- `qq-bot.status` 看 `gateway`（stopped 没配置或没连接，connecting 在重连，open 正常）与 `recentRejected`（白名单外的人）
- 凭据错误看工作台日志里「拿 access token 失败」；日志先记「QQ 入站事件：…」再处理，没有这条就查连接与平台投递
- 回「派单失败：…」：原话就是执行端的报错（比如 ZCode 没开、开了多个工作区窗口、执行端没装）；可能已经发出去了的原话里会写，去执行端侧栏看，别直接重发
- 回「这条没有派出：设置 idle-hours 要是正数」：到设置里改成正数
- 回「指令 /xxx 同时是命令登记的任务组和……」：插件注册了和命令登记的组同名的命令，用 `qq-bot.group.remove` 删掉命令登记的那个
- agent 做完了却没回报：发 `/状态`，qq-bot 会问一次执行端，做完了就把最后的回答发回来并接着做那一组排队的下一条
- 结果被动、主动都没发出去（频控、关了主动消息）：发 `/状态` 补发

## 官方接口的限制

- 被动回复（请求里带触发消息的 `msg_id`）：单聊 60 分钟窗口、每条消息 4 次；过了窗口或次数用完改主动消息
- 每条回复都引用它回答的那条消息：结果引用派出这一轮的任务，`/状态` 补发的也一样
- 用户可在 QQ 客户端关闭「接收机器人主动消息」，关了就只剩被动窗口
- 回复里的链接：域名没在开放平台报备会被腾讯过滤
- 「/」面板里的指令只能在 QQ 开放平台管理端手动配，qq-bot 不同步它

## 主人通知

`qq-bot.notify {"id":"…","text":"…"}` 主动私聊 `owner-openid`，正文最多 600 字，同一个 id 只发一次，发不出去不重发；回执 `delivered` 为 true 才是发出去了。别的插件 inject 服务 `gwbQqBot` 调 `notify`。
