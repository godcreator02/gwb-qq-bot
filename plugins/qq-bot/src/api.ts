/**
 * 服务 ctx.gwbQqBot：经 QQ 机器人主动私聊这台机器的主人，给私聊注册任务组与直接命令。要用就 inject `gwbQqBot`（可有可无时用 ctx.inject）。
 * QQ 还没连上（没配 AppID）时也能注册；notify 要连上才能用。
 */
export interface GwbQqBotApi {
  /**
   * 发一条主动私聊。同一个 id 只发一次：再调回 duplicate，内容不同直接报错；发不出去（频控、主人关了主动消息）回 delivered: false，不重发。
   * text 1–5000 字，按 markdown 渲染。主人是设置 owner-openid，必须也在 allowed-openids 里；没配好时直接报错
   */
  notify(id: string, text: string): Promise<{ delivered: boolean; duplicate: boolean }>
  /**
   * 注册一个任务组：私聊里发 `<command> 正文`，正文交给 claude-agent 在 workspace 里做（模型是 claude-agent 的设置 default-model），每个私聊各记一个会话。
   * 交回撤掉注册的函数，包在 ctx.effect 里，插件卸载或重载时自动撤掉：`ctx.effect(() => ctx.gwbQqBot.registerTaskGroup({...}))`。
   * 命令名不合规则（见 TaskGroupDefinition.command）、与已有命令重名、workspace 不是已存在目录的绝对路径、带了认不出的键，都抛异常。
   * 不检查 claude-agent 装没装：派任务时没装，就把原因回给私聊
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
