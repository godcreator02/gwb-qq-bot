/** QQ 来源路由的门面：命令入口、来源身份与绑定；排队派单在 book.ts，结果投递在 channel.ts。 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AgentAdapter } from './agents.js'
import { JobBook, TaskLedger, defaultAdapters } from './book.js'
import { QqChannel, BOT_REPLY_PREFIX } from './channel.js'
import { activeConversation, jobAwaitingOutcome, jobBelongsToSource, sourceId, stringField, workspaceKey, type Book, type Source, type Binding, type Job, type Notice, type Route } from './conversations.js'
import { isRecord, type IncomingMessage, type QqLog } from './qq-protocol.js'
import type { SendOutcome } from './qq-rest.js'
import { countProbeContent, lengthProbeContent, type ProbeArgs } from './probe.js'
import { matchCommand, normalizeIncoming, tailExcerpt } from './routing.js'

type GwbResult = { ok: boolean; data?: unknown; error?: string }
export interface BridgeDeps {
  home: string
  agents?: AgentAdapter[]
  appId(): string
  runCommand(name: string, args: Record<string, unknown>): Promise<GwbResult>
  defaultWorkspace(): string
  allowedOpenids(): string[]
  reportServer(): string
  journalLibrary(): string
  ownerOpenid(): string
  read(): Promise<unknown>
  write(value: unknown): Promise<void>
  sendC2c(openid: string, content: string, msgId: string | undefined, msgSeq: number | undefined): Promise<SendOutcome>
  sendGroup(groupOpenid: string, content: string, msgId: string | undefined, msgSeq: number | undefined): Promise<SendOutcome>
  log: QqLog
}
const HELP_TEXT = 'QQ → agent：\n· 群聊绑定协作项目后，直接 @我 说任务；群内共享项目上下文\n· 私聊使用独立个人会话，可以说“记一下：…”\n· /状态 查当前聊天任务与未送达结果\n· /新会话 重开当前聊天的上下文\n· 未绑定的来源请在 GWB 用 qq-bot.sources / qq-bot.bind 配置\n做完直接调用 qq-bot.report 回报；执行环境需要可用。'

export class ChatBridge {
  private readonly ledger: TaskLedger
  private readonly channel: QqChannel
  private readonly jobs: JobBook
  private lastIncoming: Route | null = null
  private readonly recentRejected: { openid: string; scene: string; at: string; excerpt: string }[] = []

  constructor(private readonly deps: BridgeDeps) {
    this.ledger = new TaskLedger({ home: deps.home, appId: deps.appId, read: deps.read, write: deps.write })
    this.channel = new QqChannel({ home: deps.home, appId: deps.appId, sendC2c: deps.sendC2c, sendGroup: deps.sendGroup }, this.ledger)
    const agents = deps.agents ?? defaultAdapters(deps.runCommand)
    this.jobs = new JobBook({ home: deps.home, appId: deps.appId, runCommand: deps.runCommand, log: deps.log }, this.ledger, this.channel, agents)
  }
  private get book(): Book { return this.ledger.book }
  private serial<T>(run: () => Promise<T>): Promise<T> { return this.ledger.serial(run) }
  private async save(): Promise<void> { await this.ledger.save() }
  private belongs(job: Job, source: Source): boolean { return jobBelongsToSource(job, source, this.book.conversations) }
  private observe(message: IncomingMessage): Source {
    const identity = { home: this.deps.home, appId: this.deps.appId(), scene: message.scene, target: message.replyTarget }
    const id = sourceId(identity)
    let source = this.book.sources.find((each) => each.id === id)
    if (source === undefined) {
      source = { ...identity, id, lastSeen: '', lastSender: '', generation: 0, binding: null }
      this.book.sources.push(source)
    }
    source.lastSeen = new Date().toISOString(); source.lastSender = message.senderOpenid
    // 只有显式配置的主人私聊能继承个人默认值；解绑后 generation > 0，不自动重新绑定。
    if (source.binding === null && source.generation === 0 && source.scene === 'c2c' && source.target === this.deps.ownerOpenid() && this.deps.defaultWorkspace() !== '') {
      source.binding = { agent: 'zcode', kind: 'personal', workspace: this.deps.defaultWorkspace(), projectRepo: null, title: '个人空间', journalLibrary: this.deps.journalLibrary() }
      source.generation++
    }
    return source
  }
  async sources(): Promise<Source[]> { return this.serial(async () => structuredClone(this.book.sources.filter((source) => this.ledger.isCurrent(source)))) }
  private requireIdle(source: Source): void {
    if (this.book.jobs.some((job) => job.sourceId === source.id && jobAwaitingOutcome(job))) throw new Error('这个聊天还有排队、执行中或派单未确认的任务，暂不能更换绑定或会话')
  }
  async bind(raw: unknown): Promise<Source> {
    if (!isRecord(raw) || Object.keys(raw).some((key) => !['sourceId', 'projectRepo', 'workspace', 'journalLibrary', 'agent'].includes(key))) throw new Error('绑定参数应为 {sourceId, projectRepo?（群）, workspace?（私聊）, journalLibrary?,agent?}')
    const id = stringField(raw, 'sourceId')
    if (raw.journalLibrary !== undefined && typeof raw.journalLibrary !== 'string') throw new Error('journalLibrary 应为字符串')
    const snapshot = await this.serial(async () => structuredClone(this.ledger.findSource(id)))
    const agent = raw.agent === undefined ? snapshot.binding?.agent ?? 'zcode' : stringField(raw, 'agent')
    if (!this.jobs.has(agent)) throw new Error('未支持的 agent；请用 qq-bot.agents 查看可选接口')
    let binding: Binding
    if (snapshot.scene === 'group') {
      if (raw.workspace !== undefined) throw new Error('群工作区取自项目，不另收 workspace')
      const repo = stringField(raw, 'projectRepo')
      const result = await this.deps.runCommand('collab.projects', {})
      if (!result.ok || !isRecord(result.data) || !Array.isArray(result.data.projects)) throw new Error('无法读取本 home 的协作站项目列表')
      const project: unknown = result.data.projects.find((row: unknown) => isRecord(row) && typeof row.repo === 'string' && workspaceKey(row.repo) === workspaceKey(repo))
      if (!isRecord(project) || project.error !== null || !isRecord(project.summary) || typeof project.repo !== 'string' || typeof project.summary.title !== 'string') throw new Error('群只能绑定本 home 已登记且可用的协作项目')
      binding = { agent, kind: 'project', workspace: project.repo, projectRepo: project.repo, title: project.summary.title, journalLibrary: typeof raw.journalLibrary === 'string' ? raw.journalLibrary.trim() : '' }
    } else {
      if (raw.projectRepo !== undefined) throw new Error('私聊个人空间使用 workspace，不使用 projectRepo')
      const workspace = stringField(raw, 'workspace')
      if (!path.win32.isAbsolute(workspace) && !path.posix.isAbsolute(workspace)) throw new Error('workspace 必须是绝对路径')
      binding = { agent, kind: 'personal', workspace, projectRepo: null, title: '个人空间', journalLibrary: typeof raw.journalLibrary === 'string' ? raw.journalLibrary.trim() : '' }
    }
    await this.verifyJournalLibrary(binding.journalLibrary)
    return this.serial(async () => {
      const source = this.ledger.findSource(id)
      this.requireIdle(source)
      if (JSON.stringify(source.binding) === JSON.stringify(binding)) return structuredClone(source)
      if (source.generation !== snapshot.generation) throw new Error('绑定已被另一操作修改，请重新读取来源')
      source.binding = binding; source.generation++
      await this.save()
      return structuredClone(source)
    })
  }
  async unbind(raw: unknown): Promise<Source> {
    if (!isRecord(raw) || Object.keys(raw).some((key) => key !== 'sourceId')) throw new Error('解绑参数应为 {sourceId}')
    const id = stringField(raw, 'sourceId')
    return this.serial(async () => {
      const source = this.ledger.findSource(id); this.requireIdle(source)
      source.binding = null; source.generation++
      await this.save(); return structuredClone(source)
    })
  }
  /** 绑定时核对随手记库（群与私聊同一套）：经命令总线问 block-note，库要存在、且对日志插件开放；留空表示不用笔记库，不查。 */
  private async verifyJournalLibrary(library: string): Promise<void> {
    if (library === '') return
    const result = await this.deps.runCommand('block-note.lib.list', {})
    if (!result.ok || !Array.isArray(result.data)) throw new Error(`读不到笔记库列表（block-note.lib.list 失败）：${result.ok ? '回执形状不符' : result.error ?? '命令失败'}`)
    const lib: unknown = result.data.find((row: unknown) => isRecord(row) && row.id === library)
    if (lib === undefined) throw new Error(`库不存在：${library}`)
    const plugins = isRecord(lib) ? lib.plugins : undefined
    if (!Array.isArray(plugins) || !plugins.includes('@godcreator/gwb-bn-journal')) throw new Error(`库 ${library} 未开放日志插件`)
  }
  async switchAgent(raw: unknown): Promise<Source> {
    if (!isRecord(raw) || Object.keys(raw).some((key) => !['sourceId', 'agent'].includes(key))) throw new Error('切换参数应为 {sourceId,agent}')
    const id = stringField(raw, 'sourceId'), agent = stringField(raw, 'agent')
    this.jobs.agent(agent)
    return this.serial(async () => {
      const source = this.ledger.findSource(id)
      this.requireIdle(source)
      if (source.binding === null) throw new Error('请先绑定本聊天的项目或工作区')
      if (source.binding.agent !== agent) { source.binding.agent = agent; source.generation++; await this.save() }
      return structuredClone(source)
    })
  }
  async restore(): Promise<void> {
    await this.serial(async () => { await this.save() })
    this.jobs.scheduleResults()
    await this.jobs.pump()
  }
  agentOptions(): { id: string; title: string }[] { return this.jobs.agentOptions() }
  receiveReport(raw: unknown): Promise<{ recorded: true; duplicate: boolean; delivery: Job['delivery'] }> { return this.jobs.receiveReport(raw) }
  resolve(raw: unknown): Promise<{ resolved: true; duplicate: boolean }> { return this.jobs.resolve(raw) }
  async handleIncoming(message: IncomingMessage): Promise<void> {
    if (this.ledger.closing) throw new Error('QQ 通道正在卸载')
    const incomingAppId = this.deps.appId()
    await this.serial(async () => {
      if (incomingAppId !== this.deps.appId()) { this.deps.log.warn('丢弃重连前排队的旧机器人事件'); return }
      if (!this.deps.allowedOpenids().includes(message.senderOpenid)) {
        this.recentRejected.push({ openid: message.senderOpenid, scene: message.scene, at: new Date().toISOString(), excerpt: message.content.slice(0, 40) })
        if (this.recentRejected.length > 10) this.recentRejected.shift()
        this.deps.log.info(`拒绝白名单外的 ${message.scene} 消息，openid=${message.senderOpenid}`)
        return
      }
      const text = normalizeIncoming(message.content)
      if (text === '' || (message.senderIsBot === true && text.startsWith(BOT_REPLY_PREFIX))) return
      const source = this.observe(message)
      const key = JSON.stringify([source.id, message.msgId])
      if (this.book.seen.includes(key)) return
      this.book.seen.push(key); if (this.book.seen.length > 10000) this.book.seen.shift()
      const route: Route = { appId: source.appId, scene: source.scene, target: source.target, trigger: { msgId: message.msgId, receivedAt: Date.now(), repliesSent: 0 } }
      this.lastIncoming = route
      await this.save()
      const command = matchCommand(text)
      if (command === 'help') { await this.reply(HELP_TEXT, route); return }
      if (command === 'status') { await this.status(source, route); return }
      if (command !== null) { await this.fresh(source, route); return }
      const binding = source.binding
      if (binding === null) { await this.reply('这个聊天还未绑定工作区，请在 GWB 用 qq-bot.sources 找到来源，再用 qq-bot.bind 绑定项目或个人空间。', route); return }
      let conversation = activeConversation(this.book, source)
      if (conversation === undefined) {
        conversation = { agent: binding.agent, id: randomUUID(), sourceId: source.id, generation: source.generation, workspace: binding.workspace, taskId: null, roundIndex: 0, latest: null }
        this.book.conversations.push(conversation)
      }
      const job: Job = { agent: binding.agent, ticketHash: null, dispatch: 'queued', id: randomUUID(), openid: message.senderOpenid, sourceId: source.id, conversationId: conversation.id, taskId: null, workspace: binding.workspace, round: ++conversation.roundIndex, route,
        source: { home: source.home, appId: source.appId, scene: source.scene, target: source.target, senderOpenid: message.senderOpenid, senderIsBot: message.senderIsBot === true, projectRepo: binding.projectRepo, title: binding.title, journalLibrary: binding.journalLibrary },
        prompt: text, reportServer: this.deps.reportServer(), state: 'queued', text: null, delivery: 'pending' }
      conversation.latest = job.id; this.book.jobs.push(job)
      await this.save()
      try { await this.reply(`已接收 ${binding.title} 第 ${job.round} 轮任务，按工作区顺序处理；做完主动回你。`, route) }
      catch (error) {
        if (this.ledger.storageError !== undefined) throw error
        this.deps.log.warn(`任务 ${job.id} 已入队，但接收确认发送失败；继续派单`)
      }
    })
    await this.jobs.pump()
  }
  private async status(source: Source, route: Route): Promise<void> {
    const jobs = this.book.jobs.filter((job) => this.belongs(job, source))
    const pending = jobs.filter((job) => job.text !== null && ['pending', 'undelivered'].includes(job.delivery))
    if (pending.length > 0) {
      for (const job of pending) {
        if (await this.reply(`${job.conversationId === null ? '历史任务' : `第 ${job.round} 轮`}结果：\n${tailExcerpt(job.text ?? '', 600)}`, route)) job.delivery = 'delivered'
        else break
        await this.save()
      }
      return
    }
    const conversation = activeConversation(this.book, source)
    const latest = jobs.findLast((job) => job.id === conversation?.latest) ?? (source.generation === 0 ? jobs.at(-1) : undefined)
    const running = jobs.find((job) => jobAwaitingOutcome(job) && job.state !== 'queued')
    const queued = jobs.filter((job) => job.state === 'queued').length
    const job = running ?? latest
    if (job === undefined) { await this.reply(source.binding === null ? '当前聊天未绑定工作区。' : `${source.binding.title} 还没有任务，直接说需求即可。`, route); return }
    if (job.text !== null) { await this.reply(`上一轮结果：\n${tailExcerpt(job.text, 600)}`, route); return }
    if (job.state === 'queued') { await this.reply(`当前聊天有 ${queued} 个排队任务，等待同工作区前一任务回报。`, route); return }
    if (job.taskId === null) { await this.reply(`派单尚未确认，后续 ${queued} 个任务排队；请查看执行端，未自动重发。`, route); return }
    try {
      const status = await this.jobs.agent(job.agent).inspect({ workspace: job.workspace, sessionRef: job.taskId })
      await this.reply(`本轮尚未收到主动回报；排队 ${queued} 个。${this.jobs.agent(job.agent).title}：\n${tailExcerpt(status, 600)}`, route)
    } catch { await this.reply('执行端状态暂不可用；本轮记录保留，没有自动重发。', route) }
  }
  private async fresh(source: Source, route: Route): Promise<void> {
    try { this.requireIdle(source) } catch (error) { await this.reply(String(error), route); return }
    if (source.binding !== null) this.book.conversations.push({ agent: source.binding.agent, id: randomUUID(), sourceId: source.id, generation: source.generation, workspace: source.binding.workspace, taskId: null, roundIndex: 0, latest: null })
    await this.save(); await this.reply('下一条消息起使用当前聊天的新会话；本次绑定下未送达的旧结果仍可用 /状态 取回。', route)
  }
  notify(raw: unknown): Promise<{ delivered: boolean; duplicate: boolean }> {
    return this.serial(async () => {
      if (!isRecord(raw) || Object.keys(raw).some((key) => !['id', 'text'].includes(key)) || typeof raw.id !== 'string' || raw.id.trim() === '' || typeof raw.text !== 'string' || raw.text.trim() === '' || raw.text.length > 600) throw new Error('qq-bot.notify 需要 {id, text}，正文 1–600 字符')
      const target = this.deps.ownerOpenid(), appId = this.deps.appId()
      if (target === '' || !this.deps.allowedOpenids().includes(target)) throw new Error('请显式配置主人私聊 owner-openid，并将其加入 allowed-openids')
      const existing = this.book.notices.find((notice) => notice.id === raw.id && notice.appId === appId)
      if (existing !== undefined) {
        if (existing.text !== raw.text || existing.target !== target) throw new Error('通知 id 已用于不同内容或收件人')
        return { delivered: existing.state === 'delivered', duplicate: true }
      }
      const notice: Notice = { id: raw.id, appId, target, text: raw.text, state: 'sending' }
      this.book.notices.push(notice); await this.save()
      try { notice.state = (await this.deps.sendC2c(target, raw.text, undefined, undefined)).ok ? 'delivered' : 'failed' }
      catch { notice.state = 'failed' }
      await this.save(); return { delivered: notice.state === 'delivered', duplicate: false }
    })
  }
  private reply(text: string, route: Route): Promise<boolean> { return this.channel.reply(text, route) }
  report() {
    const conversations = this.book.conversations.filter((c) => this.book.sources.some((s) => s.id === c.sourceId && this.ledger.isCurrent(s))).map((c) => {
      const source = this.book.sources.find((s) => s.id === c.sourceId)!
      const job = this.book.jobs.find((j) => j.id === c.latest)
      return { ...c, scene: source.scene, target: source.target, appId: source.appId, title: source.binding?.title ?? null, roundRunning: this.book.jobs.some((j) => j.conversationId === c.id && jobAwaitingOutcome(j)), resultDelivered: job === undefined || job.delivery === 'delivered' }
    })
    const unresolvedTasks = this.book.jobs.filter((j) => j.dispatch === 'unknown' && j.source.home === this.deps.home && j.source.appId === this.deps.appId()).map((j) => ({ jobId: j.id, sourceId: j.sourceId, taskId: j.taskId, workspace: j.workspace }))
    return { conversations, sources: structuredClone(this.book.sources.filter((s) => this.ledger.isCurrent(s))), queuedTasks: this.book.jobs.filter((j) => j.state === 'queued').length, unresolvedTasks, pendingResults: this.book.jobs.filter((job) => job.text !== null && job.delivery !== 'delivered').length, recentRejected: [...this.recentRejected] }
  }
  async dispose(): Promise<void> {
    // 先等已发出的桌面调用记账，关闭后不再调度排队任务。
    this.ledger.closing = true
    await this.ledger.settle()
    await this.jobs.waitWorkers()
    await this.ledger.settle()
    this.ledger.closed = true
  }
  probe(args: ProbeArgs): Promise<{ experiment: 'count' | 'length'; scene: string; results: unknown[] }> {
    return this.serial(async () => {
      if (this.lastIncoming === null || this.lastIncoming.appId !== this.deps.appId()) throw new Error('先在 QQ 上发送一条白名单消息')
      const route = this.lastIncoming, { scene, trigger } = route
      if (args.experiment === 'length' && scene === 'group') throw new Error('length 只在私聊测')
      const results: unknown[] = [], values = args.experiment === 'count' ? Array.from({ length: args.sends }, (_, i) => i + 1) : args.chars
      for (const value of values) {
        const msgSeq = trigger.repliesSent + 1
        const text = args.experiment === 'count' ? countProbeContent(value, args.sends, msgSeq) : lengthProbeContent(value)
        if (args.experiment === 'count') { trigger.repliesSent++; await this.save() }
        const outcome = await this.channel.send(route, text, args.experiment === 'count' ? trigger.msgId : undefined, args.experiment === 'count' ? msgSeq : undefined)
        results.push(args.experiment === 'count' ? { index: value, msgSeq, ...outcome } : { chars: value, ...outcome })
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      return { experiment: args.experiment, scene, results }
    })
  }
}
