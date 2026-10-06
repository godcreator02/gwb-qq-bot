`node probe.mjs`

## 问什么

仅 @ 模式下，A/B 直接说自然语言任务，不加 /任务，是否都能经 QQ 插件派入 ZCode 并回传一次结果，且没有回执互触发？

## 怎么运行

Node.js 24，零第三方依赖。保持两端 QQ 插件运行，安装本轮版本，两端白名单包含真实发送方成员 ID。脚本使用本目录 HTTP 客户端与按调用应用/群匹配的 peer-ids 输入，凭据只在对应 home 本地读取。发两条要求仅回复固定验证文本、不调用工具、不读写文件的无害任务。

发送后在各自 home 调 qq-bot.status，等待最多一个轮询周期（60 秒）后核对：发送方 ID 对应的会话 roundIndex 为 1、roundRunning 为 false、resultDelivered 为 true；继续观察至少一个周期，轮次不能增加。通过 gwb-zcode 的 zcode.status 核对两个 taskId 的最终回复文本；保存脱敏回执在 runs。HTTP 成功本身不能算端到端验收。此入口不直接调用 ZCode，真实派单必须由 QQ 入站触发插件完成。

## 结论

双向通过。HTTP 原始记录为 runs/2026-10-05T182024-404Z.json，02-dispatched.json 为各一次真实派单，03-zcode-results.json 保存实际 zcode.status 的成功回复与空文件改动。03-completed.json 双方 resultDelivered=true，04-stable.json 继续观察至少 60 秒，双方仍只有一轮，无回执循环。`node verify.mjs` 可离线复核这些固定证据，不触发新任务。网关日志实际记录收到对方确认/结果后“忽略机器人回执”。两端仅 @，发送正文没有 /任务。

## 运行那次的环境

2026-10-06，Windows，Node.js 24，正式 QQ API，两个 home 安装 0.1.4-dev.20261006021903；ZCode 桥接插件 0.2.5。代码基线 98c25f5d44b31e8802d3ba035fe4e3354e1288f7 加本轮未提交改动，39 项测试和构建通过；双向群范围 only_mention。
