/** 聊天表：每个私聊一行（行里按任务组各记一份会话与队列），连同命令登记的任务组、主人通知的去重与近期消息 id，按 AppID 整份存成一份文档；连接与收发、通知、派任务三块共用 */
import { isRecord } from '../qq/qq-protocol.js'

/** 触发这一轮的那条消息：被动回复要带它的 msgId，窗口从收到时算；已用的被动回复次数记在 Book.replies */
export interface Trigger {
  msgId: string
  receivedAt: number
}

/** 私聊的显式绑定，设的是这个私聊的默认组 */
export interface Binding {
  /** 执行任务的目录，绝对路径 */
  workspace: string
  /** 回执里叫它的名字 */
  title: string
  /** 原样附在任务说明的「[任务组要求]」一段里 */
  instructions?: string
}

/** 一个组在 claude-agent 的会话；工作区和组的定义对不上时，下一轮开新会话 */
export interface GroupSession {
  workspace: string
  id: string
  /** 这个会话已经开过几轮 */
  rounds: number
}

/** 在做的那一轮；session 为空表示还在派出（claude-agent 还没交回会话号） */
export interface Round {
  id: string
  /** 组名，默认组是空串 */
  group: string
  /** 这一轮是所在会话的第几轮 */
  turn: number
  prompt: string
  sender: string
  workspace: string
  session: string | null
  /** claude-agent 回执里的 round，等这一轮结束（waitRound）用；和 session 同时有 */
  agentRound: number | null
  trigger: Trigger
}

export interface QueuedMessage {
  prompt: string
  sender: string
  trigger: Trigger
}

/** 一个私聊里一个任务组的状态 */
export interface GroupState {
  /** 这一组在 claude-agent 的会话；/新会话、改绑时清空 */
  session: GroupSession | null
  round: Round | null
  queue: QueuedMessage[]
  /** 这一组上一轮开始或收尾的时间（ISO），算空闲多久用；还没做过是 null */
  lastTaskAt: string | null
}

export interface UndeliveredResult {
  /** 回执里的组名，默认组是「默认」 */
  group: string
  text: string
  /** 补发时要引用的消息 id */
  quote: string
}

export interface Chat {
  /** `c2c:<target>` */
  id: string
  /** 对方的 openid */
  target: string
  lastSeen: string
  lastSender: string
  /** 默认组的显式绑定；主人私聊没绑时按设置算，不写进这里 */
  binding: Binding | null
  /** 按组名记的状态，默认组的键是空串；第一次往这一组派任务时才有 */
  groups: Record<string, GroupState>
  /** 没送达的结果，/状态 时补发 */
  undelivered: UndeliveredResult[]
}

/** 用 qq-bot.group.add 登记的任务组 */
export interface StoredTaskGroup {
  command: string
  title: string
  workspace: string
  instructions?: string
  idleHours?: number
}

export interface Notice {
  id: string
  text: string
  delivered: boolean
}

export interface Book {
  version: 4
  chats: Chat[]
  /** 命令登记的任务组，白名单里的每个私聊都能用 */
  groups: StoredTaskGroup[]
  notices: Notice[]
  /** 近期处理过的 `<chatId>|<msgId>`，网关重推时不重复派出 */
  seen: string[]
  /** 每条触发消息已用掉的被动回复次数（msg_seq 递增、不能重复） */
  replies: Record<string, number>
}

/** 第 3 版的组状态：会话与在做的一轮记着执行端名（zcode / claudecode），还有给回报判重的 lastClosed */
interface GroupStateV3 {
  session: { agent: string; workspace: string; id: string; rounds: number } | null
  round: { id: string } | null
  queue: QueuedMessage[]
  lastTaskAt: string | null
}

interface ChatV3 extends Omit<Chat, 'binding' | 'groups'> {
  binding: (Binding & { agent: string }) | null
  groups: Record<string, GroupStateV3>
}

const SEEN_LIMIT = 2000
const REPLIES_LIMIT = 500

/** 第 2 版绑定上 collab 为 true 的，换成这段任务组要求 */
export const COLLAB_INSTRUCTIONS = '先读 gwb 说明书 collab（经 gwb MCP 调 run skill.read {"name":"collab"}），协作仓和项目里其余仓的改动照它提交。'

/** 默认组在 Chat.groups 里的键（组名不会是空串）；回执里叫它 DEFAULT_GROUP_LABEL */
export const DEFAULT_GROUP_KEY = ''
export const DEFAULT_GROUP_LABEL = '默认'

export const chatIdOf = (target: string): string => `c2c:${target}`

