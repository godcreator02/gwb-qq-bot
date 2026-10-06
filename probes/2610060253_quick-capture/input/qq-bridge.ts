/** QQ 通道：逐条派单、保存每轮回复地址、接收 ZCode 主动回报；不轮询任务。 */
import { randomUUID } from 'node:crypto'
import { isRecord, type IncomingMessage, type MessageScene, type QqLog } from './qq-protocol.js'
import type { SendOutcome } from './qq-rest.js'
import { countProbeContent, lengthProbeContent, type ProbeArgs } from './probe.js'
import { matchCommand, normalizeIncoming, splitForSend, tailExcerpt } from './routing.js'
import { chooseReplyRoute, type ReplyTrigger } from './reply-window.js'

type GwbResult = { ok: boolean; data?: unknown; error?: string }
export interface BridgeDeps {
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
const BOT_REPLY_PREFIX = '【机器人回执】'
const HELP_TEXT = 'QQ → ZCode 通道：\n· 直接说任务，或说“记一下：…”“记个待办：…”\n· /状态 查进度、取回未送达结果\n· /新会话 换一个 ZCode 会话\n· /帮助 看说明\n做完由 ZCode 主动回报；桌面端需要开着。'
interface Route { scene: MessageScene; target: string; trigger: ReplyTrigger }
interface Session { openid: string; workspace: string; taskId: string | null; roundIndex: number; latest: string | null }
interface Job {
  id: string; openid: string; taskId: string | null; workspace: string; round: number; route: Route
  state: 'pending' | 'dispatch_unknown' | 'completed' | 'failed' | 'needs_input'
  text: string | null; delivery: 'pending' | 'sending' | 'delivered' | 'undelivered'
}
interface Notice { id: string; target: string; text: string; state: 'sending' | 'delivered' | 'failed' }
interface Book { version: 1; sessions: Session[]; jobs: Job[]; seen: string[]; notices: Notice[] }

export class ZcodeBridge {
  private book: Book = { version: 1, sessions: [], jobs: [], seen: [], notices: [] }
  private queue: Promise<unknown>
  private closed = false
  private storageError: unknown
  private lastIncoming: Route | null = null
  private readonly recentRejected: { openid: string; scene: string; at: string; excerpt: string }[] = []

