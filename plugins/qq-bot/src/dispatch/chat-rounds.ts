/**
 * 一个聊天的一轮从头到尾：消息进队列、开一轮、收回报、懒检查、投递结果、接着开下一轮。
 * 改聊天表都在 ChatTable.serial 里做；调执行端、发 QQ 消息都在它外面做，一个聊天慢不会卡住别的聊天。
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { intakeFirstDelivery } from '../qq/incoming-gate.js'
import { isRecord, type IncomingMessage, type QqLog } from '../qq/qq-protocol.js'
import type { ReplySender } from '../qq/reply-sender.js'
import type { Binding, Chat, ChatTable, Round, Trigger } from '../storage/chat-table.js'
import type { ExecutorTable } from './executors/executor.js'
import { matchCommand, normalizeIncoming, tailExcerpt } from './routing.js'

export interface ChatRoundsDeps {
  /** gwb home 名，写进提示词，agent 按它选连回哪个 MCP 服务 */
  home: string
  table: ChatTable
  executors: ExecutorTable
  ownerOpenid(): string
  defaultWorkspace(): string
  replies: ReplySender
  log: QqLog
}

const MAX_REPORT_CHARS = 2000
const REPLY_TAIL_CHARS = 600
const PROGRESS_TAIL_CHARS = 300

const HELP_TEXT = [
  'QQ → 本机 agent：',
  '· 直接说任务，做完我把结果发回来；同一个聊天一次做一件，后面的排队',
  '· /状态 看在做什么、补发没送到的结果',
  '· /新会话 下一条起换一个新会话',
  '· 没绑定工作区的聊天，请在 GWB 用 qq-bot.bind 绑定',
].join('\n')

function newRoundId(): string {
  return `r-${randomBytes(6).toString('hex')}`
}

function requireText(raw: Record<string, unknown>, key: string, meaning: string): string {
  const value = raw[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`缺 ${key}：${meaning}`)
  return value.trim()
}

function onlyKeys(raw: unknown, command: string, keys: string[]): Record<string, unknown> {
  if (!isRecord(raw)) throw new Error(`${command} 的参数要是对象，含 ${keys.join('、')}`)
  const unknown = Object.keys(raw).filter((key) => !keys.includes(key))
  if (unknown.length > 0) throw new Error(`${command} 不认识参数 ${unknown.join('、')}，只收 ${keys.join('、')}`)
  return raw
}

export class ChatRounds {
  private readonly workers = new Set<Promise<unknown>>()

  constructor(private readonly deps: ChatRoundsDeps) {}

  private get table(): ChatTable { return this.deps.table }
  private get replies(): ReplySender { return this.deps.replies }

  /** 显式绑定优先；主人私聊没绑时用设置里的默认工作区 */
  bindingOf(chat: Chat): Binding | null {
    if (chat.binding !== null) return chat.binding
    const workspace = this.deps.defaultWorkspace()
    if (chat.target === this.deps.ownerOpenid() && workspace !== '') return { workspace, agent: 'zcode', title: '个人空间', collab: false }
    return null
  }

  // ───── 入站 ─────

  /** 处理一条私聊；调用方先过白名单（qq/incoming-gate.ts 的 AllowedSenderGate） */
  async handleAdmitted(message: IncomingMessage): Promise<void> {
    const text = normalizeIncoming(message.content)
    if (text === '') return
    const trigger: Trigger = { msgId: message.msgId, receivedAt: Date.now() }
    const intake = await intakeFirstDelivery(this.table, message, (chat) => {
      const command = matchCommand(text)
      if (command === null && this.bindingOf(chat) !== null) chat.queue.push({ prompt: text, sender: message.senderOpenid, trigger })
      return { chatId: chat.id, command, bound: this.bindingOf(chat) !== null }
    })
    if (intake === null) return
    const target = message.senderOpenid
    if (intake.command === 'help') { await this.replies.reply(target, trigger, HELP_TEXT); return }
    if (intake.command === 'status') { await this.status(intake.chatId, target, trigger); return }
    if (intake.command === 'fresh-session') { await this.freshSession(intake.chatId, target, trigger); return }
    if (!intake.bound) { await this.replies.reply(target, trigger, '这个聊天还没绑定工作区：请在 GWB 用 qq-bot.status 找到它，再用 qq-bot.bind 绑定。'); return }
    const busy = await this.advance(intake.chatId, true)
    if (busy !== null) await this.replies.reply(target, trigger, busy)
  }

