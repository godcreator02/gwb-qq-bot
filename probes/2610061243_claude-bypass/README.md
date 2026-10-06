`node probe.mjs run claudecode`

## 问什么

隔离 home qqbotb-2610052319 的 Claude Code bypassPermissions 能否提交真实 QQ 回报并送达原群？

## 怎么运行

独立 API/MCP 辅助脚本和身份输入，Node 24，无第三方依赖。input 保存安装的开发包；读取本机本 home 凭据、不导出。probe 从 A 向 B 发送无害任务，文件事件观察 QQ 回报与送达，结果追加 runs。

前置：本 home 的 gwb_botb 已接入 Claude 本机配置；没有运行中任务。`node recover.mjs` 仅用于恢复前轮固定测试会话：续聊提交原凭证与结果，不重做任务。首次运行会真实提交回报，不用于一般历史数据修复。

## 结论

原先权限拒绝的回报恢复成功，但原群触发窗口过期，保持 undelivered。新一轮 QQ 自然语言任务经同一原生 Claude 会话续聊，调用 qq-bot.report 后状态 completed、delivery=delivered；runs/2026-10-06T044333-725Z-run-claudecode.json 保存完整脱敏回执。最终 QQ 截图显示接单和结果都无白色 @前缀。该轮验证实际续聊；新建与续聊共同参数路径另有单元测试。

## 运行那次的环境

2026-10-06，Windows、Node v24.14.1、Claude Code 2.1.288。QQ 仓基线 98c25f5d44b31e8802d3ba035fe4e3354e1288f7，agent 仓基线 4ecbe6b938bf8463fdd9c6dd0095421332af5c34；未提交实现冻结于 input 的 QQ 0.3.1-dev.20261006124306 和 Claude 0.2.1-dev.20261006124122 开发包。安装状态在 inspect 运行记录中。