  constructor(private readonly deps: BridgeDeps) {
    this.queue = deps.read().then((raw) => {
      if (raw === undefined) return
      if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.sessions) || !Array.isArray(raw.jobs) || !Array.isArray(raw.seen) || !Array.isArray(raw.notices)) throw new Error('QQ 任务记录格式不正确，停止处理')
      this.book = raw as unknown as Book
    }).catch((error: unknown) => { this.storageError = error; throw error })
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => {
      if (this.storageError !== undefined) throw this.storageError
      if (this.closed) throw new Error('QQ 通道已卸载')
      return run()
    })
    this.queue = next.catch(() => {})
    return next
  }
  private async save(): Promise<void> {
    try { await this.deps.write(this.book) } catch (error) { this.storageError = error; throw error }
  }
  async restore(): Promise<void> {
    await this.serial(async () => {
      // sending 的发送结果不确定，不自动重发；用户 /状态 可借新消息取回。
      for (const job of this.book.jobs) if (job.text !== null && job.delivery === 'pending') await this.deliverJob(job)
    })
    const outcome = await this.deps.runCommand('zcode.report.replay', { callback: 'qq-bot.receive-report' })
    if (!outcome.ok) this.deps.log.warn('ZCode 回报补交入口暂不可用；安装新版 ZCode 后重连 QQ 通道')
  }
  handleIncoming(message: IncomingMessage): Promise<void> {
    return this.serial(async () => {
      if (!this.deps.allowedOpenids().includes(message.senderOpenid)) {
        this.recentRejected.push({ openid: message.senderOpenid, scene: message.scene, at: new Date().toISOString(), excerpt: message.content.slice(0, 40) })
        if (this.recentRejected.length > 10) this.recentRejected.shift()
        this.deps.log.info(`拒绝白名单外的 ${message.scene} 消息，openid=${message.senderOpenid}`)
        return
      }
      const text = normalizeIncoming(message.content)
      if (text === '' || (message.senderIsBot === true && text.startsWith(BOT_REPLY_PREFIX))) return
      const key = `${message.scene}:${message.replyTarget}:${message.msgId}`
      if (this.book.seen.includes(key)) return
      this.book.seen.push(key)
      if (this.book.seen.length > 10000) this.book.seen.shift()
      const route: Route = { scene: message.scene, target: message.replyTarget, trigger: { msgId: message.msgId, receivedAt: Date.now(), repliesSent: 0 } }
      this.lastIncoming = route
      const session = this.sessionFor(message.senderOpenid)
      await this.save()
      const command = matchCommand(text)
      if (command === 'help') { await this.reply(HELP_TEXT, route); return }
      if (command === 'status') { await this.status(session, route); return }
      if (command !== null) { await this.fresh(session, route); return }
      await this.dispatch(session, route, text)
    })
  }
  private sessionFor(openid: string): Session {
    let session = this.book.sessions.find((each) => each.openid === openid)
    if (session === undefined) { session = { openid, workspace: '', taskId: null, roundIndex: 0, latest: null }; this.book.sessions.push(session) }
    return session
  }
  private latest(session: Session): Job | undefined { return this.book.jobs.find((job) => job.id === session.latest) }

  private async dispatch(session: Session, route: Route, text: string): Promise<void> {
    const workspace = session.taskId === null ? this.deps.defaultWorkspace() : session.workspace
    if (workspace === '') { await this.reply('请先在 qq-bot 设置中填写 default-workspace', route); return }
    const job: Job = { id: randomUUID(), openid: session.openid, taskId: session.taskId, workspace, round: session.roundIndex + 1, route, state: 'pending', text: null, delivery: 'pending' }
    session.latest = job.id
    session.workspace = workspace
    session.roundIndex = job.round
    this.book.jobs.push(job)
    await this.save()
    const lib = this.deps.journalLibrary()
    const noteContext = lib === '' ? '' : `\n\n[随手记约定] 用户要求记录或待办时，使用 ${this.deps.reportServer()} MCP 服务中的 bn-journal / block-note 命令，写入库 ${JSON.stringify(lib)} 的当日日志。先读 bn-journal 说明书，记录保留原话；创建成功、取得块 id 后才报告已保存。不属于记录请求时忽略本约定。`
    const args: Record<string, unknown> = { workspace, prompt: text + noteContext, report: { id: job.id, callback: 'qq-bot.receive-report', server: this.deps.reportServer() } }
    if (session.taskId !== null) args.task = session.taskId
    let outcome: GwbResult
    try { outcome = await this.deps.runCommand(session.taskId === null ? 'zcode.create' : 'zcode.send', args) }
    catch (error) { outcome = { ok: false, error: String(error) } }
    if (!outcome.ok || !isRecord(outcome.data) || typeof outcome.data.taskId !== 'string') {
      job.state = 'dispatch_unknown'
      await this.save()
      await this.reply(`派单未确认：${outcome.error ?? '缺少 taskId'}。这轮记录已保留；先在 ZCode 侧栏确认，避免重复派发。`, route)
      return
    }
    job.taskId = outcome.data.taskId
    session.taskId = job.taskId
    await this.save()
    await this.reply(`收到，已派给 ZCode 会话 ${job.taskId} 第 ${job.round} 轮；做完主动回你`, route)
  }

  receiveReport(raw: unknown): Promise<{ accepted: true }> {
    return this.serial(async () => {
      if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.taskId !== 'string' || typeof raw.text !== 'string' || !['completed', 'failed', 'needs_input'].includes(String(raw.state))) throw new Error('ZCode 回报格式不正确')
      const job = this.book.jobs.find((each) => each.id === raw.id)
      if (job === undefined || raw.workspace !== job.workspace || (job.taskId !== null && raw.taskId !== job.taskId)) throw new Error('回报不属于本 home 的这轮 QQ 任务')
      if (job.text !== null) {
        if (job.text !== raw.text || job.state !== raw.state) throw new Error('这轮 QQ 任务已有不同结果')
        return { accepted: true }
      }
      job.taskId = raw.taskId
      job.state = raw.state as Job['state']
      job.text = raw.text
      const session = this.sessionFor(job.openid)
      if (session.latest === job.id) session.taskId = job.taskId
      await this.save()
      await this.deliverJob(job)
      return { accepted: true }
    })
  }
  private async deliverJob(job: Job): Promise<void> {
    job.delivery = 'sending'
    await this.save()
    const heading = job.state === 'needs_input' ? '需要你回复：\n' : job.state === 'failed' ? '任务未完成：\n' : ''
    try { job.delivery = await this.reply(heading + tailExcerpt(job.text ?? '', 600), job.route) ? 'delivered' : 'undelivered' }
    catch { job.delivery = 'undelivered'; this.deps.log.warn(`任务 ${job.id} 的结果已保存，QQ 发送失败，等 /状态 取回`) }
    await this.save()
  }
  private async status(session: Session, route: Route): Promise<void> {
    const pending = this.book.jobs.filter((job) => job.openid === session.openid && job.text !== null && job.delivery !== 'delivered')
    if (pending.length > 0) {
      for (const job of pending) {
        if (await this.reply(`第 ${job.round} 轮结果：\n${tailExcerpt(job.text ?? '', 600)}`, route)) job.delivery = 'delivered'
        else break
        await this.save()
      }
      return
    }
    const job = this.latest(session)
    if (job?.text !== null && job?.text !== undefined) { await this.reply(`上一轮结果：\n${tailExcerpt(job.text, 600)}`, route); return }
    if (session.taskId === null) { await this.reply(job ? '派单尚未确认，请查看 ZCode 侧栏；本轮仍保留，未自动重发。' : '还没有会话，直接说任务即可。', route); return }
    const outcome = await this.deps.runCommand('zcode.status', { workspace: session.workspace, task: session.taskId, waitSeconds: 0, replyTailChars: 600 })
    const data = isRecord(outcome.data) ? outcome.data : {}
    const replies = Array.isArray(data.replies) ? data.replies.filter((reply): reply is string => typeof reply === 'string') : []
    await this.reply(outcome.ok ? `本轮尚未收到主动回报。ZCode 当前状态：${String(data.status ?? '未知')}\n${tailExcerpt(replies.at(-1) ?? '', 600)}` : `查询失败：${outcome.error ?? '未知原因'}`, route)
  }
  private async fresh(session: Session, route: Route): Promise<void> {
    if (session.taskId !== null) {
      const result = await this.deps.runCommand('zcode.archive', { workspace: session.workspace, task: session.taskId })
      if (!result.ok) { await this.reply(`暂时不能换会话：${result.error ?? '旧会话未能归档'}`, route); return }
    }
    session.taskId = null; session.latest = null; session.roundIndex = 0
    await this.save()
    await this.reply('下一条消息起使用新的 ZCode 会话；未送达的旧结果仍可用 /状态 取回。', route)
  }

  notify(raw: unknown): Promise<{ delivered: boolean; duplicate: boolean }> {
    return this.serial(async () => {
      if (!isRecord(raw) || Object.keys(raw).some((key) => !['id', 'text'].includes(key)) || typeof raw.id !== 'string' || raw.id.trim() === '' || typeof raw.text !== 'string' || raw.text.trim() === '' || raw.text.length > 600) throw new Error('qq-bot.notify 需要 {id, text}，正文 1–600 字符')
      const target = this.deps.ownerOpenid()
      if (target === '' || !this.deps.allowedOpenids().includes(target)) throw new Error('请显式配置主人私聊 owner-openid，并将其加入 allowed-openids')
      const existing = this.book.notices.find((notice) => notice.id === raw.id)
      if (existing !== undefined) {
        if (existing.text !== raw.text || existing.target !== target) throw new Error('通知 id 已用于不同内容或收件人')
        return { delivered: existing.state === 'delivered', duplicate: true }
      }
      const notice: Notice = { id: raw.id, target, text: raw.text, state: 'sending' }
      this.book.notices.push(notice)
      await this.save()
      try { notice.state = (await this.deps.sendC2c(target, raw.text, undefined, undefined)).ok ? 'delivered' : 'failed' }
      catch { notice.state = 'failed' }
      await this.save()
      return { delivered: notice.state === 'delivered', duplicate: false }
    })
  }
  private async reply(text: string, route: Route): Promise<boolean> {
    for (const segment of splitForSend(text, 700)) {
      const chosen = chooseReplyRoute(route.scene, route.trigger, Date.now())
      if (chosen.kind === 'none') return false
      if (chosen.kind === 'passive') {
        route.trigger.repliesSent += 1
        await this.save()
        const sent = await this.send(route.scene, route.target, segment, chosen.msgId, chosen.msgSeq)
        if (sent.ok) continue
        if (route.scene === 'group') return false
      }
      if (!(await this.send(route.scene, route.target, segment, undefined, undefined)).ok) return false
    }
    return true
  }
  private send(scene: MessageScene, target: string, text: string, msgId: string | undefined, msgSeq: number | undefined): Promise<SendOutcome> {
    return scene === 'c2c' ? this.deps.sendC2c(target, text, msgId, msgSeq) : this.deps.sendGroup(target, `${BOT_REPLY_PREFIX}\n${text}`, msgId, msgSeq)
  }
  report() {
    return { sessions: this.book.sessions.map((session) => {
      const job = this.latest(session)
      return { openid: session.openid, taskId: session.taskId, workspace: session.workspace, roundIndex: session.roundIndex, roundRunning: job !== undefined && job.text === null, resultDelivered: job === undefined || job.delivery === 'delivered' }
    }), pendingResults: this.book.jobs.filter((job) => job.text !== null && job.delivery !== 'delivered').length, recentRejected: [...this.recentRejected] }
  }
  async dispose(): Promise<void> { this.closed = true; await this.queue }
  probe(args: ProbeArgs): Promise<{ experiment: 'count' | 'length'; scene: MessageScene; results: unknown[] }> {
    return this.serial(async () => {
      if (this.lastIncoming === null) throw new Error('先在 QQ 上发送一条白名单消息')
      const { scene, target, trigger } = this.lastIncoming
      if (args.experiment === 'length' && scene === 'group') throw new Error('length 只在私聊测')
      const results: unknown[] = []
      const values = args.experiment === 'count' ? Array.from({ length: args.sends }, (_, index) => index + 1) : args.chars
      for (const value of values) {
        const msgSeq = trigger.repliesSent + 1
        const text = args.experiment === 'count' ? countProbeContent(value, args.sends, msgSeq) : lengthProbeContent(value)
        if (args.experiment === 'count') { trigger.repliesSent++; await this.save() }
        const outcome = await this.send(scene, target, text, args.experiment === 'count' ? trigger.msgId : undefined, args.experiment === 'count' ? msgSeq : undefined)
        results.push(args.experiment === 'count' ? { index: value, msgSeq, ...outcome } : { chars: value, contentChars: text.length, ...outcome })
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      return { experiment: args.experiment, scene, results }
    })
  }
}
