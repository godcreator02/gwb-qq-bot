/** 聊天表：每个私聊或群一行，连同主人通知的去重与近期消息 id，按 AppID 整份存成一份文档 */
import { isRecord, type MessageScene } from './qq-protocol.js'

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
  /** `<scene>:<target>` */
  id: string
  scene: MessageScene
  /** 私聊是对方 openid，群是 group_openid */
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
  version: 1
  chats: Chat[]
  notices: Notice[]
  /** 近期处理过的 `<chatId>|<msgId>`，网关重推时不重复派单 */
  seen: string[]
  /** 每条触发消息已用掉的被动回复次数（msg_seq 递增、不能重复） */
  replies: Record<string, number>
}

const SEEN_LIMIT = 2000
const REPLIES_LIMIT = 500

export const chatIdOf = (scene: MessageScene, target: string): string => `${scene}:${target}`

/** 系统边界：账本从磁盘读回，形状不对直接报错，不按缺省值往下跑 */
export function loadBook(raw: unknown): Book {
  if (raw === undefined) return { version: 1, chats: [], notices: [], seen: [], replies: {} }
  if (!isRecord(raw) || raw['version'] !== 1 || !Array.isArray(raw['chats']) || !Array.isArray(raw['notices']) || !Array.isArray(raw['seen']) || !isRecord(raw['replies'])) {
    throw new Error('QQ 聊天表格式不对（version 1 的 chats / notices / seen / replies），停止处理')
  }
  for (const chat of raw['chats']) {
    if (!isRecord(chat) || typeof chat['id'] !== 'string' || (chat['scene'] !== 'c2c' && chat['scene'] !== 'group') || typeof chat['target'] !== 'string' || !Array.isArray(chat['queue']) || !Array.isArray(chat['undelivered'])
      || !chat['undelivered'].every((result) => isRecord(result) && typeof result['text'] === 'string' && typeof result['quote'] === 'string')) {
      throw new Error('QQ 聊天表里有一行形状不对，停止处理')
    }
  }
  return raw as unknown as Book
}

/** 聊天表的读写都经同一条串行队列；写盘失败记下来，之后的操作一律报这个错 */
export class ChatTable {
  book: Book = { version: 1, chats: [], notices: [], seen: [], replies: {} }
  private queue: Promise<unknown>
  private storageError: unknown

  constructor(private readonly store: { read(): Promise<unknown>; write(value: unknown): Promise<void> }) {
    this.queue = store.read().then((raw) => { this.book = loadBook(raw) }).catch((error: unknown) => { this.storageError = error })
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
    if (chat === undefined) throw new Error(`没有聊天 ${id}：先在那个私聊或群里给机器人发一条 /帮助，再用 qq-bot.status 查它的 id`)
    return chat
  }

  observe(scene: MessageScene, target: string, sender: string): Chat {
    const id = chatIdOf(scene, target)
    let chat = this.find(id)
    if (chat === undefined) {
      chat = { id, scene, target, lastSeen: '', lastSender: '', binding: null, session: null, round: null, queue: [], lastClosed: null, undelivered: [] }
      this.book.chats.push(chat)
    }
    chat.lastSeen = new Date().toISOString()
    chat.lastSender = sender
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
