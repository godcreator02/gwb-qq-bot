`node probe.mjs --preflight`

## 问什么

开启群内全部消息后，A/B 能否收到对方发出的消息，从 author 取得当前应用可用的对方 ID，再发送真实 @？普通用户发普通消息和双 @ 作为投递控制。

## 怎么运行

Node.js 24，零第三方依赖。首行只查询两端群状态，必须均为 all。输入、HTTP 客户端、文档副本均在本目录；凭据运行时读取本机 home，AppID 必须匹配，不打印凭据。在线实验前暂停两端 qq-bot 插件的网关，避免与实验抢连接；完成或失败后恢复两端插件。`node probe.mjs --live` 建立两个独立 WebSocket，发送带唯一标记的 A/B HELLO 消息，收到对方测试消息时使用该回调 author ID 发真实 @；仅接收当前测试群，选择保留字段，不记录 message_scene 中的 auth_token，不派 ZCode 任务。监听 180 秒后自动关闭连接，新增 runs 原始 HTTP 和事件记录。

在 LISTENING 后由人发送普通文本及通过 QQ 选择器 @ 两个机器人的控制消息。不能用只有机器人发言、没有人工控制的零回调直接证明平台不投递。成员白名单、互派防循环与 ZCode 派单不属于此传输实验，必须后续另验。

## 结论

实测通过。runs/2026-10-05T181457-188Z.json 及同轮 events.jsonl：两端 all，网关 READY；无 @ 的 HELLO 机器人消息双向均以 GROUP_MESSAGE_CREATE 到达，author 给出接收方应用视角下的发送方 ID。使用这些 ID 发 Markdown @ 后，双向再次收到 GROUP_MESSAGE_CREATE，mentions 均包含接收方自身 member_openid。没有运行 ZCode 派单。由于正向机器人回调已直接出现，本轮无需人工控制消息证明连接可用。实验 180 秒后连接正常关闭。

## 运行那次的环境

2026-10-06，Windows，Node.js 24，正式 api.bot.qq.com。被测项目基线 98c25f5d44b31e8802d3ba035fe4e3354e1288f7。与旧实验 only_mention 条件不同；用户已明确开启两端全部消息。官方协议固定在 input/docs.json，主入口 SHA256 随 HTTP 回执保存。
