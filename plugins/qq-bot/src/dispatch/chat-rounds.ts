/**
 * 派任务：一条私聊按斜杠命令分到任务组或直接命令；每个私聊的每个组各有会话与队列，一组一次一轮：
 * 消息进队列、开一轮、收回报、懒检查、投递结果、接着开下一轮。
 * 改聊天表都在 ChatTable.serial 里做；调执行端、发 QQ 消息、执行直接命令都在它外面做，一个组慢不会卡住别的组。
 */
import { randomBytes } from 'node:crypto'
import { intakeFirstDelivery } from '../qq/incoming-gate.js'
import type { IncomingMessage, QqLog } from '../qq/qq-protocol.js'
import type { ReplySender } from '../qq/reply-sender.js'
import { DEFAULT_GROUP_KEY, DEFAULT_GROUP_LABEL, type Binding, type Chat, type ChatTable, type GroupState, type Round, type StoredTaskGroup, type Trigger, type UndeliveredResult } from '../storage/chat-table.js'
import { onlyKeys, optionalText, requireExistingDirectory, requireText } from './command-args.js'
import { parseTaskGroupDefinition, type PluginCommandRegistry } from './command-registry.js'
import type { ExecutorTable } from './executors/executor.js'
import { chooseSession, resolveIdleHours, type SessionChoice } from './group-session.js'
import { COMMAND_FRESH_SESSION, COMMAND_HELP, COMMAND_STATUS, groupNameOf, normalizeIncoming, routeMessage, tailExcerpt, type CommandKind, type RoutedMessage } from './routing.js'

export interface ChatRoundsDeps {
  /** gwb home 名，写进提示词，agent 按它选连回哪个 MCP 服务 */
  home: string
  table: ChatTable
  executors: ExecutorTable
  /** 插件注册的任务组与直接命令 */
  registry: PluginCommandRegistry
  ownerOpenid(): string
  defaultWorkspace(): string
  /** 设置 idle-hours 的原值，派任务时才校验 */
  idleHours(): unknown
  replies: ReplySender
  log: QqLog
}

export type GroupSource = 'default' | 'command' | 'plugin'

/** 派任务时用的组：默认组按这个私聊的绑定算，别的组按登记或注册算 */
interface ResolvedGroup {
  /** Chat.groups 里的键：组名，默认组是空串 */
  key: string
  /** 回执里的组名 */
  label: string
  title: string
  workspace: string
  agent: string
  instructions?: string
  idleHours?: number
  source: GroupSource
  plugin?: string
}

/** 已经记成在做、等着交给执行端的一轮；reusedSession 为空就开新会话 */
interface NextRound {
  target: string
  trigger: Trigger
  round: Round
  reusedSession: string | null
  group: ResolvedGroup
  choice: SessionChoice
}

const MAX_REPORT_CHARS = 2000
const REPLY_TAIL_CHARS = 600
const PROGRESS_TAIL_CHARS = 300
const NOT_BOUND = '这个私聊还没绑定工作区：请在 GWB 用 qq-bot.status 找到它，再用 qq-bot.bind 绑定。'

function newRoundId(): string {
  return `r-${randomBytes(6).toString('hex')}`
}

const labelOf = (key: string): string => key === DEFAULT_GROUP_KEY ? DEFAULT_GROUP_LABEL : key
const commandOf = (key: string): string => `/${key}`
const nowIso = (): string => new Date(Date.now()).toISOString()
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)
const hasWork = (state: GroupState | undefined): boolean => state !== undefined && (state.round !== null || state.queue.length > 0)

export class ChatRounds {
  private readonly workers = new Set<Promise<unknown>>()

  constructor(private readonly deps: ChatRoundsDeps) {}

  private get table(): ChatTable { return this.deps.table }
  private get replies(): ReplySender { return this.deps.replies }

  /** 显式绑定优先；主人私聊没绑时用设置里的默认工作区 */
  bindingOf(chat: Chat): Binding | null {
    if (chat.binding !== null) return chat.binding
    const workspace = this.deps.defaultWorkspace()
    if (chat.target === this.deps.ownerOpenid() && workspace !== '') return { workspace, agent: 'zcode', title: '个人空间' }
    return null
  }

  // ───── 命令查找 ─────

  private storedGroup(command: string): StoredTaskGroup | undefined {
    return this.table.book.groups.find((group) => group.command === command)
  }