const emptyBook = (): Book => ({ version: 4, chats: [], groups: [], notices: [], seen: [], replies: {} })

export const emptyGroupState = (): GroupState => ({ session: null, round: null, queue: [], lastTaskAt: null })

const isText = (value: unknown): value is string => typeof value === 'string'

function shapeError(version: number): Error {
  return new Error(`QQ 聊天表第 ${version} 版里有一行形状不对，停止处理`)
}

/** 第 1、2 版的行：每个私聊只有一份会话与队列 */
function requireFlatChatShape(chat: unknown, version: 1 | 2): asserts chat is Record<string, unknown> {
  if (!isRecord(chat) || !isText(chat['id']) || !isText(chat['target']) || !Array.isArray(chat['queue']) || !Array.isArray(chat['undelivered'])
    || !chat['undelivered'].every((result) => isRecord(result) && isText(result['text']) && isText(result['quote']))) {
    throw shapeError(version)
  }
}

function requireGroupStateShape(state: unknown, version: 3 | 4): void {
  if (!isRecord(state) || !Array.isArray(state['queue']) || !('session' in state) || !('round' in state) || !(state['lastTaskAt'] === null || isText(state['lastTaskAt']))) throw shapeError(version)
}

function requireChatShape(chat: unknown, version: 3 | 4): void {
  if (!isRecord(chat) || !isText(chat['id']) || !isText(chat['target']) || !isRecord(chat['groups']) || !Array.isArray(chat['undelivered'])
    || !chat['undelivered'].every((result) => isRecord(result) && isText(result['text']) && isText(result['quote']) && isText(result['group']))) {
    throw shapeError(version)
  }
  for (const state of Object.values(chat['groups'])) requireGroupStateShape(state, version)
}

function requireStoredGroupShape(group: unknown, version: 3 | 4): asserts group is Record<string, unknown> {
  if (!isRecord(group) || !isText(group['command']) || !isText(group['title']) || !isText(group['workspace'])) {
    throw new Error(`QQ 聊天表第 ${version} 版里有一个命令登记的任务组形状不对，停止处理`)
  }
}

function withoutAgent<T extends { agent?: unknown }>(value: T): Omit<T, 'agent'> {
  const { agent: _agent, ...rest } = value
  return rest
}

/** 第 1 版还有群聊：去掉群聊那几行、私聊去掉 scene，得到第 2 版的行 */
function chatsFromVersion1(chats: unknown[]): { chats: Record<string, unknown>[]; droppedGroups: number } {
  const kept: Record<string, unknown>[] = []
  let droppedGroups = 0
  for (const chat of chats) {
    requireFlatChatShape(chat, 1)
    if (chat['scene'] === 'group') { droppedGroups += 1; continue }
    if (chat['scene'] !== 'c2c') throw new Error('QQ 聊天表第 1 版里有一行的 scene 既不是 c2c 也不是 group，停止处理')
    const c2c: Record<string, unknown> = { ...chat }
    delete c2c['scene']
    kept.push(c2c)
  }
  return { chats: kept, droppedGroups }
}

function bindingFromVersion2(binding: unknown): ChatV3['binding'] {
  if (binding === null) return null
  if (!isRecord(binding) || !isText(binding['workspace']) || !isText(binding['agent']) || !isText(binding['title']) || typeof binding['collab'] !== 'boolean') throw shapeError(2)
  const migrated: ChatV3['binding'] = { workspace: binding['workspace'], agent: binding['agent'], title: binding['title'] }
  if (binding['collab']) migrated.instructions = COLLAB_INSTRUCTIONS
  return migrated
}

/**
 * 第 2 版的一行换成第 3 版：会话、在做的一轮、队列归进默认组，没送达的结果补上组名「默认」。
 * 第 2 版的会话没记工作区：取在做那一轮的、再取绑定的；都没有（主人私聊没绑、又没有在做的一轮）就不留这个会话。第 2 版也没记轮数，从这里重新数
 */
