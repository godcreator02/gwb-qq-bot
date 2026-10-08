/**
 * 消息记录：机器人收到的每条私聊、发出的每条消息，按机器人、按月追加进 JSONL 文件，命令 qq-bot.messages 查。
 * 记录是旁路：写失败只记一行 warn，收发照常。正文只进这里，不进共用的 gwb.log
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { chatIdOf } from '../storage/chat-table.js'
import { isRecord, type IncomingMessage, type QqLog } from './qq-protocol.js'
import type { SendOutcome } from './qq-rest.js'

/** 出站的种类；qq/ 不认识任务组，种类、组名、本轮编号都由调用方给 */
export type OutboundKind =
  /** 收到任务时的即时回应：已接收、排在第几个 */
  | 'receipt'
  /** 一轮的结果，包括执行端结束了却没回报时发回的最后回答 */
  | 'result'
  /** /状态 补发的没送达的结果 */
  | 'resend'
  /** 主动私聊主人的通知 */
  | 'notice'
  /** 保留命令（/帮助、/状态、/新会话）与直接命令的回答 */
  | 'command-answer'
  /** 这条没有派出的说明：没有指令、用法、重名、组派不出去、派单失败 */
  | 'not-dispatched'

export interface OutboundPurpose {
  kind: OutboundKind
  /** 回执里的组名，默认组是「默认」 */
  group?: string
  /** 本轮编号 */
  round?: string
  /** 通知的 id */
  notice?: string
}

/** 分段发送时每段各发一次、各记一条 */
export interface SendPurpose extends OutboundPurpose {
  segment: { index: number; total: number }
}

/** 发一条私聊：msgId / msgSeq 缺省是主动消息，quote 是要引用的消息 id */
export type RawSendC2c = (openid: string, content: string, msgId: string | undefined, msgSeq: number | undefined, quote: string | undefined) => Promise<SendOutcome>
/** 同 RawSendC2c，多一个用途，经 MessageLog.recordingSend 包出来，发完记一条 */
export type SendC2c = (openid: string, content: string, msgId: string | undefined, msgSeq: number | undefined, quote: string | undefined, purpose: SendPurpose) => Promise<SendOutcome>

export type NotDispatchedReason = 'empty' | 'duplicate' | 'unknown-command' | 'usage' | 'conflict' | 'group-unavailable'

/** 白名单里的入站分到哪；由派任务算好传进来 */
export type InboundRoute =
  | { route: 'group'; group: string }
  | { route: 'reserved'; command: string }
  | { route: 'direct'; command: string }
  | { route: 'not-dispatched'; reason: NotDispatchedReason; group?: string; command?: string; detail?: string }

export type SendResult = { ok: true } | { ok: false; status?: number; code?: number; message: string }

interface RecordBase {
  /** ISO 时间（UTC） */
  at: string
  /** `c2c:<openid>`，和 qq-bot.status 的私聊 id 相同 */
  chat: string
}

export type InboundRecord = RecordBase & { direction: 'in'; msgId: string; text: string } & InboundRoute
export type RejectedRecord = RecordBase & { direction: 'in'; msgId: string; route: 'rejected'; excerpt: string }
export type OutboundRecord = RecordBase & OutboundPurpose & {
  direction: 'out'
  /** 发出去的消息 id；没发出去是 null */
  msgId: string | null
  mode: 'passive' | 'active'
  /** 被动回复挂在哪条消息上 */
  replyTo?: string
  msgSeq?: number
  quote?: string
  segment: { index: number; total: number }
  text: string
  result: SendResult
}
export type MessageRecord = InboundRecord | RejectedRecord | OutboundRecord

/** 白名单外的入站只记正文前这么多字 */
export const REJECTED_EXCERPT_CHARS = 40
/** 当月之外再留几个月的文件 */
export const KEEP_PREVIOUS_MONTHS = 3
export const QUERY_DEFAULT_LIMIT = 50
export const QUERY_MAX_LIMIT = 500
/** MCP 入口单次回执的上限，按交回的文本（两格缩进的 JSON）算 */
export const REPLY_MAX_CHARS = 40_000

const FILE_PATTERN = /^messages-(.+)-(\d{4}-\d{2})\.jsonl$/u

export const monthOf = (at: string): string => at.slice(0, 7)

export function messageFileName(appId: string, month: string): string {
  return `messages-${appId}-${month}.jsonl`
}

/** 比 month 早 count 个月的那个月，都是 YYYY-MM */
function monthsBefore(month: string, count: number): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number]
  const date = new Date(Date.UTC(year, monthNumber - 1 - count, 1))
  return date.toISOString().slice(0, 7)
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** 目录还没建出来就是还没有记录 */
async function listFiles(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir)
  } catch (error) {
    if (isRecord(error) && error['code'] === 'ENOENT') return []
    throw error
  }
}