  /**
   * 让这个聊天往前走：没在跑就从队列取下一条开一轮；在跑、且 lazyCheck 时问一次执行端，做完了却没回报就收尾再往前走。
   * 回 null 表示已经开了新一轮（或队列空了）；回一句话表示还在忙，交给调用方告诉人
   */
  private async advance(chatId: string, lazyCheck: boolean): Promise<string | null> {
    const state = await this.table.serial(async () => {
      const chat = this.table.require(chatId)
      return { round: chat.round === null ? null : structuredClone(chat.round), queued: chat.queue.length }
    })
    if (state.round === null) {
      if (state.queued > 0) await this.startNext(chatId)
      return null
    }
    if (!lazyCheck || state.round.session === null) return `上一条还在做，这条排在第 ${state.queued} 个，做完自动开始。`
    const checked = await this.check(state.round)
    if (typeof checked === 'string') return `${checked}；这条排在第 ${state.queued} 个。`
    if (!checked.over) return `上一条还在做，这条排在第 ${state.queued} 个，做完自动开始。`
    // closeRound 收尾后自己接着开下一轮
    await this.closeRound(chatId, state.round.id, `执行端这一轮已经结束，没有收到回报。最后的回答：\n${tailExcerpt(checked.reply, REPLY_TAIL_CHARS)}`)
    return null
  }

  /** 读不到执行端时回原因，交给调用方告诉人 */
  private async check(round: Round): Promise<{ over: boolean; reply: string } | string> {
    if (round.session === null) return '上一条还在派单'
    try {
      return await this.deps.executors.get(round.agent).check({ workspace: round.workspace, session: round.session })
    } catch (error) {
      return `读不到执行端状态：${error instanceof Error ? error.message : String(error)}`
    }
  }

  // ───── 一轮 ─────

  private async startNext(chatId: string): Promise<void> {
    const started = await this.table.serial(async () => {
      const chat = this.table.require(chatId)
      if (chat.round !== null) return null
      const next = chat.queue.shift()
      if (next === undefined) return null
      const binding = this.bindingOf(chat)
      if (binding === null) { await this.table.save(); return { target: chat.target, trigger: next.trigger, unbound: true as const } }
      const session = chat.session !== null && chat.session.agent === binding.agent ? chat.session.id : null
      const round: Round = { id: newRoundId(), prompt: next.prompt, sender: next.sender, agent: binding.agent, workspace: binding.workspace, session: null, trigger: next.trigger }
      chat.round = round
      await this.table.save()
      return { target: chat.target, trigger: next.trigger, round: structuredClone(round), session, binding }
    })
    if (started === null) return
    if ('unbound' in started) { await this.replies.reply(started.target, started.trigger, '这个聊天的绑定已经解除，这条没有派出。'); return }
    const { target, trigger, round, session, binding } = started
    let sessionId: string
    try {
      const executor = this.deps.executors.get(round.agent)
      sessionId = await executor.start({ workspace: round.workspace, session, prompt: this.fullPrompt(binding, round) })
    } catch (error) {
      // 不留「不确定」的中间状态：原话告诉人，可能已经发出去了的，原话里会写，人去执行端看
      await this.table.serial(async () => {
        const chat = this.table.require(chatId)
        if (chat.round?.id === round.id) { chat.round = null; await this.table.save() }
      })
      await this.replies.reply(target, trigger, `派单失败：${error instanceof Error ? error.message : String(error)}`)
      await this.advance(chatId, false)
      return
    }
    await this.table.serial(async () => {
      const chat = this.table.require(chatId)
      chat.session = { agent: round.agent, id: sessionId }
      if (chat.round?.id === round.id) chat.round.session = sessionId
      await this.table.save()
    })
    const title = this.deps.executors.has(round.agent) ? this.deps.executors.get(round.agent).title : round.agent
    await this.replies.reply(target, trigger, `已接收，交给 ${title} 在「${binding.title}」里做，做完回你。`)
  }

