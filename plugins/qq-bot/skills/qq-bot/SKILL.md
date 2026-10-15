---
name: qq-bot
description: 配置 QQ 机器人、绑定私聊、登记任务组、换 QQ 任务用的模型、查任务状态、诊断消息没回应时读。写插件要用 qq-bot 读 qq-bot-plugin-api。
---

# QQ 机器人 → 本机 agent

gwb 插件 `@godcreator/gwb-qq-bot`：保持一条到 QQ 开放平台 WebSocket 网关的长连接，收私聊消息，按斜杠命令分到任务组，交给 claude-agent（插件 `@godcreator/gwb-claude-agent`）在组的目录里做，
这一轮结束后把 agent 的最后一条回复发回原私聊。只处理私聊：每个人在自己的 home 里配自己的机器人，群里 @ 机器人不处理。
命令：`qq-bot.status`、`qq-bot.messages`、`qq-bot.bind`、`qq-bot.unbind`、`qq-bot.group.add`、`qq-bot.group.remove`、`qq-bot.group.list`、`qq-bot.notify`、`qq-bot.reconnect`；参数与回执用 `search {"prefix":"qq-bot."}` 看 usage。

## 你是执行 QQ 任务的 agent

任务说明末尾有「[QQ 任务来源]」与「[最后一条回复]」两段，有「[任务组要求]」一段的照它做。这一轮你的**最后一条回复**会原样发回 QQ：用 markdown 写给人在手机上看，说清做了什么、结果怎样、要人补什么信息，5000 字以内。不用调任何命令回报。
## 配置（设置的 qq-bot 分区）

1. 在 QQ 开放平台（q.qq.com）创建机器人，拿 AppID 与 AppSecret；新版后台在「开发设置 → 开发体验号码」添加自己的 QQ
2. 填 `app-id`、`app-secret`（secret 由凭据保管，不经会话）；`sandbox` 保持 false（true 只兼容旧沙箱接口）
3. `default-workspace` 填主人私聊默认组的工作区（绝对路径）；`idle-hours` 是任务组空闲多少小时后下一条开新会话，缺省 6
4. 装上 claude-agent 并按说明书 `claude-agent-setup` 配好；没装时任务派不出去（`qq-bot.status` 的 `claudeAgentInstalled`）
5. 调 `qq-bot.reconnect` 连接
6. 手机 QQ 给机器人发一条私聊 → `qq-bot.status` 的 `recentRejected` 里出现你的 openid → 填进 `allowed-openids`，同一个填进 `owner-openid`（openid 每个机器人各不相同，不是 QQ 号；白名单改了即时生效）

**完成判据**：`qq-bot.status` 的 `gateway` 是 `open`；私聊发 `/帮助` 收到指令列表。

一个机器人同一时间只连在一个 home 上：两个 home 用同一个 AppID 会互相断开对方的网关连接。机器人换 home 时，旧 home 先清空 `app-id` 再 `qq-bot.reconnect`（会报没配置、不再连接），新 home 再配。

## 任务组

直接发的文字进**默认组**，`/<组命令> 任务` 进对应的组。每个私聊的每个组各有一个会话和一条队列：同一组一次做一件，不同的组可以同时做。

- **默认组**：每个私聊一个，由绑定设；主人私聊没绑时用 `default-workspace`
- **命令登记的组**：给常用目录用，白名单里的每个私聊都能用，存在聊天表里（要先连上 QQ）
- **插件注册的组**：别的插件经服务 `gwbQqBot` 注册，插件卸载时自动撤掉

命令名规则：以 `/` 开头、不含空白，去掉斜杠后汉字算 2、其余算 1，总长不超过 16；`/帮助`、`/状态`、`/新会话` 是保留命令；和已有的任何命令重名都报错。去掉斜杠就是组名。

### 绑定私聊（设默认组）

1. 在私聊发 `/帮助`
2. `qq-bot.status` 的 `chats` 里找到这个私聊的 `id`（`c2c:<openid>`）
3. `qq-bot.bind {"chat":"<id>","workspace":"<目录绝对路径>","title":"<回执里叫它的名字>"}`
   - `instructions` 可选：原样附在任务说明的「[任务组要求]」一段里
4. 读回 `qq-bot.status` 核对 `binding`

默认组还有在做或排队的任务时 `bind` / `unbind` 拒绝，别的组不受影响。改绑后默认组下一条开新会话。

### 登记、删掉任务组

1. `qq-bot.group.add {"command":"/论文","title":"学位论文","workspace":"<目录绝对路径>"}`，可选 `instructions`、`idleHours`（正数，不给用设置 `idle-hours`）
2. `qq-bot.group.list` 核对：每个组带 `source`（`default` / `command` / `plugin`）

`qq-bot.group.remove {"command":"/论文"}` 只删命令登记的组；插件注册的由那个插件撤掉。这个组在任何私聊里还有在做或排队的任务时拒绝。

**完成判据**：`qq-bot.group.list` 里有这个组；私聊发 `/帮助` 列出它。

### 插件注册任务组与直接命令

写在插件代码里，经服务 `gwbQqBot`，不用命令：读说明书 `qq-bot-plugin-api`。

## 换 QQ 任务用的模型

qq-bot 不选模型：新会话用 claude-agent 的设置 `default-model`。人在 QQ 里让你换模型时：