  storedGroupCommands(): string[] {
    return this.table.book.groups.map((group) => group.command)
  }

  /** 命令登记的组和插件注册的项重名的命令：插件在聊天表读回之前注册时会出现，派任务时报出 */
  conflictingCommands(): string[] {
    return this.storedGroupCommands().filter((command) => this.deps.registry.holderOf(command) !== null)
  }

  private commandKindOf(command: string): CommandKind | null {
    const stored = this.storedGroup(command) !== undefined
    const registry = this.deps.registry
    if (stored && registry.holderOf(command) !== null) return 'conflict'
    if (stored || registry.group(command) !== undefined) return 'group'
    if (registry.directCommand(command) !== undefined) return 'direct'
    return null
  }

  private conflictText(command: string): string {
    return `指令 ${command} 同时是命令登记的任务组和${this.deps.registry.holderOf(command) ?? '别的注册项'}，派不出去：请在 GWB 用 qq-bot.group.remove 删掉命令登记的那个。`
  }

  /** 这个私聊这一组现在派得出去就回组的定义，派不出去回原因 */
  private resolveGroup(chat: Chat, key: string): ResolvedGroup | string {
    if (key === DEFAULT_GROUP_KEY) {
      const binding = this.bindingOf(chat)
      if (binding === null) return NOT_BOUND
      return { key, label: DEFAULT_GROUP_LABEL, ...binding, source: 'default' }
    }
    const command = commandOf(key)
    if (this.commandKindOf(command) === 'conflict') return this.conflictText(command)
    const stored = this.storedGroup(command)
    if (stored !== undefined) return { key, label: key, ...withoutCommand(stored), source: 'command' }
    const registered = this.deps.registry.group(command)
    if (registered === undefined) return `任务组 ${command} 已经撤掉，这条没有派出。`
    const resolved: ResolvedGroup = { key, label: key, ...withoutCommand(registered.definition), source: 'plugin' }
    if (registered.plugin !== undefined) resolved.plugin = registered.plugin
    return resolved
  }

  /** 白名单里的私聊都能用的组名（默认组除外） */
  private registeredGroupNames(): string[] {
    const commands = [...this.storedGroupCommands(), ...this.deps.registry.allGroups().map((group) => group.definition.command)]
    return [...new Set(commands)].map(groupNameOf)
  }

  // ───── 入站 ─────

  /** 处理一条私聊；调用方先过白名单（qq/incoming-gate.ts 的 AllowedSenderGate） */
  async handleAdmitted(message: IncomingMessage): Promise<void> {
    const text = normalizeIncoming(message.content)
    if (text === '') return
    const trigger: Trigger = { msgId: message.msgId, receivedAt: Date.now() }
    const intake = await intakeFirstDelivery(this.table, message, (chat) => {
      const routed = routeMessage(text, (command) => this.commandKindOf(command))
      if (routed.kind !== 'task') return { chatId: chat.id, routed, problem: null }
      const group = this.resolveGroup(chat, routed.group)
      if (typeof group === 'string') return { chatId: chat.id, routed, problem: group }
      this.table.groupState(chat, routed.group).queue.push({ prompt: routed.prompt, sender: message.senderOpenid, trigger })
      return { chatId: chat.id, routed, problem: null }
    })
    if (intake === null) return
    await this.answer(intake.chatId, intake.routed, intake.problem, message.senderOpenid, trigger)
  }

  private async answer(chatId: string, routed: RoutedMessage, problem: string | null, target: string, trigger: Trigger): Promise<void> {
    switch (routed.kind) {
      case 'help': await this.replies.reply(target, trigger, await this.helpFor(chatId)); return
      case 'status': await this.status(chatId, target, trigger); return
      case 'fresh-session': await this.freshSession(chatId, routed.group, target, trigger); return
      case 'usage': await this.replies.reply(target, trigger, routed.text); return
      case 'unknown-command': await this.replies.reply(target, trigger, `没有指令 ${routed.command}，这条没有派出。\n${await this.helpFor(chatId)}`); return
      case 'conflict': await this.replies.reply(target, trigger, this.conflictText(routed.command)); return
      case 'direct': await this.runDirectCommand(chatId, routed.command, routed.text, target, trigger); return
      case 'task': {
        if (problem !== null) { await this.replies.reply(target, trigger, `【${labelOf(routed.group)}】${problem}`); return }
        const busy = await this.advance(chatId, routed.group, true)
        if (busy !== null) await this.replies.reply(target, trigger, busy)
      }
    }
  }

