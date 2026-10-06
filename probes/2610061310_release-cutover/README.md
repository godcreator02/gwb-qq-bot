`node probe.mjs qqbotb-2610052319 verify`（正式包切换用末尾 `update`；default 同理）

## 问题
正式包发布后，两端是否实际加载指定版本、依赖满足、来源绑定和 agent 可用？

## 输入
固定版本写在 probe.mjs；本目录冻结 MCP/QQ API 辅助代码和测试群标识。凭据只从各 home 本地读取，不保存。

## 做法
切换前分别备份两个 home 的包清单、锁、配置和相关插件数据。update 经插件管理安装并重载；verify 只读实际包版本、插件活动状态、来源与 agent。default 不派业务测试任务、不写日志。

## 记录
runs 按时间追加，passed 仅表示本次动作通过。业务闭环实测见独立 2610061253_business-seams 实验；本实验不冒充业务测试。

两端 update 与 verify 均通过。`node rebind.mjs` 由 B 在真实群 @A 发 /帮助，再把 A 新来源绑定到混合型 MMC 样机（ZCode、空群日志库）；B 保持 Claude Code、同项目、空群日志库。没有迁移旧票据。切换前备份在各 home 的 backups/qq-agents-release-20261006-130153。
