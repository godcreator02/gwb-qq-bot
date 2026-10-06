`node probe.mjs --replay`

## 问什么

在同一 QQ 群中，本应用取得的主人/机器人 OpenID 与另一应用取得的对应 OpenID，能否都被当前应用用于有效 Markdown @？

## 怎么运行

Node.js 24，零第三方依赖。首行命令仅核对本目录保存的原始回执，不发消息。`node probe.mjs --live` 使用本目录 api.mjs 和 input/targets.json 向测试群各发一条四项对照消息；凭据从本机 home 运行时读取，AppID 必须匹配，可用 QQ_PROBE_HOMES_ROOT 指定 home 根目录。保存新增 runs 回执后，需要直接观察本轮 QQ 消息并另外保存截图，不能用 HTTP 200 判定 @ 生效。本实验不改接收范围。

01-original-api.json 与 01-qq-window.png 为 01:33 实验的原始证据；当时脚本原文在 input/historical-script.txt，仅作溯源，不是独立入口。当前独立入口恢复同样的请求，新增自动鉴权记录；本次归档只执行了 --replay，没有把整理后的 --live 冒充已运行。截图为原始窗口截图，含侧栏其他会话，仅供本地核对，不要对外发布。

## 结论

两端 Markdown 消息 HTTP 200。截图人工复核：①本端主人和②本端机器人显示蓝色 @；③另一应用的主人、④另一应用的机器人都没有渲染出 @。本实验支持“另一应用拿到的 ID 在本应用不能直接用于这次 @”；普通用户也出现同样差异。它不证明拿到正确本应用 ID 后机器人互相 @ 仍不能触发。成员详情控制请求两端均为 11253 / 40012010。此目录不含原始网关监听记录，因此不凭此目录声称已证明平台不投递机器人消息。

## 运行那次的环境

2026-10-06 01:33，Windows，Node.js v24.14.1，正式 api.bot.qq.com，项目 commit 98c25f5d44b31e8802d3ba035fe4e3354e1288f7。两端群状态均 only_mention/member。协议来源：[文本交互](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/text-chain.html) 和 [机器人群内状态](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_bot_state.get.html)。