  /**
   * 让这个私聊的这一组往前走：没有在做的一轮就从队列取下一条开一轮；有、且 lazyCheck 时问一次执行端，做完了却没回报就收尾再往前走。
   * 回 null 表示已经开了新一轮（或队列空了）；回一句话表示还在忙，交给调用方告诉人
   */
  private async advance(chatId: string, key: string, lazyCheck: boolean): Promise<string | null> {
    const state = await this.table.serial(async () => {
      const group = this.table.require(chatId).groups[key]
      return { round: group?.round == null ? null : structuredClone(group.round), queued: group?.queue.length ?? 0 }
    })
    if (state.round === null) {
      if (state.queued > 0) await this.startNext(chatId, key)
      return null
    }
    const label = labelOf(key)
    const waiting = `【${label}】上一条还在做，这条排在第 ${state.queued} 个，做完自动开始。`
    if (!lazyCheck || state.round.session === null) return waiting
    const checked = await this.check(state.round)
    if (typeof checked === 'string') return `【${label}】${checked}；这条排在第 ${state.queued} 个。`
    if (!checked.over) return waiting
    // closeRound 收尾后自己接着开下一轮
    await this.closeRound(chatId, key, state.round.id, `执行端这一轮已经结束，没有收到回报。最后的回答：\n${tailExcerpt(checked.reply, REPLY_TAIL_CHARS)}`)
    return null
  }

  /** 读不到执行端时回原因，交给调用方告诉人 */
  private async check(round: Round): Promise<{ over: boolean; reply: string } | string> {
    if (round.session === null) return '上一条还在派单'
    try {
      return await this.deps.executors.get(round.agent).check({ workspace: round.workspace, session: round.session })
    } catch (error) {
      return `读不到执行端状态：${errorText(error)}`
    }
  }

  // ───── 一轮 ─────

  /** 在串行队列里从这一组的队列取下一条，定下会话、记成在做的一轮；派不出去回原因 */
  private takeNextRound(chatId: string, key: string): Promise<NextRound | { target: string; trigger: Trigger; problem: string } | null> {
    return this.table.serial(async () => {
      const chat = this.table.require(chatId)
      const state = chat.groups[key]
      if (state === undefined || state.round !== null) return null
      const next = state.queue.shift()
      if (next === undefined) return null
      const group = this.resolveGroup(chat, key)
      const idleHours = typeof group === 'string' ? group : resolveIdleHours(group.idleHours, this.deps.idleHours())
      if (typeof group === 'string' || typeof idleHours === 'string') {
        await this.table.save()
        return { target: chat.target, trigger: next.trigger, problem: `【${labelOf(key)}】这条没有派出：${typeof group === 'string' ? group : idleHours}` }
      }
      const choice = chooseSession(state, group, Date.now(), idleHours)
      const reused = choice.kind === 'reuse' ? choice.session : null
      const round: Round = { id: newRoundId(), group: key, turn: reused === null ? 1 : reused.rounds + 1, prompt: next.prompt, sender: next.sender, agent: group.agent, workspace: group.workspace, session: null, trigger: next.trigger }
      // 定了开新会话就当场清掉旧的：派出失败后 lastTaskAt 已经刷新，不清的话下一条会接回旧会话
      if (reused === null) state.session = null
      state.round = round
      state.lastTaskAt = nowIso()
      await this.table.save()
      return { target: chat.target, trigger: next.trigger, round: structuredClone(round), reusedSession: reused?.id ?? null, group, choice }
    })
  }

