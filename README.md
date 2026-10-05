# gwb-qq-bot

`@godcreator/gwb-qq-bot` —— gwb 插件：QQ 官方机器人当通道。插件常驻连 QQ 开放平台的 WebSocket 网关，
收私聊与群 @ 消息，把任务文本经命令总线转给运行中的 ZCode 桌面端执行（`zcode.create` / `zcode.send`），
轮询 `zcode.status`，做完把回答末尾回推 QQ。按 openid 白名单只响应配置过的 QQ 用户。命令 2 条
（`qq-bot.status` / `qq-bot.reconnect`）；skill 1 份。配置步骤、QQ 那头的指令、官方接口的限制，
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
- `src/bridge.ts`：openid ↔ ZCode 会话的桥接（白名单、指令、派任务、轮询、回发）
- `src/index.ts`：设置声明、两条命令、连接生命周期

各文件的契约与钉码见文档站插件页（`docs-site/`）。

## 怎么跑

仓根：`pnpm build`、`pnpm check`（typecheck + oxlint + vitest）。

- 插件在隔离 home 里验证：`devkit.dev {"home":"<home 名>","dir":"<仓根>","packages":["plugins/qq-bot"]}`；
  全链路（QQ → ZCode → QQ）要在沙箱机器人上实测，步骤见 skill「qq-bot」
- 发版 `devkit.release {"dir":"<仓根>","packages":["plugins/qq-bot"]}`，升版本号前读说明书「gwb-release」

写插件读 skill「gwb-devkit」。

README 由 `docs-site/content/docs/outputs/readme.mdx` 生成：改那份正本，再在站目录运行 `pnpm doc:render`。
