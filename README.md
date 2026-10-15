# gwb-qq-bot

`@godcreator/gwb-qq-bot` —— gwb 插件：QQ 官方机器人当私聊通道。插件保持一条到 QQ 开放平台 WebSocket 网关的长连接，
收私聊消息，按斜杠命令分到任务组，交给组的执行端（ZCode 或 Claude Code），agent 做完调 `qq-bot.report`，结果发回原私聊。
按发言者 openid 白名单决定谁能派任务，按任务组决定在哪个目录、交给哪个执行端。服务 `gwbQqBot` 给别的插件主动私聊主人、注册任务组与直接命令。
每个人在自己的 home 里配自己的机器人，不处理群聊。
配置步骤、QQ 里的指令、官方接口的限制，都在随包说明书 `plugins/qq-bot/skills/qq-bot/SKILL.md`；别的插件怎么经服务 `gwbQqBot` 用它，在 `plugins/qq-bot/skills/qq-bot-plugin-api/SKILL.md`。

仓是 pnpm workspace：**仓根是一个不发布的 private 包，自己没有代码**（`pnpm build` / `pnpm check`
都递归到各成员包），插件放在 `plugins/qq-bot/`。包公开发在 npmjs（`publishConfig.registry` 写的源）：`devkit.release` 把包文件挂到 GitHub release 上，
由仓根的 `.github/workflows/publish.yml` 经 trusted publishing 发出去。仓本身是 GitHub 上的私有仓 `godcreator02/gwb-qq-bot`：`probes/` 的实验记录里有真实机器人的 AppID 与 openid。

## 结构

源码在 `plugins/qq-bot/src/`，分三块，共用一份聊天表，在根上的两个文件里接起来：

- `qq/`：连接与收发——WebSocket 网关、access token 与发消息、协议常量与事件解析、白名单与去重、被动回复窗口选路与分段
- `notify/`：通知——主动私聊主人，按 id 去重
- `dispatch/`：派任务——斜杠命令分发、任务组与直接命令的注册表、会话选择、一轮从入队到收尾、执行端适配层 `executors/`
- `storage/chat-table.ts`：聊天表（每个私聊一行、行里按任务组各一份状态），第 1、2 版迁成第 3 版
- `index.ts`：服务 `gwbQqBot`、设置、命令、连接生命周期；`rounds.ts`：连上以后把三块接起来

`qq/` 不 import `notify/`、`dispatch/`；`notify/` 与 `dispatch/` 互不 import。各块的接缝与契约见文档站（`docs-site/`）的入口页与各块的模块页。

## 怎么运行

仓根：`pnpm build`、`pnpm check`（typecheck + oxlint + vitest）。

- 插件在隔离 home 里验证：`devkit.dev {"home":"<home 名>","dir":"<仓根>","packages":["plugins/qq-bot"]}`；
  全链路（QQ → 执行端 → QQ）用专用测试机器人实测，步骤见 skill「qq-bot」
- 发版 `devkit.release {"dir":"<仓根>","packages":["plugins/qq-bot"]}`，先把提交推到 GitHub；本机 `@godcreator` 还指向 gitea 团队源的过渡期另加 `alsoPublishTo` 写上那个源。升版本号前读说明书「gwb-release」

写插件读 skill「gwb-devkit」。

README 由 `docs-site/content/docs/outputs/readme.mdx` 生成：改那份正本，再在站目录运行 `pnpm doc:render`。