  private fullPrompt(binding: Binding, round: Round): string {
    const lines = [
      round.prompt,
      '',
      '[QQ 任务来源]',
      `这条任务来自 QQ 私聊，发言人 openid ${round.sender}。在工作区 ${binding.workspace} 里做，不要扩大到别的项目。`,
    ]
    if (binding.collab) lines.push(`这是协作站的协作仓：对协作仓的改动一律经连到 gwb home「${this.deps.home}」的 MCP 服务调 collab.submit 提交，不手写 git。`)
    lines.push(
      '',
      '[本轮回报]',
      `本轮编号 ${round.id}。做完后经连到 gwb home「${this.deps.home}」的 MCP 服务（各服务的说明里写着它连的是哪个 home）调 run：` +
        `command 为 qq-bot.report，args 为 {"round":"${round.id}","text":"给手机看的结果，300 字以内"}。一轮只报一次；调用超时就用同样的参数再调一次。`,
    )
    return lines.join('\n')
  }

  /** 收尾一轮并投递结果，再往前走；这一轮已经收过尾就什么都不做 */
  private async closeRound(chatId: string, roundId: string, text: string): Promise<void> {
    const closed = await this.table.serial(async () => {
      const chat = this.table.require(chatId)
      if (chat.round?.id !== roundId) return null
      const trigger = chat.round.trigger
      chat.round = null
      chat.lastClosed = { id: roundId, text }
      await this.table.save()
      return { target: chat.target, trigger }
    })
    if (closed === null) return
    await this.deliver(chatId, closed.target, closed.trigger, text)
    await this.advance(chatId, false)
  }

  // ───── 回报 ─────

  /** qq-bot.report：agent 做完自己调。回执先交回，投递与下一轮在后台做，不让 agent 等着自己的回报发完 */
  async report(raw: unknown): Promise<{ recorded: true; duplicate: boolean }> {
    const args = onlyKeys(raw, 'qq-bot.report', ['round', 'text'])
    const roundId = requireText(args, 'round', '任务说明里给的本轮编号')
    const text = requireText(args, 'text', '给手机看的结果')
    if (text.length > MAX_REPORT_CHARS) throw new Error(`text 最多 ${MAX_REPORT_CHARS} 字，这次 ${text.length} 字：缩短后用同一个本轮编号再交`)
    const found = await this.table.serial(async () => {
      const chat = this.table.findRound(roundId)
      if (chat === undefined) throw new Error(`不认识本轮编号 ${roundId}：不是这个机器人派出的，或者已经过去太久`)
      if (chat.round?.id === roundId) return { chatId: chat.id, duplicate: false }
      if (chat.lastClosed?.text === text) return { chatId: chat.id, duplicate: true }
      throw new Error(`本轮 ${roundId} 已经结束，交来的结果和已记下的不同，没有覆盖`)
    })
    if (!found.duplicate) this.track(this.closeRound(found.chatId, roundId, text))
    return { recorded: true, duplicate: found.duplicate }
  }

  // ───── 聊天里的指令 ─────

  private async status(chatId: string, target: string, trigger: Trigger): Promise<void> {
    const pending = await this.table.serial(async () => {
      const chat = this.table.require(chatId)
      const results = chat.undelivered.splice(0)
      if (results.length > 0) await this.table.save()
      return { results, round:chat.round === null ? null : structuredClone(chat.round), queued: chat.queue.length, binding: this.bindingOf(chat) }
    })
    if (pending.results.length > 0) {
      // 被动回复挂在这条 /状态 上，引用的仍是当初派出这一轮的那条消息
      for (const result of pending.results) await this.deliver(chatId, target, trigger, `补发结果：\n${result.text}`, result.quote)
      return
    }
    if (pending.round === null) {
      await this.replies.reply(target, trigger, pending.binding === null ? '这个聊天还没绑定工作区。' : `现在没有任务。绑定：「${pending.binding.title}」，交给 ${pending.binding.agent}。`)
      return
    }
    const checked = await this.check(pending.round)
    if (typeof checked === 'string') { await this.replies.reply(target, trigger, `${checked}；排队 ${pending.queued} 条。`); return }
    if (checked.over) {
      await this.closeRound(chatId, pending.round.id, `执行端这一轮已经结束，没有收到回报。最后的回答：\n${tailExcerpt(checked.reply, REPLY_TAIL_CHARS)}`)
      return
    }
    await this.replies.reply(target, trigger, `还在做，排队 ${pending.queued} 条。最新的回答末尾：\n${tailExcerpt(checked.reply, PROGRESS_TAIL_CHARS)}`)
  }