export interface MessageLogOptions {
  /** qq-bot 在这个 home 里的数据目录 */
  dir: string
  appId: string
  log: QqLog
  now?: () => number
}

/** 一个机器人的消息记录：写入按顺序排队，不让收发等它 */
export class MessageLog {
  private writes: Promise<void> = Promise.resolve()
  private lastMonth: string
  private readonly now: () => number

  constructor(private readonly options: MessageLogOptions) {
    this.now = options.now ?? (() => Date.now())
    this.lastMonth = monthOf(this.nowIso())
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString()
  }

  inbound(message: IncomingMessage, route: InboundRoute): void {
    this.append({ at: this.nowIso(), direction: 'in', chat: chatIdOf(message.senderOpenid), msgId: message.msgId, text: message.content, ...route })
  }

  rejected(message: IncomingMessage): void {
    this.append({ at: this.nowIso(), direction: 'in', chat: chatIdOf(message.senderOpenid), msgId: message.msgId, route: 'rejected', excerpt: message.content.slice(0, REJECTED_EXCERPT_CHARS) })
  }

  /** 包一层发消息的函数：每次发完（成功、官方回失败、抛错）记一条，再原样交回结果或抛出 */
  recordingSend(send: RawSendC2c): SendC2c {
    return async (openid, content, msgId, msgSeq, quote, purpose) => {
      let outcome: SendOutcome
      try {
        outcome = await send(openid, content, msgId, msgSeq, quote)
      } catch (error) {
        this.outbound(openid, content, msgId, msgSeq, quote, purpose, null, { ok: false, message: errorText(error) })
        throw error
      }
      const result: SendResult = outcome.ok ? { ok: true } : { ok: false, status: outcome.status, ...(outcome.code === undefined ? {} : { code: outcome.code }), message: outcome.message }
      this.outbound(openid, content, msgId, msgSeq, quote, purpose, outcome.ok ? outcome.id : null, result)
      return outcome
    }
  }

  private outbound(openid: string, content: string, msgId: string | undefined, msgSeq: number | undefined, quote: string | undefined, purpose: SendPurpose, sentId: string | null, result: SendResult): void {
    const { segment, ...about } = purpose
    const passive = msgId === undefined ? { mode: 'active' as const } : { mode: 'passive' as const, replyTo: msgId, ...(msgSeq === undefined ? {} : { msgSeq }) }
    this.append({
      at: this.nowIso(), direction: 'out', chat: chatIdOf(openid), msgId: sentId, ...about, ...passive,
      ...(quote === undefined ? {} : { quote }), segment, text: content, result,
    })
  }

  /** 删掉当月与前 KEEP_PREVIOUS_MONTHS 个月以外的记录文件（所有机器人的），排在写入后面做 */
  prune(): void {
    this.enqueue(async () => {
      const oldestKept = monthsBefore(monthOf(this.nowIso()), KEEP_PREVIOUS_MONTHS)
      const expired = (await listFiles(this.options.dir)).filter((name) => {
        const month = FILE_PATTERN.exec(name)?.[2]
        return month !== undefined && month < oldestKept
      })
      for (const name of expired) await fs.unlink(path.join(this.options.dir, name))
      if (expired.length > 0) this.options.log.info(`删掉了 ${expired.length} 个 ${oldestKept} 以前的消息记录文件`)
    }, '清理旧的消息记录')
  }

  /** 排着的写入都做完 */
  settle(): Promise<void> {
    return this.writes
  }

  private append(record: MessageRecord): void {
    const month = monthOf(record.at)
    const file = path.join(this.options.dir, messageFileName(this.options.appId, month))
    this.enqueue(async () => {
      await fs.mkdir(this.options.dir, { recursive: true })
      await fs.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
    }, '写消息记录')
    if (month !== this.lastMonth) {
      this.lastMonth = month
      this.prune()
    }
  }

  /** 记录是旁路：失败只记一行 warn（不带正文），不往外抛 */
  private enqueue(work: () => Promise<void>, what: string): void {
    this.writes = this.writes.then(work).catch((error: unknown) => this.options.log.warn(`${what}失败（收发不受影响）：${errorText(error)}`))
  }
}

export interface MessageQuery {
  chat?: string
  group?: string
  round?: string
  direction?: 'in' | 'out'
  since?: string
  limit: number
}

const QUERY_KEYS = ['chat', 'group', 'round', 'direction', 'since', 'limit']

