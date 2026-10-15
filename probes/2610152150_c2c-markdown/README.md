`node probe.mjs <触发消息 msg_id>`（先在私聊给机器人发一条 /帮助，从 `qq-bot.messages {"direction":"in","limit":1}` 取它的 msgId；60 分钟内运行）

## 问什么

单聊（c2c）用原生 markdown（`msg_type: 2`，正文放 `markdown.content`）代替纯文本（`msg_type: 0`）之后：

1. 手机上是否渲染 markdown，纯文本是否原样显示符号（`compare.mjs`，主动消息）
2. 被动回复（带 `msg_id`、`msg_seq`）加 `message_reference` 引用时还能不能发（P1）
3. 路径里的反斜杠、下划线、星号、行首 `#`、尖括号会不会显示错（P2）
4. 2000 字（回报上限）和 5000 字的 markdown 能不能一条完整显示（L1 带引用、L2）

只发给 `input/target.json` 里的主人私聊。凭据从那个 home 的 settings.json 与 credentials.json 读，不打印、不写进 runs。

## 怎么运行

Node 24，无外部依赖。每次运行在 `runs/` 写一份 JSON（请求体与官方回执）。HTTP 200 只说明接口收下了，显示效果要人在 QQ 里看。

## 结论

- `compare.mjs`（`runs/2026-10-15T134121Z-compare.txt`）：两条都是 HTTP 200；纯文本原样显示 markdown 符号，原生 markdown 渲染出来
- `probe.mjs`（`runs/` 下 2026-10-15T1344 那份）：P1、P2、L1、L2 四条都是 HTTP 200。用户在 QQ 里看的原话：「4 条都渲染正常：P1 有引用，P2 没有走样，L1 和 L2 完整显示。」

边界：只测了一个机器人（AppID <APP_ID_A>，正式环境）和一个收件人；更长的消息手机上会不会被截断没有核对。

## 运行那次的环境

2026-10-15，Windows 11、Node v24；被测插件 @godcreator/gwb-qq-bot 0.7.8（仓提交 19ba625）运行在 default home。