  private async startNext(chatId: string, key: string): Promise<void> {
    const started = await this.takeNextRound(chatId, key)
    if (started === null) return
    if ('problem' in started) {
      await this.replies.reply(started.target, started.trigger, started.problem)
      await this.advance(chatId, key, false)
      return
    }
    const { target, trigger, round, reusedSession, group, choice } = started
    let sessionId: string
    try {
      sessionId = await this.deps.executors.get(round.agent).start({ workspace: round.workspace, session: reusedSession, prompt: this.fullPrompt(group, round) })
    } catch (error) {
      // 不留「不确定」的中间状态：原话告诉人，可能已经发出去了的，原话里会写，人去执行端看
      await this.table.serial(async () => {
        const state = this.table.require(chatId).groups[key]
        if (state?.round?.id === round.id) { state.round = null; await this.table.save() }
      })
      await this.replies.reply(target, trigger, `【${group.label}】派单失败：${errorText(error)}`)
      await this.advance(chatId, key, false)
      return
    }
    // 执行端没接着用交给它的会话，就是开了新会话，轮数从 1 数起
    const turn = reusedSession !== null && sessionId === reusedSession ? round.turn : 1
    await this.table.serial(async () => {
      const state = this.table.groupState(this.table.require(chatId), key)
      state.session = { agent: round.agent, workspace: round.workspace, id: sessionId, rounds: turn }
      if (state.round?.id === round.id) { state.round.session = sessionId; state.round.turn = turn }
      await this.table.save()
    })
    await this.replies.reply(target, trigger, this.receipt(group, round.agent, sessionId, turn, choice))
  }

  private receipt(group: ResolvedGroup, agent: string, sessionId: string, turn: number, choice: SessionChoice): string {
    const lines = [`【${group.label}】已接收，交给 ${this.executorLabel(agent)} 在「${group.title}」里做，做完回你。`, `会话 ${sessionId.slice(-4)} · 第 ${turn} 轮`]
    if (choice.kind === 'idle') lines.push(`已开新会话（空闲超过 ${choice.idleHours} 小时）`)
    return lines.join('\n')
  }

  private fullPrompt(group: ResolvedGroup, round: Round): string {
    const lines = [
      round.prompt,
      '',
      '[QQ 任务来源]',
      `这条任务来自 QQ 私聊，发言人 openid ${round.sender}，任务组「${group.title}」。在工作区 ${group.workspace} 里做，不要扩大到别的项目。`,
    ]
    if (group.instructions !== undefined) lines.push('', '[任务组要求]', group.instructions)
    lines.push(
      '',
      '[本轮回报]',
      `本轮编号 ${round.id}。做完后经连到 gwb home「${this.deps.home}」的 MCP 服务（各服务的说明里写着它连的是哪个 home）调 run：` +
        `command 为 qq-bot.report，args 为 {"round":"${round.id}","text":"给手机看的结果，300 字以内"}。一轮只报一次；调用超时就用同样的参数再调一次。`,
    )
    return lines.join('\n')
  }

  /** 收尾一轮并投递结果，再往前走；这一轮已经收过尾就什么都不做 */
  private async closeRound(chatId: string, key: string, roundId: string, text: string): Promise<void> {
    const closed = await this.table.serial(async () => {
      const chat = this.table.require(chatId)
      const state = chat.groups[key]
      if (state?.round?.id !== roundId) return null
      const { trigger, turn } = state.round
      state.round = null
      state.lastClosed = { id: roundId, text }
      state.lastTaskAt = nowIso()
      await this.table.save()
      return { target: chat.target, trigger, turn }
    })
    if (closed === null) return
    const label = labelOf(key)
    await this.deliver(chatId, closed.target, closed.trigger, `【${label} · 第 ${closed.turn} 轮】\n${text}`, { group: label, text, quote: closed.trigger.msgId })
    await this.advance(chatId, key, false)
  }

  // ───── 回报 ─────

  /** qq-bot.report：agent 做完自己调。回执先交回，投递与下一轮在后台做，不让 agent 等着自己的回报发完 */
  async report(raw: unknown): Promise<{ recorded: true; duplicate: boolean }> {
    const args = onlyKeys(raw, 'qq-bot.report', ['round', 'text'])
    const roundId = requireText(args, 'round', '任务说明里给的本轮编号')
    const text = requireText(args, 'text', '给手机看的结果')
    if (text.length > MAX_REPORT_CHARS) throw new Error(`text 最多 ${MAX_REPORT_CHARS} 字，这次 ${text.length} 字：缩短后用同一个本轮编号再交`)
    const found = await this.table.serial(async () => {
      const where = this.table.findRound(roundId)
      if (where === undefined) throw new Error(`不认识本轮编号 ${roundId}：不是这个机器人派出的，或者已经过去太久`)
      const state = where.chat.groups[where.group]!
      if (state.round?.id === roundId) return { chatId: where.chat.id, group: where.group, duplicate: false }
      if (state.lastClosed?.text === text) return { chatId: where.chat.id, group: where.group, duplicate: true }
      throw new Error(`本轮 ${roundId} 已经结束，交来的结果和已记下的不同，没有覆盖`)
    })
    if (!found.duplicate) this.track(this.closeRound(found.chatId, found.group, roundId, text))
    return { recorded: true, duplicate: found.duplicate }
  }

