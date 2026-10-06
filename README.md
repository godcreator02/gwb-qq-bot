# gwb-qq-bot

`@godcreator/gwb-qq-bot` —— gwb 插件：QQ 官方机器人当通道。插件常驻连 QQ 开放平台的 WebSocket 网关，
收私聊与群 @ 消息，把任务文本经命令总线转给当前绑定的原生 agent 插件执行，
接收 agent 直接回报，保存后发回 QQ。一个机器人接多个群和私聊：群绑定协作站并共享上下文，个人私聊独立。
按发言者 openid 白名单决定谁能派任务，按聊天来源绑定决定在哪里执行。公开命令包括状态查询、来源查询与绑定、派发不明任务的人工释放、重连、主人通知和官方限制探针；skill 1 份。配置步骤、QQ 那头的指令、官方接口的限制，
都在随包说明书 `plugins/qq-bot/skills/qq-bot/SKILL.md`。

仓是 pnpm workspace：**仓根是一个不发布的 private 包，自己没有代码**（`pnpm build` / `pnpm check`
都递归到各成员包），插件放在 `plugins/qq-bot/`。加第二个插件用
`devkit.scaffold.plugin {"repo":"<仓根>","name":"<短名>"}`。包发到插件包 `package.json` 里
`publishConfig.registry` 写的源，装进 home。

## 结构

- `src/qq-protocol.ts`：v2 API 常量与事件解析（外部输入在入口校验）
- `src/qq-rest.ts`：access token 取用与刷新、发消息 REST
- `src/qq-gateway.ts`：WebSocket 网关（Identify / Resume、心跳、退避重连、事件去重）
- `src/routing.ts`：入站文本归一与指令识别、出站长文本分段与末尾摘录（纯函数，tests/routing.test.ts）
- `src/reply-window.ts`：被动窗口与次数的选路（纯函数，tests/reply-window.test.ts）
- `src/probe.ts`：实测官方接口限制的探针参数与消息生成（纯函数，tests/probe.test.ts）
- `src/conversations.ts`：来源键、v3 持久化记录类型与严格校验
- `src/agents.ts`：QQ 自有适配器，分别调用 ZCode / Claude Code 原生命令
- `src/direct-report.ts`：每轮票据与直接回报契约
- `src/bridge.ts`：聊天来源 ↔ 原生 agent 会话的桥接（白名单、指令、工作区队列、派任务、回报、回发）
- `src/index.ts`：设置声明、命令、连接生命周期

各文件的契约与钉码见文档站插件页（`docs-site/`）。

## 怎么跑

仓根：`pnpm build`、`pnpm check`（typecheck + oxlint + vitest）。

- 插件在隔离 home 里验证：`devkit.dev {"home":"<home 名>","dir":"<仓根>","packages":["plugins/qq-bot"]}`；
  全链路（QQ → ZCode → QQ）用专用测试机器人实测，新版后台设置 sandbox=false，步骤见 skill「qq-bot」
- 发版 `devkit.release {"dir":"<仓根>","packages":["plugins/qq-bot"]}`，升版本号前读说明书「gwb-release」

写插件读 skill「gwb-devkit」。

README 由 `docs-site/content/docs/outputs/readme.mdx` 生成：改那份正本，再在站目录运行 `pnpm doc:render`。