function chatFromVersion2(chat: Record<string, unknown>): ChatV3 {
  const binding = bindingFromVersion2(chat['binding'] ?? null)
  const oldRound = chat['round'] ?? null
  if (oldRound !== null && (!isRecord(oldRound) || !isText(oldRound['workspace']) || !isText(oldRound['id']))) throw shapeError(2)
  const round = oldRound === null ? null : { id: oldRound['id'] as string }
  const oldSession = chat['session'] ?? null
  if (oldSession !== null && (!isRecord(oldSession) || !isText(oldSession['agent']) || !isText(oldSession['id']))) throw shapeError(2)
  const sessionWorkspace = oldRound === null ? binding?.workspace : oldRound['workspace'] as string
  const session: GroupStateV3['session'] = oldSession === null || sessionWorkspace === undefined
    ? null
    : { agent: oldSession['agent'] as string, id: oldSession['id'] as string, workspace: sessionWorkspace, rounds: round === null ? 0 : 1 }
  if (!isText(chat['lastSeen']) || !isText(chat['lastSender'])) throw shapeError(2)
  const state: GroupStateV3 = { session, round, queue: chat['queue'] as QueuedMessage[], lastTaskAt: null }
  return {
    id: chat['id'] as string,
    target: chat['target'] as string,
    lastSeen: chat['lastSeen'],
    lastSender: chat['lastSender'],
    binding,
    groups: { [DEFAULT_GROUP_KEY]: state },
    undelivered: (chat['undelivered'] as { text: string; quote: string }[]).map((result) => ({ group: DEFAULT_GROUP_LABEL, text: result.text, quote: result.quote })),
  }
}

/**
 * 第 3 版的一行换成第 4 版：执行一律交给 claude-agent，ZCode / Claude Code 的旧会话作废，各组下一条开新会话；绑定去掉执行端名。
 * 有在做的一轮就报错停下：那一轮的结果只有旧执行端交得回来
 */
function chatFromVersion3(chat: ChatV3): Chat {
  const groups: Record<string, GroupState> = {}
  for (const [key, state] of Object.entries(chat.groups)) {
    if (state.round !== null) {
      const label = key === DEFAULT_GROUP_KEY ? DEFAULT_GROUP_LABEL : key
      throw new Error(`QQ 聊天表第 3 版里私聊 ${chat.id} 的「${label}」组还有在做的一轮（${state.round.id}）：0.8 起改由 claude-agent 执行，接不回旧执行端的这一轮。先把 qq-bot 装回 0.7.x，等这一轮做完（私聊发 /状态 看）再升级`)
    }
    groups[key] = { session: null, round: null, queue: state.queue, lastTaskAt: state.lastTaskAt }
  }
  return { id: chat.id, target: chat.target, lastSeen: chat.lastSeen, lastSender: chat.lastSender, binding: chat.binding === null ? null : withoutAgent(chat.binding), groups, undelivered: chat.undelivered }
}

export interface LoadedBook {
  book: Book
  /** 从第 1 版读回时去掉的群聊个数 */
  droppedGroups: number
  /** 从哪一版迁上来的；读到的就是第 4 版时是 null */
  migratedFrom: 1 | 2 | 3 | null
  /** 迁到第 4 版时作废的旧执行端会话个数 */
  droppedSessions: number
}

/**
 * 系统边界：账本从磁盘读回，形状不对直接报错，不按缺省值继续执行。
 * 第 1 版先换成第 2 版（去掉群聊），第 2 版再换成第 3 版（归进默认组），第 3 版再换成第 4 版（执行端统一成 claude-agent）；下次写盘就是第 4 版
 */
export function loadBook(raw: unknown): LoadedBook {
  if (raw === undefined) return { book: emptyBook(), droppedGroups: 0, migratedFrom: null, droppedSessions: 0 }
  if (!isRecord(raw) || ![1, 2, 3, 4].includes(raw['version'] as number) || !Array.isArray(raw['chats']) || !Array.isArray(raw['notices']) || !Array.isArray(raw['seen']) || !isRecord(raw['replies'])) {
    throw new Error('QQ 聊天表格式不对（version 1–4 的 chats / notices / seen / replies），停止处理')
  }
  const version = raw['version'] as 1 | 2 | 3 | 4
  if (version === 3 || version === 4) {
    if (!Array.isArray(raw['groups'])) throw new Error(`QQ 聊天表第 ${version} 版缺 groups，停止处理`)
    for (const chat of raw['chats']) requireChatShape(chat, version)
    for (const group of raw['groups']) requireStoredGroupShape(group, version)
  }
  if (version === 4) return { book: raw as unknown as Book, droppedGroups: 0, migratedFrom: null, droppedSessions: 0 }
  let chatsV3: ChatV3[]
  let droppedGroups = 0
  if (version === 3) {
    chatsV3 = raw['chats'] as ChatV3[]
  } else {
    let flatChats: Record<string, unknown>[]
    if (version === 1) {
      ({ chats: flatChats, droppedGroups } = chatsFromVersion1(raw['chats']))
    } else {
      for (const chat of raw['chats']) {
        requireFlatChatShape(chat, 2)
        if ('scene' in chat) throw new Error('QQ 聊天表第 2 版里有一行还带着 scene，停止处理')
      }
      flatChats = raw['chats'] as Record<string, unknown>[]
    }
    chatsV3 = flatChats.map(chatFromVersion2)
  }
  const storedGroups = version === 3 ? (raw['groups'] as Record<string, unknown>[]) : []
  const droppedSessions = chatsV3.reduce((count, chat) => count + Object.values(chat.groups).filter((state) => state.session !== null).length, 0)
  const book: Book = {
    version: 4,
    chats: chatsV3.map(chatFromVersion3),
    groups: storedGroups.map((group) => withoutAgent(group) as unknown as StoredTaskGroup),
    notices: raw['notices'] as Notice[],
    seen: raw['seen'] as string[],
    replies: raw['replies'] as Record<string, number>,
  }
  return { book, droppedGroups, migratedFrom: version, droppedSessions }
}