  // ───── 聊天里的保留命令与直接命令 ─────

  private helpFor(chatId: string): Promise<string> {
    return this.table.serial(async () => this.helpText(this.table.require(chatId)))
  }

  /** /帮助 的内容按此刻注册的现算 */
  private helpText(chat: Chat): string {
    const binding = this.bindingOf(chat)
    const defaultGroup = binding === null ? '这个私聊还没绑定工作区，请在 GWB 用 qq-bot.bind 绑定' : `「${binding.title}」，交给 ${this.executorLabel(binding.agent)}`
    const groups = [
      ...this.table.book.groups.map((group) => `${group.command} — ${group.title}`),
      ...this.deps.registry.allGroups().map(({ definition }) => `${definition.command} — ${definition.title}`),
    ]
    const directCommands = this.deps.registry.allDirectCommands().map(({ definition }) => `${definition.command} — ${definition.description}`)
    return [
      `QQ → 本机 agent。直接发的文字进默认组（${defaultGroup}）；每组一次做一件，后面的排队，不同的组可以同时做。`,
      '保留指令：',
      `${COMMAND_HELP} — 列出全部指令`,
      `${COMMAND_STATUS} — 补发没送达的结果；没有就逐组报在做什么`,
      `${COMMAND_FRESH_SESSION} [组名] — 这一组下一条起开新会话，不写组名是默认组`,
      groups.length === 0 ? '任务组：没有' : '任务组（发「命令 任务」）：',
      ...groups,
      directCommands.length === 0 ? '直接命令：没有' : '直接命令：',
      ...directCommands,
    ].join('\n')
  }

  private async runDirectCommand(chatId: string, command: string, text: string, target: string, trigger: Trigger): Promise<void> {
    const entry = this.deps.registry.directCommand(command)
    if (entry === undefined) { await this.replies.reply(target, trigger, `没有指令 ${command}，这条没有派出。\n${await this.helpFor(chatId)}`); return }
    let answer: string
    try {
      answer = await entry.definition.handle({ text, senderOpenid: target })
    } catch (error) {
      answer = `指令 ${command} 出错：${errorText(error)}`
    }
    await this.replies.reply(target, trigger, answer)
  }

  /** 这个私聊在 /状态 与 qq-bot.status 里要列的组：默认组、全部登记与注册的组、以及已经撤掉但还记着状态的组 */
  private groupKeysOf(chat: Chat): string[] {
    return [...new Set([DEFAULT_GROUP_KEY, ...this.registeredGroupNames(), ...Object.keys(chat.groups)])]
  }

  private async status(chatId: string, target: string, trigger: Trigger): Promise<void> {
    const pending = await this.table.serial(async () => {
      const chat = this.table.require(chatId)
      const results = chat.undelivered.splice(0)
      if (results.length > 0) await this.table.save()
      const groups = this.groupKeysOf(chat).map((key) => {
        const state = chat.groups[key]
        return { key, round: state?.round == null ? null : structuredClone(state.round), queued: state?.queue.length ?? 0, unbound: key === DEFAULT_GROUP_KEY && this.bindingOf(chat) === null }
      })
      return { results, groups }
    })
    if (pending.results.length > 0) {
      // 被动回复挂在这条 /状态 上，引用的仍是当初派出这一轮的那条消息
      for (const result of pending.results) await this.deliver(chatId, target, trigger, `【${result.group}】补发结果：\n${result.text}`, result)
      return
    }
    const lines: string[] = []
    const finished: { key: string; roundId: string; reply: string }[] = []
    for (const group of pending.groups) {
      const label = `【${labelOf(group.key)}】`
      const queued = group.queued > 0 ? `，排队 ${group.queued} 条` : ''
      if (group.round === null) { lines.push(`${label}${group.unbound ? '还没绑定工作区' : '空闲'}${queued}`); continue }
      const checked = await this.check(group.round)
      if (typeof checked === 'string') { lines.push(`${label}在做第 ${group.round.turn} 轮，${checked}${queued}`); continue }
      if (checked.over) {
        lines.push(`${label}第 ${group.round.turn} 轮已经结束、没有收到回报，最后的回答随后发`)
        finished.push({ key: group.key, roundId: group.round.id, reply: checked.reply })
        continue
      }
      lines.push(`${label}还在做第 ${group.round.turn} 轮${queued}。最新的回答末尾：\n${tailExcerpt(checked.reply, PROGRESS_TAIL_CHARS)}`)
    }
    await this.replies.reply(target, trigger, lines.join('\n'))
    for (const each of finished) {
      await this.closeRound(chatId, each.key, each.roundId, `执行端这一轮已经结束，没有收到回报。最后的回答：\n${tailExcerpt(each.reply, REPLY_TAIL_CHARS)}`)
    }
  }

