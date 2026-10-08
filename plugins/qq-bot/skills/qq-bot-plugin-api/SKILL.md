---
name: qq-bot-plugin-api
description: 写或改一个要用 qq-bot 的插件时读：经服务 gwbQqBot 注册任务组或直接命令、校验人起的命令名、主动私聊主人。
---

# 在别的插件里用 qq-bot

别的插件经服务 `gwbQqBot` 用 qq-bot，不按名字调 `qq-bot.*` 命令。服务的全部方法与参数：

```ts title="../plugins/qq-bot/src/api.ts:1-62"
/**
 * 服务 ctx.gwbQqBot：经 QQ 机器人主动私聊这台机器的主人，给私聊注册任务组与直接命令。要用就 inject `gwbQqBot`（可有可无时用 ctx.inject）。
 * QQ 还没连上（没配 AppID）时也能注册；notify 要连上才能用。
 */
export interface GwbQqBotApi {
  /**
   * 发一条主动私聊。同一个 id 只发一次：再调回 duplicate，内容不同直接报错；发不出去（频控、主人关了主动消息）回 delivered: false，不重发。
   * text 1–600 字。主人是设置 owner-openid，必须也在 allowed-openids 里；没配好时直接报错
   */
  notify(id: string, text: string): Promise<{ delivered: boolean; duplicate: boolean }>
  /**
   * 注册一个任务组：私聊里发 `<command> 正文`，正文交给 agent 在 workspace 里做，每个私聊各记一个会话。
   * 交回撤掉注册的函数，包在 ctx.effect 里，插件卸载或重载时自动撤掉：`ctx.effect(() => ctx.gwbQqBot.registerTaskGroup({...}))`。
   * 命令名不合规则（见 TaskGroupDefinition.command）、与已有命令重名、workspace 不是已存在目录的绝对路径，都抛异常。
   * 不检查执行端装没装：派任务时没装，就把原因回给私聊
   */
  registerTaskGroup(definition: TaskGroupDefinition): () => void
  /**
   * 注册一个直接命令：私聊里发 `<command> 正文`，handle 当场交回一段文字，按被动回复发回；不排队、不开会话、不派给 agent。
   * handle 抛错时把「指令 <command> 出错：<原话>」回给私聊。交回撤掉注册的函数，写法同 registerTaskGroup；命令名规则与重名同样抛异常
   */
  registerCommand(definition: DirectCommandDefinition): () => void
  /**
   * 命令名不合规则时回原因，合规回 null；和两个注册方法用的是同一条规则（见 TaskGroupDefinition.command），不查重名。
   * 给调用方在注册之前先校验自己收到的命令名，规则不用自己抄一份
   */
  commandNameProblem(command: string): string | null
}

export interface TaskGroupDefinition {
  /**
   * 斜杠命令，如 `/mmc`；去掉斜杠就是组名。不含空白，去掉斜杠后汉字等非 ASCII 字符算 2、其余算 1，总长 1–16（QQ 管理端指令名的上限）。
   * `/帮助`、`/状态`、`/新会话` 是保留命令
   */
  command: string
  /** 回执与任务说明里叫这个组的名字，如「混合型 MMC 样机」 */
  title: string
  /** agent 干活的目录，已存在目录的绝对路径 */
  workspace: string
  /** 执行端：zcode 或 claudecode */
  agent: 'zcode' | 'claudecode'
  /** 原样附在任务说明的「[任务组要求]」一段里 */
  instructions?: string
  /** 空闲超过这么多小时，下一条任务开新会话；不给就用设置 idle-hours。正数 */
  idleHours?: number
}

export interface DirectCommandInput {
  /** 命令后面的正文，去掉首尾空白，可能是空串 */
  text: string
  /** 发消息的人的 openid */
  senderOpenid: string
}

export interface DirectCommandDefinition {
  /** 斜杠命令，规则同 TaskGroupDefinition.command */
  command: string
  /** `/帮助` 里列出的一句说明 */
  description: string
  /** 交回要回复的文字 */
  handle(input: DirectCommandInput): Promise<string>
}
```

## 接上服务、注册

1. `package.json` 的 peer 写上 `@godcreator/gwb-qq-bot`，可有可无地接就在 `peerDependenciesMeta` 里标 optional；类型用 `import type { GwbQqBotApi } from '@godcreator/gwb-qq-bot'`
2. 注册写在依赖 `gwbQqBot` 的作用域里，交回的撤掉函数交给 `effect` 当清理函数：

   ```ts
   ctx.inject(['gwbQqBot'], (scoped) => {
     scoped.effect(() => scoped.gwbQqBot.registerTaskGroup({ command: '/mmc', title: '混合型 MMC 样机', workspace: 'D:\\…\\hybrid-mmc', agent: 'zcode' }))
   })
   ```

   离开 qq-bot 就没有意义的插件，把 `gwbQqBot` 写进自己的 `inject` 名单，直接 `ctx.effect(() => ctx.gwbQqBot.registerTaskGroup(…))`
3. 不写「qq-bot 回来了要重新注册」的代码，两边插件重载、卸载时注册怎么变：

qq-bot 重载时，注册表随旧的服务对象一起没了，依赖 gwbQqBot 的作用域被撤掉；新的服务对象出现后回调再运行一次，重新注册。你的插件重载或卸载时作用域撤掉，注册跟着撤掉；旧的撤掉函数只撤它自己那一份，就算晚于新注册才被调用，也不会撤掉之后同名的新注册。

**完成判据**：`qq-bot.group.list` 里有这个命令，`source` 是 `plugin`、`plugin` 是你的包名；私聊发 `/帮助` 列出它。

## 任务组还是直接命令

- **要 agent 在目录里动手、要接着上次的会话**：`registerTaskGroup`。派出以后跟 `qq-bot.group.add` 登记的组一样排队、开会话；
  结果由 agent 调 `qq-bot.report` 直接发回私聊，注册方拿不到
- **答案当场算得出**：`registerCommand`。`handle` 交回的文字按被动回复发回，不排队、不派给 agent；抛错时原话回给私聊
- 注册的命令自动进出手机私聊的「/」指令面板，不用另外调；面板放不下的命令照常能用，原因在 `qq-bot.status` 的 `panel.omitted`

## 命令名由人来起

1. 先调 `commandNameProblem(command)`：回了原因就拒绝，把原话给人看。不自己抄一份规则
2. 再注册：和已有的命令重名会当场抛异常，原话里写着被谁占着
3. QQ 连上之前注册、又和 `qq-bot.group.add` 登记的组同名时，注册当下查不出；连上以后日志记一行，派到这个命令的消息回重名、不派出。
   注册以后用 `qq-bot.group.list` 核对

## 私聊主人：notify

- 只发给设置 `owner-openid` 那个人；QQ 没连上、主人没配好都直接报错
- id 用这件事自己的编号，不用时间：同一个 id 同样的内容再调回 `duplicate`，内容不同直接报错
- 回 `delivered: false` 是没发出去（频控、主人关了接收主动消息），qq-bot 不重发：这件事要在你的插件里另有地方能看到

## 不做的事

- 不私聊主人以外的人；不处理群聊
- 不把一轮的结果交给注册方
- 不开放聊天表：会话、队列、没送达的结果只经 `qq-bot.status` 读