/** 聊天表的读写都经同一条串行队列；写盘失败记下来，之后的操作一律报这个错 */
export class ChatTable {
  book: Book = emptyBook()
  /** 读到第 1 版时去掉的群聊个数，装配处记一行日志 */
  droppedGroups = 0
  /** 从哪一版迁上来的，装配处记一行日志；读到的就是第 4 版时是 null */
  migratedFrom: LoadedBook['migratedFrom'] = null
  /** 迁到第 4 版时作废的旧执行端会话个数 */
  droppedSessions = 0
  private queue: Promise<unknown>
  private storageError: unknown

  constructor(private readonly store: { read(): Promise<unknown>; write(value: unknown): Promise<void> }) {
    this.queue = store.read().then((raw) => {
      ({ book: this.book, droppedGroups: this.droppedGroups, migratedFrom: this.migratedFrom, droppedSessions: this.droppedSessions } = loadBook(raw))
    }).catch((error: unknown) => { this.storageError = error })
  }

  /** 读回或迁移失败的原话；装配处记一行 error。之后的操作也一律报它 */
  get loadError(): unknown { return this.storageError }

  serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => {
      if (this.storageError !== undefined) throw this.storageError
      return run()
    })
    this.queue = next.catch(() => {})
    return next
  }

  async save(): Promise<void> {
    try { await this.store.write(structuredClone(this.book)) }
    catch (error) { this.storageError = error; throw error }
  }

  /** 等排队的操作都做完（卸载时用） */
  async settle(): Promise<void> { await this.queue }

  find(id: string): Chat | undefined {
    return this.book.chats.find((chat) => chat.id === id)
  }

  require(id: string): Chat {
    const chat = this.find(id)
    if (chat === undefined) throw new Error(`没有聊天 ${id}：先在那个私聊里给机器人发一条 /帮助，再用 qq-bot.status 查它的 id`)
    return chat
  }

  /** 收到 openid 发来的私聊：没有这个聊天就建一行 */
  observe(openid: string): Chat {
    const id = chatIdOf(openid)
    let chat = this.find(id)
    if (chat === undefined) {
      chat = { id, target: openid, lastSeen: '', lastSender: '', binding: null, groups: {}, undelivered: [] }
      this.book.chats.push(chat)
    }
    chat.lastSeen = new Date(Date.now()).toISOString()
    chat.lastSender = openid
    return chat
  }

  /** 这条消息处理过就回 false；没处理过就记下、回 true */
  firstSeen(chatId: string, msgId: string): boolean {
    const key = `${chatId}|${msgId}`
    if (this.book.seen.includes(key)) return false
    this.book.seen.push(key)
    if (this.book.seen.length > SEEN_LIMIT) this.book.seen.shift()
    return true
  }

  /** 给这条触发消息再用一次被动回复，回用之前已经用了几次 */
  takeReply(msgId: string): number {
    const used = this.book.replies[msgId] ?? 0
    this.book.replies[msgId] = used + 1
    const keys = Object.keys(this.book.replies)
    if (keys.length > REPLIES_LIMIT) delete this.book.replies[keys[0]!]
    return used
  }

  repliesUsed(msgId: string): number {
    return this.book.replies[msgId] ?? 0
  }

  /** 这个私聊这一组的状态，没有就建一份 */
  groupState(chat: Chat, group: string): GroupState {
    const existing = chat.groups[group]
    if (existing !== undefined) return existing
    const created = emptyGroupState()
    chat.groups[group] = created
    return created
  }

  /** 所有私聊里在做的一轮（副本），重载后接着等它们结束用 */
  openRounds(): { chatId: string; key: string; round: Round }[] {
    return this.book.chats.flatMap((chat) => Object.entries(chat.groups)
      .filter(([, state]) => state.round !== null)
      .map(([key, state]) => ({ chatId: chat.id, key, round: structuredClone(state.round!) })))
  }
}