1. `claude-agent.setup-status` 看有哪几份模型配置（`models` 的 `name`）、各自的 token 填了没有
2. `settings.set {"section":"claude-agent","key":"default-model","value":"<配置名>"}`；token 没填就停下，请人到设置界面填
3. 告诉人：会话建立时就定下了模型，已有的会话不换，各组发 `/新会话` 后下一条才用新模型

**完成判据**：下一条任务的回执里「模型」写的是新配置名。

## QQ 里的指令

- 直接发任务文本：进默认组，在绑定的目录里真的执行，权限照 claude-agent 的设置
- `/<组命令> 任务`：进那一组；只发组命令不写任务回用法
- `/状态`：补发没送达的结果；没有就逐组报空闲，或在做第几轮、排队几条
- `/新会话`：默认组下一条起开新会话；`/新会话 <组名>` 对那一组
- `/帮助`：列出保留命令、全部任务组和直接命令
- 以 `/` 开头但不是任何指令：回「没有指令」，不派出

回执与结果开头写组名，回执里带一行「会话 a1b2 · 第 3 轮 · 模型 glm」（会话号的末 4 位、这个会话的第几轮、用的模型）。一个组空闲超过它的空闲时长，下一条开新会话，回执写明「已开新会话（空闲超过 N 小时）」。

## 查消息记录

机器人收到的每条私聊、发出的每条消息（含发送结果）都记着，`qq-bot.messages` 按时间倒序查，不要求连着 QQ：

1. 带上条件查：`{"chat":"c2c:<openid>","limit":20}` 看一个私聊最近的来回；查一轮用 `{"round":"<本轮编号>"}`，查一个组用 `{"group":"<组名>"}`（默认组写「默认」），只看收到的或发出的加 `"direction":"in"` / `"out"`，只看某个时刻以后的加 `"since":"2026-10-08T08:00:00Z"`
2. 入站看 `route`：`group` 进了那一组的队列；`reserved` / `direct` 是保留命令或直接命令；`not-dispatched` 看 `reason`（`empty` 空消息、`duplicate` 重复投递、`unknown-command` 没有指令、`usage` 用法不对、`conflict` 重名、`group-unavailable` 组派不出去，原因在 `detail`）；`rejected` 是白名单外的，只记了正文前 40 字
3. 出站看 `kind`（`receipt` 已接收或排队、`result` 一轮的结果、`resend` /状态 补发、`notice` 主人通知、`command-answer` 指令的回答、`not-dispatched` 没派出的说明）与 `result`：`ok: true` 是发出去了；`ok: false` 带官方错误码 `code` 与原话 `message`。被动发不出去改发主动会记两条，`mode` 分别是 `passive`、`active`；分段的每段一条，`segment` 写第几段

回执超过 40000 字会报错：把 `limit` 改小（缺省 50，最多 500）或加条件再查。没配 AppID 回空列表。记录留当月与前 3 个月。

## 消息没回应、结果没回来

- 结果发出去没有、那条消息分到哪了：先按上一节查 `qq-bot.messages`，再往下看
- `qq-bot.status` 看 `gateway`（stopped 没配置或没连接，connecting 在重连，open 正常）与 `recentRejected`（白名单外的人）
- 凭据错误看工作台日志里「拿 access token 失败」；日志先记「QQ 入站事件：…」再处理，没有这条就查连接与平台投递
- 回「派单失败：…」：原话就是 claude-agent 的报错（比如没装、没配 `sdk-dir`、模型的 token 没填）；照 `claude-agent.setup-status` 修好再发。接着用旧会话时失败，发 `/新会话` 再发
- 回「这一轮没有做完：…」：claude-agent 这一轮失败了（到了轮数上限、模型报错、它自己重载），原因在后面；要做就再发一次
- 回「这条没有派出：设置 idle-hours 要是正数」：到设置里改成正数
- 回「指令 /xxx 同时是命令登记的任务组和……」：插件注册了和命令登记的组同名的命令，用 `qq-bot.group.remove` 删掉命令登记的那个
- 结果被动、主动都没发出去（频控、关了主动消息）：发 `/状态` 补发
- 「/」面板里少了命令或没弹出：看 `qq-bot.status` 的 `panel`——`notSyncing` 是不同步的原因（没配机器人、没连上），`omitted` 是没放进面板的命令与原因，`omittedTargets` 是白名单超出 20 个看不到面板的人，`error` 是最近一次同步失败的原话（下次命令变化或 `qq-bot.reconnect` 时再同步）

## 官方接口的限制

- 被动回复（请求里带触发消息的 `msg_id`）：单聊 60 分钟窗口、每条消息 4 次；过了窗口或次数用完改主动消息
- 每条回复都引用它回答的那条消息：结果引用派出这一轮的任务，`/状态` 补发的也一样
- 用户可在 QQ 客户端关闭「接收机器人主动消息」，关了就只剩被动窗口
- 回复里的链接：域名没在开放平台报备会被腾讯过滤
- 「/」指令面板经官方 `/v2/panels` 接口自动同步，只给白名单前 20 个人看：条目名含斜杠最长 14（汉字算 2）、最多 20 条，放不下的命令照常能用、只是不进面板；点面板里的指令只把它填进输入框，接着写正文再发

## 主人通知

`qq-bot.notify {"id":"…","text":"…"}` 主动私聊 `owner-openid`，正文最多 5000 字、按 markdown 渲染，同一个 id 只发一次，发不出去不重发；回执 `delivered` 为 true 才是发出去了。插件里经服务 `gwbQqBot` 调 `notify`，见说明书 `qq-bot-plugin-api`。