  private async freshSession(chatId: string, target: string, trigger: Trigger): Promise<void> {
    await this.table.serial(async () => {
      this.table.require(chatId).session = null
      await this.table.save()
    })
    await this.replies.reply(target, trigger, '下一轮起用新会话；在做的这一轮照常回报。')
  }

  // ───── 绑定 ─────

  async bind(raw: unknown): Promise<Chat> {
    const args = onlyKeys(raw, 'qq-bot.bind', ['chat', 'workspace', 'title', 'agent', 'collab'])
    const chatId = requireText(args, 'chat', 'qq-bot.status 里聊天的 id')
    const workspace = requireText(args, 'workspace', '执行任务的目录，绝对路径')
    if (!path.win32.isAbsolute(workspace) || !fs.statSync(workspace, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`workspace 要是已存在目录的绝对路径，收到 ${workspace}`)
    const title = requireText(args, 'title', '回执里叫它的名字（项目名或「个人空间」）')
    const agent = args['agent'] === undefined ? 'zcode' : requireText(args, 'agent', '执行端名 zcode / claudecode')
    if (!this.deps.executors.has(agent)) throw new Error(`执行端 ${agent} 没装，现在装着的：${this.deps.executors.ids().join('、') || '没有'}`)
    if (args['collab'] !== undefined && typeof args['collab'] !== 'boolean') throw new Error('collab 要是布尔值：true 表示这是协作站的协作仓')
    const binding: Binding = { workspace, agent, title, collab: args['collab'] === true }
    return this.table.serial(async () => {
      const chat = this.table.require(chatId)
      this.requireIdle(chat)
      chat.binding = binding
      chat.session = null
      await this.table.save()
      return structuredClone(chat)
    })
  }

  async unbind(raw: unknown): Promise<Chat> {
    const args = onlyKeys(raw, 'qq-bot.unbind', ['chat'])
    const chatId = requireText(args, 'chat', 'qq-bot.status 里聊天的 id')
    return this.table.serial(async () => {
      const chat = this.table.require(chatId)
      this.requireIdle(chat)
      chat.binding = null
      chat.session = null
      await this.table.save()
      return structuredClone(chat)
    })
  }

  private requireIdle(chat: Chat): void {
    if (chat.round !== null || chat.queue.length > 0) throw new Error(`聊天 ${chat.id} 还有在做或排队的任务，做完再改绑定（/状态 能看到进度）`)
  }

  // ───── 投递 ─────

  /** 投递一段结果，引用 quote 那条消息；没发出去就连同 quote 记进这个聊天的未送达，等人发 /状态 */
  private async deliver(chatId: string, target: string, trigger: Trigger, text: string, quote = trigger.msgId): Promise<void> {
    if (await this.replies.reply(target, trigger, text, quote)) return
    await this.table.serial(async () => {
      this.table.require(chatId).undelivered.push({ text, quote })
      await this.table.save()
    })
  }

  /** qq-bot.status 的聊天清单：不交回提示词原文 */
  async summary() {
    return this.table.serial(async () => this.table.book.chats.map((chat) => ({
      id: chat.id,
      target: chat.target,
      lastSeen: chat.lastSeen,
      lastSender: chat.lastSender,
      binding: chat.binding ?? this.bindingOf(chat),
      bindingFromDefault: chat.binding === null && this.bindingOf(chat) !== null,
      round: chat.round === null ? null : { id: chat.round.id, agent: chat.round.agent, workspace: chat.round.workspace, session: chat.round.session },
      queued: chat.queue.length,
      undelivered: chat.undelivered.length,
    })))
  }

  // ───── 生命周期 ─────

  private track(work: Promise<unknown>): void {
    const tracked = work.catch((error: unknown) => this.deps.log.error(`QQ 后台投递失败：${String(error)}`)).finally(() => this.workers.delete(tracked))
    this.workers.add(tracked)
  }

  async dispose(): Promise<void> {
    while (this.workers.size > 0) await Promise.allSettled([...this.workers])
    await this.table.settle()
  }
}
