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
  /** 执行端名：zcode / claudecode */
  agent: string
  /** 回执里叫它的名字 */
  title: string
  /** 原样附在任务说明的「[任务组要求]」一段里 */
  instructions?: string
}

/** 一个组在执行端的会话；执行端或工作区和组的定义对不上时，下一轮开新会话 */
export interface GroupSession {
  agent: string
  workspace: string
  id: string
  /** 这个会话已经开过几轮 */
  rounds: number
}

/** 在做的那一轮；session 为空表示还在派出（执行端还没交回会话号） */
export interface Round {
  id: string
  /** 组名，默认组是空串 */
  group: string
  /** 这一轮是所在会话的第几轮 */
  turn: number
  prompt: string
  sender: string
  agent: string
  workspace: string
  session: string | null
  trigger: Trigger
}

export interface QueuedMessage {
  prompt: string
  sender: string
  trigger: Trigger
}

/** 一个私聊里一个任务组的状态 */
export interface GroupState {
  /** 这一组在执行端的会话；/新会话、改绑时清空 */
  session: GroupSession | null
  round: Round | null
  queue: QueuedMessage[]
  /** 上一轮收尾时的编号与结果：同一轮重交回报用它判重 */
  lastClosed: { id: string; text: string } | null
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
  agent: 'zcode' | 'claudecode'
  instructions?: string
  idleHours?: number
}

export interface Notice {
  id: string
  text: string
  delivered: boolean
}

export interface Book {
  version: 3
  chats: Chat[]
  /** 命令登记的任务组，白名单里的每个私聊都能用 */
  groups: StoredTaskGroup[]
  notices: Notice[]
  /** 近期处理过的 `<chatId>|<msgId>`，网关重推时不重复派出 */
  seen: string[]
  /** 每条触发消息已用掉的被动回复次数（msg_seq 递增、不能重复） */
  replies: Record<string, number>
  /** 已经让 ZCode 打开过的工作区：ZCode 侧栏的「项目」只列打开过的，没打开过的派单前先打开一次。只增不减 */
  zcodeOpenedWorkspaces: string[]
}

const SEEN_LIMIT = 2000
const REPLIES_LIMIT = 500

/** 第 2 版绑定上 collab 为 true 的，换成这段任务组要求 */
export const COLLAB_INSTRUCTIONS = '先读 gwb 说明书 collab（经 gwb MCP 调 run skill.read {"name":"collab"}），协作仓和项目里其余仓的改动照它提交。'

/** 默认组在 Chat.groups 里的键（组名不会是空串）；回执里叫它 DEFAULT_GROUP_LABEL */
export const DEFAULT_GROUP_KEY = ''
export const DEFAULT_GROUP_LABEL = '默认'

export const chatIdOf = (target: string): string => `c2c:${target}`

const emptyBook = (): Book => ({ version: 3, chats: [], groups: [], notices: [], seen: [], replies: {}, zcodeOpenedWorkspaces: [] })

export const emptyGroupState = (): GroupState => ({ session: null, round: null, queue: [], lastClosed: null, lastTaskAt: null })

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

function requireGroupStateShape(state: unknown): void {
  if (!isRecord(state) || !Array.isArray(state['queue']) || !('session' in state) || !('round' in state) || !('lastClosed' in state) || !(state['lastTaskAt'] === null || isText(state['lastTaskAt']))) throw shapeError(3)
}

function requireChatShape(chat: unknown): void {
  if (!isRecord(chat) || !isText(chat['id']) || !isText(chat['target']) || !isRecord(chat['groups']) || !Array.isArray(chat['undelivered'])
    || !chat['undelivered'].every((result) => isRecord(result) && isText(result['text']) && isText(result['quote']) && isText(result['group']))) {
    throw shapeError(3)
  }
  for (const state of Object.values(chat['groups'])) requireGroupStateShape(state)
}

/** 第 3 版里可以没有这一项：没有就是还没让 ZCode 打开过任何工作区；有就必须是字符串列表 */
function zcodeOpenedWorkspacesOf(raw: Record<string, unknown>): string[] {
  if (!('zcodeOpenedWorkspaces' in raw)) return []
  const opened = raw['zcodeOpenedWorkspaces']
  if (!Array.isArray(opened) || !opened.every(isText)) throw new Error('QQ 聊天表第 3 版的 zcodeOpenedWorkspaces 不是字符串列表，停止处理')
  return opened
}

