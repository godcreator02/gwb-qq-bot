import path from 'node:path'
import { Service } from 'cordis'
import type { GwbContext } from '@godcreator/gwb-kernel-desktop'
// 空的类型 import 只为让这几个包的 `declare module 'cordis'` 生效，ctx 上才有对应服务的类型
import type {} from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-settings'
import type {} from '@godcreator/gwb-skills'
import type {} from '@godcreator/gwb-data'
import type {} from '@godcreator/gwb-zcode'
import type {} from '@godcreator/gwb-claudecode'
import type { DirectCommandDefinition, GwbQqBotApi, TaskGroupDefinition } from './api.js'
import { PluginCommandRegistry, type RegistrationContext } from './dispatch/command-registry.js'
import { claudecodeExecutor } from './dispatch/executors/claudecode.js'
import { ExecutorTable } from './dispatch/executors/executor.js'
import { zcodeExecutor } from './dispatch/executors/zcode.js'
import { QqGateway } from './qq/qq-gateway.js'
import { QqRestClient } from './qq/qq-rest.js'
import { Rounds } from './rounds.js'
import { ChatTable } from './storage/chat-table.js'

export * from './api.js'

const PLUGIN_NAME = 'gwb-qq-bot'

const SETTINGS = [
  { key: 'app-id', title: 'AppID', type: 'string', default: '', description: 'QQ 开放平台（q.qq.com）机器人的 AppID。改了要调 qq-bot.reconnect 才生效' },
  { key: 'app-secret', title: 'AppSecret', type: 'secret', description: 'QQ 开放平台机器人的 AppSecret，与 AppID 一起用于换 access token。改了要调 qq-bot.reconnect 才生效' },
  { key: 'sandbox', title: '旧沙箱接口', type: 'boolean', default: false, description: 'false 用官方 api.bot.qq.com（新版后台的开发体验号码也用它）；true 只兼容旧的 sandbox.api.sgroup.qq.com。改了要调 qq-bot.reconnect 才生效' },
  { key: 'allowed-openids', title: '允许的 openid 白名单', type: 'string-list', default: [], description: '允许使用机器人的 QQ 用户 openid（每个机器人各不相同，不是 QQ 号）。空名单谁都用不了；谁发消息被拒了，去 qq-bot.status 的 recentRejected 里看 openid 再加进来' },
  { key: 'owner-openid', title: '主人私聊 openid', type: 'string', default: '', description: '主人：主动通知的唯一收件人；主人私聊没绑定时，默认组用下面的默认工作区。填本机器人私聊消息里取得的 openid，并加进白名单' },
  { key: 'default-workspace', title: '主人私聊的默认工作区', type: 'string', default: '', description: '主人私聊没有显式绑定时，直接发的文字在这个目录里做（绝对路径），交给 ZCode；为空时要先 qq-bot.bind' },
  { key: 'idle-hours', title: '空闲多久开新会话（小时）', type: 'number', default: 6, description: '一个任务组超过这么多小时没有新任务，下一条自动开新会话，回执里写明。任务组自己给了 idleHours 的用组的。要是正数，不是正数时派任务报错' },
] as const

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 服务 gwbQqBot 的提供方：QQ 官方机器人的私聊通道，私聊里的任务按斜杠命令分到任务组、交给组的执行端，agent 做完调 qq-bot.report */
export default class GwbQqBot extends Service implements GwbQqBotApi {
  static inject = ['gwbCommands', 'gwbSettings', 'gwbData']

