/** 聊天表：每个私聊一行，连同主人通知的去重与近期消息 id，按 AppID 整份存成一份文档 */
import { isRecord } from './qq-protocol.js'

/** 触发这一轮的那条消息：被动回复要带它的 msgId，窗口从收到时算；已用的被动回复次数记在 Book.replies */
export interface Trigger {
  msgId: string
  receivedAt: number
}

export interface Binding {
  /** 执行任务的目录，绝对路径 */
  workspace: string
  /** 执行端名：zcode / claudecode */
  agent: string
  /** 回执里叫它的名字 */
  title: string
  /** 是协作站的协作仓：提示词里写明改动经 collab.submit 提交 */
  collab: boolean
}

/** 在跑的那一轮；session 为空表示还在派单（执行端还没交回会话号） */
export interface Round {
  id: string
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

export interface Chat {
  /** `c2c:<target>` */
  id: string
  /** 对方的 openid */
  target: string
  lastSeen: string
  lastSender: string
  /** 显式绑定；主人私聊没绑时按设置算，不写进这里 */
  binding: Binding | null
  /** 这个聊天在执行端的会话；换执行端、改绑、/新会话时清空 */
  session: { agent: string; id: string } | null
  round: Round | null
  queue: QueuedMessage[]
  /** 上一轮收尾时的编号与结果：同一轮重交回报用它判重 */
  lastClosed: { id: string; text: string } | null
  /** 没送达的结果与它要引用的消息，/状态 时补发 */
  undelivered: { text: string; quote: string }[]
}

export interface Notice {
  id: string
  text: string
  delivered: boolean
}

export interface Book {
  version: 2
  chats: Chat[]
  notices: Notice[]
  /** 近期处理过的 `<chatId>|<msgId>`，网关重推时不重复派单 */
  seen: string[]
  /** 每条触发消息已用掉的被动回复次数（msg_seq 递增、不能重复） */
  replies: Record<string, number>
}

const SEEN_LIMIT = 2000
const REPLIES_LIMIT = 500

export const chatIdOf = (target: string): string => `c2c:${target}`

const emptyBook = (): Book => ({ version: 2, chats: [], notices: [], seen: [], replies: {} })

function requireChatShape(chat: unknown): asserts chat is Record<string, unknown> {
  if (!isRecord(chat) || typeof chat['id'] !== 'string' || typeof chat['target'] !== 'string' || !Array.isArray(chat['queue']) || !Array.isArray(chat['undelivered'])
    || !chat['undelivered'].every((result) => isRecord(result) && typeof result['text'] === 'string' && typeof result['quote'] === 'string')) {
    throw new Error('QQ 聊天表里有一行形状不对，停止处理')
  }
}

/**
 * 系统边界：账本从磁盘读回，形状不对直接报错，不按缺省值往下跑。
 * 第 1 版还有群聊：读到时去掉群聊那几行、私聊去掉 scene 字段，换成第 2 版，droppedGroups 是去掉了几个群聊；下次写盘就是第 2 版
 */
export function loadBook(raw: unknown): { book: Book; droppedGroups: number } {
  if (raw === undefined) return { book: emptyBook(), droppedGroups: 0 }
  if (!isRecord(raw) || (raw['version'] !== 1 && raw['version'] !== 2) || !Array.isArray(raw['chats']) || !Array.isArray(raw['notices']) || !Array.isArray(raw['seen']) || !isRecord(raw['replies'])) {
    throw new Error('QQ 聊天表格式不对（version 1 或 2 的 chats / notices / seen / replies），停止处理')
  }
  if (raw['version'] === 2) {
    for (const chat of raw['chats']) {
      requireChatShape(chat)
      if ('scene' in chat) throw new Error('QQ 聊天表第 2 版里有一行还带着 scene，停止处理')
    }
    return { book: raw as unknown as Book, droppedGroups: 0 }
  }
  const chats: unknown[] = []
  let droppedGroups = 0
  for (const chat of raw['chats']) {
    requireChatShape(chat)
    if (chat['scene'] === 'group') { droppedGroups += 1; continue }
    if (chat['scene'] !== 'c2c') throw new Error('QQ 聊天表第 1 版里有一行的 scene 既不是 c2c 也不是 group，停止处理')
    const c2c: Record<string, unknown> = { ...chat }
    delete c2c['scene']
    chats.push(c2c)
  }
  return { book: { ...(raw as unknown as Book), version: 2, chats: chats as Chat[] }, droppedGroups }
}

/** 聊天表的读写都经同一条串行队列；写盘失败记下来，之后的操作一律报这个错 */
export class ChatTable {
  book: Book = emptyBook()
  /** 读到第 1 版时去掉的群聊个数，装配处记一行日志 */
  droppedGroups = 0
  private queue: Promise<unknown>
  private storageError: unknown

  constructor(private readonly store: { read(): Promise<unknown>; write(value: unknown): Promise<void> }) {
    this.queue = store.read().then((raw) => { ({ book: this.book, droppedGroups: this.droppedGroups } = loadBook(raw)) }).catch((error: unknown) => { this.storageError = error })
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
      chat = { id, target: openid, lastSeen: '', lastSender: '', binding: null, session: null, round: null, queue: [], lastClosed: null, undelivered: [] }
      this.book.chats.push(chat)
    }
    chat.lastSeen = new Date().toISOString()
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

  findRound(roundId: string): Chat | undefined {
    return this.book.chats.find((chat) => chat.round?.id === roundId || chat.lastClosed?.id === roundId)
  }
}