  private async freshSession(chatId: string, groupName: string | null, target: string, trigger: Trigger): Promise<void> {
    if (groupName !== null && !this.registeredGroupNames().includes(groupName)) {
      await this.replies.reply(target, trigger, `没有任务组 ${groupName}。可用的组名：${this.registeredGroupNames().join('、') || '没有'}；不写组名是默认组。`)
      return
    }
    const key = groupName ?? DEFAULT_GROUP_KEY
    await this.table.serial(async () => {
      const state = this.table.require(chatId).groups[key]
      if (state !== undefined) { state.session = null; await this.table.save() }
    })
    await this.replies.reply(target, trigger, `【${labelOf(key)}】下一条起用新会话；在做的这一轮照常回报。`)
  }

  // ───── 绑定 ─────

  async bind(raw: unknown): Promise<Chat> {
    const args = onlyKeys(raw, 'qq-bot.bind', ['chat', 'workspace', 'title', 'agent', 'instructions'])
    const chatId = requireText(args, 'chat', 'qq-bot.status 里聊天的 id')
    const workspace = requireExistingDirectory(args, 'workspace')
    const title = requireText(args, 'title', '回执里叫它的名字（项目名或「个人空间」）')
    const agent = args['agent'] === undefined ? 'zcode' : requireText(args, 'agent', '执行端名 zcode / claudecode')
    this.requireInstalled(agent)
    const binding: Binding = { workspace, agent, title }
    const instructions = optionalText(args, 'instructions', '附在任务说明里的要求')
    if (instructions !== undefined) binding.instructions = instructions
    return this.changeBinding(chatId, binding)
  }

  async unbind(raw: unknown): Promise<Chat> {
    const args = onlyKeys(raw, 'qq-bot.unbind', ['chat'])
    return this.changeBinding(requireText(args, 'chat', 'qq-bot.status 里聊天的 id'), null)
  }

  /** 改的是默认组：只看默认组有没有在做或排队的，改完默认组下一条开新会话 */
  private changeBinding(chatId: string, binding: Binding | null): Promise<Chat> {
    return this.table.serial(async () => {
      const chat = this.table.require(chatId)
      if (hasWork(chat.groups[DEFAULT_GROUP_KEY])) throw new Error(`聊天 ${chat.id} 的默认组还有在做或排队的任务，做完再改绑定（/状态 能看到进度）`)
      chat.binding = binding
      const state = chat.groups[DEFAULT_GROUP_KEY]
      if (state !== undefined) state.session = null
      await this.table.save()
      return structuredClone(chat)
    })
  }

  private requireInstalled(agent: string): void {
    if (!this.deps.executors.has(agent)) throw new Error(`执行端 ${agent} 没装，现在装着的：${this.deps.executors.ids().join('、') || '没有'}`)
  }

  /** 给人看的执行端名：装着的写适配层的 title，没装的写 id 并注明没装 */
  private executorLabel(agent: string): string {
    return this.deps.executors.has(agent) ? this.deps.executors.get(agent).title : `${agent}（没装）`
  }

  // ───── 命令登记的任务组 ─────

  async addGroup(raw: unknown): Promise<StoredTaskGroup> {
    const definition = parseTaskGroupDefinition(raw, 'qq-bot.group.add')
    this.requireInstalled(definition.agent)
    return this.table.serial(async () => {
      this.deps.registry.requireFree(definition.command, this.storedGroupCommands())
      this.table.book.groups.push(definition)
      await this.table.save()
      return structuredClone(definition)
    })
  }