/** qq-bot.messages 的参数：都可选，不认识的键、类型不对、超出范围都报错 */
export function parseMessageQuery(raw: unknown): MessageQuery {
  if (raw === undefined) return { limit: QUERY_DEFAULT_LIMIT }
  if (!isRecord(raw)) throw new Error(`qq-bot.messages 的参数要是对象，可含 ${QUERY_KEYS.join('、')}`)
  const unknownKeys = Object.keys(raw).filter((key) => !QUERY_KEYS.includes(key))
  if (unknownKeys.length > 0) throw new Error(`qq-bot.messages 不认识参数 ${unknownKeys.join('、')}，只收 ${QUERY_KEYS.join('、')}`)
  const query: MessageQuery = { limit: QUERY_DEFAULT_LIMIT }
  for (const key of ['chat', 'group', 'round'] as const) {
    const value = raw[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${key} 要是非空字符串`)
    query[key] = value.trim()
  }
  const direction = raw['direction']
  if (direction !== undefined) {
    if (direction !== 'in' && direction !== 'out') throw new Error('direction 只能是 in 或 out')
    query.direction = direction
  }
  const since = raw['since']
  if (since !== undefined) {
    if (typeof since !== 'string' || !/^\d{4}-\d{2}-\d{2}/u.test(since) || Number.isNaN(Date.parse(since))) throw new Error('since 要是 ISO 时间，如 2026-10-08 或 2026-10-08T08:00:00Z')
    query.since = since
  }
  const limit = raw['limit']
  if (limit !== undefined) {
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > QUERY_MAX_LIMIT) throw new Error(`limit 要是 1–${QUERY_MAX_LIMIT} 的整数`)
    query.limit = limit
  }
  return query
}

function matches(record: MessageRecord, query: MessageQuery, sinceMs: number | null): boolean {
  if (query.chat !== undefined && record.chat !== query.chat) return false
  if (query.direction !== undefined && record.direction !== query.direction) return false
  if (query.group !== undefined && !('group' in record && record.group === query.group)) return false
  if (query.round !== undefined && !('round' in record && record.round === query.round)) return false
  if (sinceMs !== null && Date.parse(record.at) < sinceMs) return false
  return true
}

/** 系统边界：文件是自己写的，读出来的行不是记录说明文件被改坏了，报错指出哪一行 */
function parseLine(line: string, file: string, lineNumber: number): MessageRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    throw new Error(`消息记录 ${file} 第 ${lineNumber} 行不是 JSON`)
  }
  if (!isRecord(parsed) || typeof parsed['at'] !== 'string' || typeof parsed['chat'] !== 'string' || (parsed['direction'] !== 'in' && parsed['direction'] !== 'out')) {
    throw new Error(`消息记录 ${file} 第 ${lineNumber} 行形状不对`)
  }
  return parsed as unknown as MessageRecord
}

export interface MessageQueryResult {
  appId: string
  /** 按时间倒序 */
  records: MessageRecord[]
  /** 还有更早的符合条件的记录没交回 */
  more: boolean
}

/** 跨月份文件按时间倒序找最近的 limit 条；回执超过 MCP 单次上限就报错，让调用方缩小范围 */
export async function queryMessages(dir: string, appId: string, query: MessageQuery): Promise<MessageQueryResult> {
  const sinceMs = query.since === undefined ? null : Date.parse(query.since)
  const sinceMonth = sinceMs === null ? null : new Date(sinceMs).toISOString().slice(0, 7)
  const months = (await listFiles(dir))
    .map((name) => FILE_PATTERN.exec(name))
    .filter((match) => match !== null && match[1] === appId)
    .map((match) => match![2]!)
    .filter((month) => sinceMonth === null || month >= sinceMonth)
    .sort()
    .reverse()
  const found: MessageRecord[] = []
  for (const month of months) {
    const file = messageFileName(appId, month)
    const lines = (await fs.readFile(path.join(dir, file), 'utf8')).split('\n')
    for (let index = lines.length - 1; index >= 0 && found.length <= query.limit; index--) {
      const line = lines[index]!
      if (line.trim() === '') continue
      const record = parseLine(line, file, index + 1)
      if (matches(record, query, sinceMs)) found.push(record)
    }
    if (found.length > query.limit) break
  }
  const result = { appId, records: found.slice(0, query.limit), more: found.length > query.limit }
  const size = JSON.stringify({ ok: true, data: result }, null, 2).length
  if (size > REPLY_MAX_CHARS) {
    throw new Error(`qq-bot.messages 这次要交回 ${size} 字，超过 MCP 单次 ${REPLY_MAX_CHARS} 字的上限：把 limit 改小（这次 ${query.limit}），或加 chat、group、round、direction、since 缩小范围`)
  }
  return result
}