  /** 方法里的 `this.ctx` 是调用方的；设置、命令、连接与执行端登记都在提供方自己的上下文上 */
  private readonly providerContext: GwbContext
  private readonly executors = new ExecutorTable()
  private readonly registry = new PluginCommandRegistry()
  private readonly rest: QqRestClient
  private readonly gateway: QqGateway
  /** 连上的那个机器人；入站与出站用同一份，改设置在 reconnect 时一起生效 */
  private active: { appId: string; secret: string; sandbox: boolean } = { appId: '', secret: '', sandbox: false }
  private rounds: Rounds | null = null
  private disposed = false

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbQqBot')
    this.providerContext = ctx
    const log = ctx.logger(PLUGIN_NAME)
    this.rest = new QqRestClient(() => this.active.appId, () => this.active.secret, () => this.active.sandbox, log)
    this.gateway = new QqGateway(this.rest, log, {
      onMessage: (message) => {
        if (this.rounds === null) return
        void this.rounds.handleIncoming(message).catch((error: unknown) => log.error(`QQ 私聊消息处理失败：${String(error)}`))
      },
      onState: (state, detail) => log.info(`QQ 网关状态：${state}${detail === undefined ? '' : `（${detail}）`}`),
    })
  }

  private setting(key: string): unknown {
    return this.providerContext.gwbSettings.get(key)
  }

  [Service.init](): void {
    const ctx = this.providerContext
    const log = ctx.logger(PLUGIN_NAME)
    ctx.effect(() => {
      const undefineAll = SETTINGS.map((definition) => ctx.gwbSettings.define({ ...definition }))
      return () => { for (const undefine of undefineAll) undefine() }
    })
    // 执行端适配层：哪个执行端插件装着，哪份实现才登记；卸了自动撤掉
    ctx.inject(['gwbZcode'], (scoped) => { scoped.effect(() => this.executors.register(zcodeExecutor(scoped.gwbZcode))) })
    ctx.inject(['gwbClaudecode'], (scoped) => { scoped.effect(() => this.executors.register(claudecodeExecutor(scoped.gwbClaudecode))) })
    this.registerCommands()
    // 说明书在包根的 skills/，相对产物 dist/index.js 写作 '../skills/'；那个目录要在 package.json 的 files 里
    ctx.inject(['gwbSkills'], (scoped) => { scoped.effect(() => scoped.gwbSkills.register(new URL('../skills/', import.meta.url))) })
    ctx.effect(() => () => this.dispose())
    void this.connect().catch((error: unknown) => log.error(`QQ 启动失败：${String(error)}`))
    log.info('已加载（服务 ctx.gwbQqBot 与 qq-bot.* 命令）')
  }

  /** 按当前设置连上机器人；聊天表按 AppID 一份，换了机器人就是另一份 */
  private async connect(): Promise<boolean> {
    const ctx = this.providerContext
    const appId = readString(this.setting('app-id')), secret = readString(this.setting('app-secret'))
    if (this.disposed || appId === '' || secret === '') {
      if (!this.disposed) ctx.logger(PLUGIN_NAME).info('QQ 机器人的 AppID / AppSecret 没配置，不连接；配好后调 qq-bot.reconnect')
      return false
    }
    this.active = { appId, secret, sandbox: this.setting('sandbox') === true }
    const table = new ChatTable({ read: () => ctx.gwbData.readDoc(`chats-${appId}`), write: (value) => ctx.gwbData.writeDoc(`chats-${appId}`, value) })
    await table.settle()
    if (this.disposed) return false
    const log = ctx.logger(PLUGIN_NAME)
    if (table.droppedGroups > 0) log.info(`聊天表从第 1 版换成第 2 版：不再处理群聊，去掉了 ${table.droppedGroups} 个群聊，下次写盘生效`)
    if (table.migratedChats !== null) log.info(`聊天表换成第 3 版：${table.migratedChats} 个私聊的会话、在做的一轮和队列归进默认组，下次写盘生效`)
    this.rounds = new Rounds({
      home: path.basename(ctx.gwbKernel.dataDir),
      table,
      executors: this.executors,
      registry: this.registry,
      allowedOpenids: () => readStringList(this.setting('allowed-openids')),
      ownerOpenid: () => readString(this.setting('owner-openid')),
      defaultWorkspace: () => readString(this.setting('default-workspace')),
      idleHours: () => this.setting('idle-hours'),
      sendC2c: (openid, content, msgId, msgSeq, quote) => this.rest.sendC2c(openid, { content, msgId, msgSeq, quote }),
      log,
    })
    for (const command of this.rounds.conflictingCommands()) log.warn(`命令 ${command} 既是命令登记的任务组，又被插件注册了：派到它的消息会报重名，用 qq-bot.group.remove 删掉命令登记的那个`)
    this.gateway.start()
    return true
  }

  private requireRounds(): Rounds {
    if (this.rounds === null) throw new Error('QQ 机器人还没连上：先在设置的 qq-bot 分区填 AppID / AppSecret，再调 qq-bot.reconnect')
    return this.rounds
  }

  notify(id: string, text: string): Promise<{ delivered: boolean; duplicate: boolean }> {
    return this.requireRounds().notify(id, text)
  }

  registerTaskGroup(definition: TaskGroupDefinition): () => void {
    return this.registry.registerTaskGroup(definition, this.registrationContext())
  }

  registerCommand(definition: DirectCommandDefinition): () => void {
    return this.registry.registerCommand(definition, this.registrationContext())
  }

  /** 这里的 `this.ctx` 是调用方的：取它的插件包名（`fiber.entry` 是 loader 加上的，不在 cordis 的类型里，按运行时形状取），取不到就不写 */
  private registrationContext(): RegistrationContext {
    const name = (this.ctx as unknown as { fiber?: { entry?: { options?: { name?: unknown } } } }).fiber?.entry?.options?.name
    return { plugin: typeof name === 'string' && name !== '' ? name : undefined, storedGroupCommands: this.rounds?.storedGroupCommands() ?? [] }
  }

  private registerCommands(): void {
    const commands = this.providerContext.gwbCommands
    if (commands === undefined) throw new Error('ctx.gwbCommands 不在：inject 里写了它，cordis 本不该调用到这里')

    commands.register(
      { name: 'qq-bot.status', description: '读 QQ 通道状态：连接、各个私聊的绑定、每个任务组的会话、在做的一轮、排队与没送达的结果', effect: 'read',
        usage: '无参数。回 { gateway, appIdConfigured, appSecretSet, sandbox, executors, chats: [{ id, target, lastSeen, lastSender, binding, bindingFromDefault, groups: [{ group, title, workspace, agent, source, session, round, queued, lastTaskAt }], undelivered }], recentRejected }。只处理私聊，群里 @ 机器人不处理；chats 的 id 给 qq-bot.bind；私聊在机器人收到它的第一条消息后才出现。binding 是这个私聊默认组的绑定，为空的私聊直接发的文字派不出去。groups 列默认组（group 为「默认」）、全部任务组和已经撤掉但还记着状态的组：source 是 default / command（qq-bot.group.add 登记）/ plugin（插件注册），组撤掉或默认组没绑定时 title、workspace、agent、source 为 null；session 是 { agent, workspace, id, rounds }，round 是在做的一轮 { id, turn, agent, workspace, session }；undelivered 是没送达的结果条数' },
      async () => {
        const rounds = this.rounds
        const chats = rounds === null ? [] : await rounds.summary()
        return { ok: true, data: { gateway: this.gateway.currentState, appIdConfigured: readString(this.setting('app-id')) !== '', appSecretSet: readString(this.setting('app-secret')) !== '', sandbox: this.setting('sandbox') === true, executors: this.executors.ids(), chats, recentRejected: rounds?.recentRejected ?? [] } }
      },
    )
    commands.register(
      { name: 'qq-bot.reconnect', description: '改完 AppID / AppSecret / 旧沙箱接口设置后调它：断开当前网关连接并按新设置重连', usage: '无参数。AppID / AppSecret 没配置时报错，不连接', effect: 'write' },
      async () => {
        this.gateway.stop()
        this.rest.resetAuth()
        await this.rounds?.dispose()
        this.rounds = null
        if (!(await this.connect())) throw new Error('AppID / AppSecret 没配置：先到设置的 qq-bot 分区填好再重连')
        return { ok: true, data: { gateway: this.gateway.currentState } }
      },
    )
    commands.register(
      { name: 'qq-bot.bind', description: '设一个私聊的默认组：直接发的文字在哪个目录、交给哪个执行端', effect: 'write',
        usage: '{ chat: string, workspace: string, title: string, agent?: "zcode" | "claudecode", instructions?: string }。chat 是 qq-bot.status 里私聊的 id；workspace 是已存在目录的绝对路径；title 是回执里叫它的名字；agent 缺省 zcode，必须是装着的执行端；instructions 原样附在任务说明的「[任务组要求]」一段里。只看默认组：默认组还有在做或排队的任务时拒绝，别的组不受影响。改绑后默认组下一条开新会话。回这个私聊的记录' },
      async (raw) => ({ ok: true, data: await this.requireRounds().bind(raw) }),
    )
    commands.register(
      { name: 'qq-bot.unbind', description: '解除一个私聊的默认组绑定，之后直接发的文字不再派出', usage: '{ chat: string }。默认组还有在做或排队的任务时拒绝；任务组照常能用。主人私聊解绑后默认组仍按设置 default-workspace 派出，要停就把那项设置清空。回这个私聊的记录', effect: 'write' },
      async (raw) => ({ ok: true, data: await this.requireRounds().unbind(raw) }),
    )
    commands.register(
      { name: 'qq-bot.group.add', description: '登记一个任务组：私聊里发「/命令 任务」，任务交给这个组的执行端在组的目录里做', effect: 'write',
        usage: '{ command: string, title: string, workspace: string, agent: "zcode" | "claudecode", instructions?: string, idleHours?: number }。command 以 / 开头、不含空白，去掉斜杠后汉字算 2、其余算 1，总长不超过 16；/帮助、/状态、/新会话 是保留命令；和已有的任何命令重名都拒绝。去掉斜杠就是组名（/新会话 <组名> 用）。title 是回执里叫它的名字；workspace 是已存在目录的绝对路径；agent 必须是装着的执行端；instructions 原样附在任务说明的「[任务组要求]」一段里；idleHours 是正数，空闲超过这么多小时下一条开新会话，不给就用设置 idle-hours。白名单里的每个私聊都能用，各记各的会话。存在聊天表里，要先连上 QQ。回登记下的组' },
      async (raw) => ({ ok: true, data: await this.requireRounds().addGroup(raw) }),
    )
    commands.register(
      { name: 'qq-bot.group.remove', description: '删掉一个用 qq-bot.group.add 登记的任务组', effect: 'write',
        usage: '{ command: string }。只删命令登记的组；插件注册的组由那个插件撤掉，这里报错并写明来源。这个组在任何私聊里还有在做或排队的任务时拒绝。回删掉的组' },
      async (raw) => ({ ok: true, data: await this.requireRounds().removeGroup(raw) }),
    )
    commands.register(
      { name: 'qq-bot.group.list', description: '列出全部任务组与直接命令，标明来源', effect: 'read',
        usage: '无参数。回 { groups, directCommands }。groups 第一项是默认组 { group: "默认", command: null, source: "default", chats: [{ chat, binding, bindingFromDefault }] }，其余每项 { group, command, title, workspace, agent, instructions?, idleHours?, source, plugin? }，source 是 command（qq-bot.group.add 登记）或 plugin（插件注册，plugin 是插件包名，取不到就没有这一项）；directCommands 每项 { command, description, source: "plugin", plugin? }。要先连上 QQ' },
      async () => ({ ok: true, data: await this.requireRounds().listGroups() }),
    )
    commands.register(
      { name: 'qq-bot.report', description: '执行任务的 agent 做完后提交这一轮的结果，qq-bot 发回原私聊', effect: 'external',
        usage: '{ round: string, text: string }。round 是任务说明里给的本轮编号；text 是给手机看的结果，1–2000 字，超了报错、缩短后用同一个编号再交。回 { recorded: true, duplicate }：recorded 表示已经记下，发回 QQ 在后台做（发不出去就记下，等人发 /状态 补发）。调用超时就用同样的参数再调一次；同一轮交不同的内容会被拒绝' },
      async (raw) => ({ ok: true, data: await this.requireRounds().report(raw) }),
    )
    commands.register(
      { name: 'qq-bot.notify', description: '主动私聊这台机器的主人一条通知，同一个 id 不重复发', effect: 'external',
        usage: '{ id: string, text: string }。text 1–600 字；主人是设置 owner-openid，须在白名单里；发不出去不重发。回 { delivered, duplicate }' },
      async (raw) => {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('qq-bot.notify 要 { id, text }')
        const args = raw as Record<string, unknown>
        const unknown = Object.keys(args).filter((key) => key !== 'id' && key !== 'text')
        if (unknown.length > 0) throw new Error(`qq-bot.notify 不认识参数 ${unknown.join('、')}，只收 id、text`)
        if (typeof args['id'] !== 'string' || typeof args['text'] !== 'string') throw new Error('qq-bot.notify 要 { id: string, text: string }')
        return { ok: true, data: await this.notify(args['id'], args['text']) }
      },
    )
  }

  private async dispose(): Promise<void> {
    this.disposed = true
    this.gateway.stop()
    await this.rounds?.dispose()
  }
}

declare module 'cordis' {
  interface Context {
    gwbQqBot: GwbQqBotApi
  }
}