  async removeGroup(raw: unknown): Promise<StoredTaskGroup> {
    const args = onlyKeys(raw, 'qq-bot.group.remove', ['command'])
    const command = requireText(args, 'command', '要删的任务组的斜杠命令，如 /论文')
    return this.table.serial(async () => {
      const index = this.table.book.groups.findIndex((group) => group.command === command)
      if (index === -1) {
        const holder = this.deps.registry.holderOf(command)
        if (holder !== null) throw new Error(`${command} 是${holder}，不能用命令删：由注册它的插件撤掉`)
        throw new Error(`没有命令登记的任务组 ${command}，现有：${this.storedGroupCommands().join('、') || '没有'}`)
      }
      const key = groupNameOf(command)
      const busyChat = this.table.book.chats.find((chat) => hasWork(chat.groups[key]))
      if (busyChat !== undefined) throw new Error(`任务组 ${command} 在聊天 ${busyChat.id} 里还有在做或排队的任务，做完再删（/状态 能看到进度）`)
      const [removed] = this.table.book.groups.splice(index, 1)
      for (const chat of this.table.book.chats) delete chat.groups[key]
      await this.table.save()
      return removed!
    })
  }

  /** qq-bot.group.list：全部任务组（默认组按各私聊的绑定列）与直接命令，标明来源 */
  listGroups() {
    return this.table.serial(async () => ({
      groups: [
        {
          group: DEFAULT_GROUP_LABEL, command: null, source: 'default' as const,
          chats: this.table.book.chats.map((chat) => ({ chat: chat.id, binding: this.bindingOf(chat), bindingFromDefault: chat.binding === null && this.bindingOf(chat) !== null })),
        },
        ...this.table.book.groups.map((group) => ({ group: groupNameOf(group.command), ...group, source: 'command' as const })),
        ...this.deps.registry.allGroups().map(({ definition, plugin }) => ({ group: groupNameOf(definition.command), ...definition, source: 'plugin' as const, ...(plugin === undefined ? {} : { plugin }) })),
      ],
      directCommands: this.deps.registry.allDirectCommands().map(({ definition, plugin }) => ({ command: definition.command, description: definition.description, source: 'plugin' as const, ...(plugin === undefined ? {} : { plugin }) })),
    }))
  }

  // ───── 投递 ─────

  /** 发一段结果，引用 undelivered.quote 那条消息；没发出去就记进这个私聊的没送达，等人发 /状态 */
  private async deliver(chatId: string, target: string, trigger: Trigger, message: string, undelivered: UndeliveredResult): Promise<void> {
    if (await this.replies.reply(target, trigger, message, undelivered.quote)) return
    await this.table.serial(async () => {
      this.table.require(chatId).undelivered.push(undelivered)
      await this.table.save()
    })
  }

  /** qq-bot.status 的聊天清单：按组列出，不交回提示词原文 */
  async summary() {
    return this.table.serial(async () => this.table.book.chats.map((chat) => ({
      id: chat.id,
      target: chat.target,
      lastSeen: chat.lastSeen,
      lastSender: chat.lastSender,
      binding: this.bindingOf(chat),
      bindingFromDefault: chat.binding === null && this.bindingOf(chat) !== null,
      groups: this.groupKeysOf(chat).map((key) => this.groupSummary(chat, key)),
      undelivered: chat.undelivered.length,
    })))
  }

  private groupSummary(chat: Chat, key: string) {
    const group = this.resolveGroup(chat, key)
    const known = typeof group === 'string' ? null : group
    const state = chat.groups[key]
    const round = state?.round ?? null
    return {
      group: labelOf(key),
      title: known?.title ?? null,
      workspace: known?.workspace ?? null,
      agent: known?.agent ?? null,
      source: known?.source ?? null,
      session: state?.session ?? null,
      round: round === null ? null : { id: round.id, turn: round.turn, agent: round.agent, workspace: round.workspace, session: round.session },
      queued: state?.queue.length ?? 0,
      lastTaskAt: state?.lastTaskAt ?? null,
    }
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

function withoutCommand<T extends { command: string }>(definition: T): Omit<T, 'command'> {
  const { command: _command, ...rest } = definition
  return rest
}