function requireStoredGroupShape(group: unknown): void {
  if (!isRecord(group) || !isText(group['command']) || !isText(group['title']) || !isText(group['workspace']) || !isText(group['agent'])) {
    throw new Error('QQ 聊天表第 3 版里有一个命令登记的任务组形状不对，停止处理')
  }
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

function bindingFromVersion2(binding: unknown): Binding | null {
  if (binding === null) return null
  if (!isRecord(binding) || !isText(binding['workspace']) || !isText(binding['agent']) || !isText(binding['title']) || typeof binding['collab'] !== 'boolean') throw shapeError(2)
  const migrated: Binding = { workspace: binding['workspace'], agent: binding['agent'], title: binding['title'] }
  if (binding['collab']) migrated.instructions = COLLAB_INSTRUCTIONS
  return migrated
}

/**
 * 第 2 版的一行换成第 3 版：会话、在做的一轮、队列、上一轮的结果归进默认组，没送达的结果补上组名「默认」。
 * 第 2 版的会话没记工作区：取在做那一轮的、再取绑定的；都没有（主人私聊没绑、又没有在做的一轮）就不留这个会话。第 2 版也没记轮数，从这里重新数
 */
function chatFromVersion2(chat: Record<string, unknown>): Chat {
  const binding = bindingFromVersion2(chat['binding'] ?? null)
  const oldRound = chat['round'] ?? null
  if (oldRound !== null && (!isRecord(oldRound) || !isText(oldRound['workspace']))) throw shapeError(2)
  const round = oldRound === null ? null : { ...(oldRound as unknown as Omit<Round, 'group' | 'turn'>), group: DEFAULT_GROUP_KEY, turn: 1 }
  const oldSession = chat['session'] ?? null
  if (oldSession !== null && (!isRecord(oldSession) || !isText(oldSession['agent']) || !isText(oldSession['id']))) throw shapeError(2)
  const sessionWorkspace = round?.workspace ?? binding?.workspace
  const session: GroupSession | null = oldSession === null || sessionWorkspace === undefined
    ? null
    : { agent: oldSession['agent'] as string, id: oldSession['id'] as string, workspace: sessionWorkspace, rounds: round === null ? 0 : 1 }
  if (!isText(chat['lastSeen']) || !isText(chat['lastSender'])) throw shapeError(2)
  const state: GroupState = { session, round, queue: chat['queue'] as QueuedMessage[], lastClosed: (chat['lastClosed'] ?? null) as GroupState['lastClosed'], lastTaskAt: null }
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

export interface LoadedBook {
  book: Book
  /** 从第 1 版读回时去掉的群聊个数 */
  droppedGroups: number
  /** 从第 1、2 版读回时迁进默认组的私聊个数；读到的就是第 3 版时是 null */
  migratedChats: number | null
}

/**
 * 系统边界：账本从磁盘读回，形状不对直接报错，不按缺省值继续执行。
 * 第 1 版先换成第 2 版（去掉群聊），第 2 版再换成第 3 版（归进默认组）；下次写盘就是第 3 版
 */
export function loadBook(raw: unknown): LoadedBook {
  if (raw === undefined) return { book: emptyBook(), droppedGroups: 0, migratedChats: null }
  if (!isRecord(raw) || ![1, 2, 3].includes(raw['version'] as number) || !Array.isArray(raw['chats']) || !Array.isArray(raw['notices']) || !Array.isArray(raw['seen']) || !isRecord(raw['replies'])) {
    throw new Error('QQ 聊天表格式不对（version 1、2 或 3 的 chats / notices / seen / replies），停止处理')
  }
  if (raw['version'] === 3) {
    if (!Array.isArray(raw['groups'])) throw new Error('QQ 聊天表第 3 版缺 groups，停止处理')
    for (const chat of raw['chats']) requireChatShape(chat)
    for (const group of raw['groups']) requireStoredGroupShape(group)
    return { book: { ...(raw as unknown as Book), zcodeOpenedWorkspaces: zcodeOpenedWorkspacesOf(raw) }, droppedGroups: 0, migratedChats: null }
  }
  let flatChats: Record<string, unknown>[]
  let droppedGroups = 0
  if (raw['version'] === 1) {
    ({ chats: flatChats, droppedGroups } = chatsFromVersion1(raw['chats']))
  } else {
    for (const chat of raw['chats']) {
      requireFlatChatShape(chat, 2)
      if ('scene' in chat) throw new Error('QQ 聊天表第 2 版里有一行还带着 scene，停止处理')
    }
    flatChats = raw['chats'] as Record<string, unknown>[]
  }
  const chats = flatChats.map(chatFromVersion2)
  const book: Book = { version: 3, chats, groups: [], notices: raw['notices'] as Notice[], seen: raw['seen'] as string[], replies: raw['replies'] as Record<string, number>, zcodeOpenedWorkspaces: [] }
  return { book, droppedGroups, migratedChats: chats.length }
}

/** 聊天表的读写都经同一条串行队列；写盘失败记下来，之后的操作一律报这个错 */
export class ChatTable {
  book: Book = emptyBook()
  /** 读到第 1 版时去掉的群聊个数，装配处记一行日志 */
  droppedGroups = 0
  /** 读到第 1、2 版时迁进默认组的私聊个数，装配处记一行日志 */
  migratedChats: number | null = null
  private queue: Promise<unknown>
  private storageError: unknown

  constructor(private readonly store: { read(): Promise<unknown>; write(value: unknown): Promise<void> }) {
    this.queue = store.read().then((raw) => { ({ book: this.book, droppedGroups: this.droppedGroups, migratedChats: this.migratedChats } = loadBook(raw)) }).catch((error: unknown) => { this.storageError = error })
  }

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

  /** 本轮编号在哪个私聊的哪一组：在做的、或刚收尾的 */
  findRound(roundId: string): { chat: Chat; group: string } | undefined {
    for (const chat of this.book.chats) {
      for (const [group, state] of Object.entries(chat.groups)) {
        if (state.round?.id === roundId || state.lastClosed?.id === roundId) return { chat, group }
      }
    }
    return undefined
  }

  zcodeWorkspaceOpened(workspace: string): boolean {
    return this.book.zcodeOpenedWorkspaces.includes(workspace)
  }

  /** 记下 ZCode 已经打开过这个工作区并写盘；只增不减 */
  rememberZcodeWorkspaceOpened(workspace: string): Promise<void> {
    return this.serial(async () => {
      if (this.book.zcodeOpenedWorkspaces.includes(workspace)) return
      this.book.zcodeOpenedWorkspaces.push(workspace)
      await this.save()
    })
  }
}
