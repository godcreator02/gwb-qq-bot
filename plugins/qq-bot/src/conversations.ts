/** 来源、会话与任务的持久化边界；只读取直接回报格式，不接入旧任务或旧凭证。 */
import { createHash } from 'node:crypto'
import { win32 } from 'node:path'
import { isRecord, type MessageScene } from './qq-protocol.js'
import type { ReplyTrigger } from './reply-window.js'

export interface SourceIdentity { home: string; appId: string; scene: MessageScene; target: string }
export interface Binding { agent: string; kind: 'project' | 'personal'; workspace: string; projectRepo: string | null; title: string; journalLibrary: string }
export interface Source extends SourceIdentity { id: string; lastSeen: string; lastSender: string; generation: number; binding: Binding | null }
export interface Conversation { agent: string; id: string; sourceId: string; generation: number; workspace: string; taskId: string | null; roundIndex: number; latest: string | null }
export interface Route { appId: string; scene: MessageScene; target: string; trigger: ReplyTrigger }
export interface SourceSnapshot extends SourceIdentity { senderOpenid: string; senderIsBot: boolean; projectRepo: string | null; title: string; journalLibrary: string }
export interface Job {
  resolutionNote?: string
  agent: string; ticketHash: string | null; dispatch: 'queued' | 'sending' | 'accepted' | 'unknown' | 'resolved'
  id: string; openid: string; sourceId: string; conversationId: string | null; taskId: string | null; workspace: string; round: number
  route: Route; source: SourceSnapshot; prompt: string | null; reportServer: string
  state: 'queued' | 'pending' | 'dispatch_unknown' | 'completed' | 'failed' | 'needs_input'
  text: string | null; delivery: 'pending' | 'sending' | 'delivered' | 'undelivered'
}
export interface Notice { id: string; appId: string; target: string; text: string; state: 'sending' | 'delivered' | 'failed' }
export interface Book { version: 3; sources: Source[]; conversations: Conversation[]; jobs: Job[]; seen: string[]; notices: Notice[] }

export function sourceId(identity: SourceIdentity): string {
  return createHash('sha256').update(JSON.stringify([identity.home, identity.appId, identity.scene, identity.target])).digest('hex')
}

/** 工作区按 Windows 路径判同；根路径仍保留根分隔符，避免混淆 C: 与 C:\\。 */
export function workspaceKey(path: string): string {
  if (path === '') return ''
  const normalized = win32.normalize(path).toLowerCase()
  const root = win32.parse(normalized).root
  return normalized.length > root.length ? normalized.replace(/[\\/]+$/, '') : normalized
}

function fail(at: string): never { throw new Error(`QQ 任务记录格式不正确（${at}），停止处理`) }
function record(value: unknown, at: string): Record<string, unknown> { if (!isRecord(value)) fail(at); return value }
function string(value: unknown, at: string, empty = false): string { if (typeof value !== 'string' || (!empty && value.trim() === '')) fail(at); return value }
function nullableString(value: unknown, at: string, empty = false): string | null { return value === null ? null : string(value, at, empty) }
function integer(value: unknown, at: string, minimum = 0): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) fail(at); return value }
function oneOf<T extends string>(value: unknown, choices: readonly T[], at: string): T { if (typeof value !== 'string' || !choices.includes(value as T)) fail(at); return value as T }
function array<T>(value: unknown, at: string, parse: (value: unknown, at: string) => T): T[] {
  if (!Array.isArray(value)) fail(at)
  return value.map((each, index) => parse(each, `${at}[${index}]`))
}
function unique<T>(items: T[], key: (item: T) => string, at: string): void {
  const keys = items.map(key)
  if (new Set(keys).size !== keys.length) fail(`${at} 重复`)
}
function identity(value: Record<string, unknown>, at: string): SourceIdentity {
  return { home: string(value.home, `${at}.home`), appId: string(value.appId, `${at}.appId`), scene: oneOf(value.scene, ['group', 'c2c'], `${at}.scene`), target: string(value.target, `${at}.target`) }
}
function trigger(value: unknown, at: string): ReplyTrigger {
  const raw = record(value, at)
  const receivedAt = integer(raw.receivedAt, `${at}.receivedAt`)
  if (!Number.isFinite(new Date(receivedAt).getTime())) fail(`${at}.receivedAt`)
  return { msgId: string(raw.msgId, `${at}.msgId`), receivedAt, repliesSent: integer(raw.repliesSent, `${at}.repliesSent`) }
}
function route(value: unknown, at: string): Route {
  const raw = record(value, at)
  return { appId: string(raw.appId, `${at}.appId`), scene: oneOf(raw.scene, ['group', 'c2c'], `${at}.scene`), target: string(raw.target, `${at}.target`), trigger: trigger(raw.trigger, `${at}.trigger`) }
}
function binding(value: unknown, at: string): Binding | null {
  if (value === null) return null
  const raw = record(value, at)
  const parsed: Binding = { agent: string(raw.agent, `${at}.agent`), kind: oneOf(raw.kind, ['project', 'personal'], `${at}.kind`), workspace: string(raw.workspace, `${at}.workspace`), projectRepo: nullableString(raw.projectRepo, `${at}.projectRepo`), title: string(raw.title, `${at}.title`), journalLibrary: string(raw.journalLibrary, `${at}.journalLibrary`, true) }
  if ((parsed.kind === 'project') !== (parsed.projectRepo !== null)) fail(`${at}.projectRepo`)
  return parsed
}
function source(value: unknown, at: string): Source {
  const raw = record(value, at)
  const parsed: Source = { ...identity(raw, at), id: string(raw.id, `${at}.id`), lastSeen: string(raw.lastSeen, `${at}.lastSeen`), lastSender: string(raw.lastSender, `${at}.lastSender`), generation: integer(raw.generation, `${at}.generation`), binding: binding(raw.binding, `${at}.binding`) }
  if (!Number.isFinite(Date.parse(parsed.lastSeen)) || parsed.id !== sourceId(parsed)) fail(at)
  if (parsed.binding !== null && (parsed.scene === 'group') !== (parsed.binding.kind === 'project')) fail(`${at}.binding.kind`)
  return parsed
}
function snapshot(value: unknown, at: string): SourceSnapshot {
  const raw = record(value, at)
  if (typeof raw.senderIsBot !== 'boolean') fail(`${at}.senderIsBot`)
  return { ...identity(raw, at), senderOpenid: string(raw.senderOpenid, `${at}.senderOpenid`), senderIsBot: raw.senderIsBot, projectRepo: nullableString(raw.projectRepo, `${at}.projectRepo`), title: string(raw.title, `${at}.title`), journalLibrary: string(raw.journalLibrary, `${at}.journalLibrary`, true) }
}
function conversation(value: unknown, at: string): Conversation {
  const raw = record(value, at)
  return { agent: string(raw.agent, `${at}.agent`), id: string(raw.id, `${at}.id`), sourceId: string(raw.sourceId, `${at}.sourceId`), generation: integer(raw.generation, `${at}.generation`), workspace: string(raw.workspace, `${at}.workspace`), taskId: nullableString(raw.taskId, `${at}.taskId`), roundIndex: integer(raw.roundIndex, `${at}.roundIndex`), latest: nullableString(raw.latest, `${at}.latest`) }
}
function job(value: unknown, at: string): Job {
  const raw = record(value, at)
  const parsed: Job = {
    ...(raw.resolutionNote === undefined ? {} : { resolutionNote: string(raw.resolutionNote, `${at}.resolutionNote`) }),
    agent: string(raw.agent, `${at}.agent`), ticketHash: nullableString(raw.ticketHash, `${at}.ticketHash`), dispatch: oneOf(raw.dispatch, ['queued', 'sending', 'accepted', 'unknown', 'resolved'], `${at}.dispatch`),
    id: string(raw.id, `${at}.id`), openid: string(raw.openid, `${at}.openid`), sourceId: string(raw.sourceId, `${at}.sourceId`), conversationId: nullableString(raw.conversationId, `${at}.conversationId`), taskId: nullableString(raw.taskId, `${at}.taskId`), workspace: string(raw.workspace, `${at}.workspace`), round: integer(raw.round, `${at}.round`, 1),
    route: route(raw.route, `${at}.route`), source: snapshot(raw.source, `${at}.source`), prompt: nullableString(raw.prompt, `${at}.prompt`), reportServer: string(raw.reportServer, `${at}.reportServer`, true),
    state: oneOf(raw.state, ['queued', 'pending', 'dispatch_unknown', 'completed', 'failed', 'needs_input'], `${at}.state`), text: nullableString(raw.text, `${at}.text`, true), delivery: oneOf(raw.delivery, ['pending', 'sending', 'delivered', 'undelivered'], `${at}.delivery`),
  }
  if ((parsed.ticketHash !== null && !/^[a-f0-9]{64}$/u.test(parsed.ticketHash)) || (parsed.dispatch !== 'queued' && parsed.ticketHash === null)) fail(`${at}.ticketHash`)
  if (parsed.conversationId === null || parsed.prompt === null || parsed.reportServer.trim() === '') fail(`${at}.conversation`)
  if (parsed.sourceId !== sourceId(parsed.source) || parsed.openid !== parsed.source.senderOpenid || parsed.route.appId !== parsed.source.appId || parsed.route.scene !== parsed.source.scene || parsed.route.target !== parsed.source.target) fail(`${at}.source/route`)
  if (['completed', 'failed', 'needs_input'].includes(parsed.state) !== (parsed.text !== null)) fail(`${at}.state/text`)
  if (parsed.conversationId !== null && (parsed.prompt === null || parsed.reportServer.trim() === '')) fail(`${at}.prompt/reportServer`)
  if (parsed.state === 'queued' && parsed.conversationId === null) fail(`${at}.conversationId`)
  return parsed
}
function notice(value: unknown, at: string): Notice {
  const raw = record(value, at)
  return { id: string(raw.id, `${at}.id`), appId: string(raw.appId, `${at}.appId`), target: string(raw.target, `${at}.target`), text: string(raw.text, `${at}.text`), state: oneOf(raw.state, ['sending', 'delivered', 'failed'], `${at}.state`) }
}

function validateV3(raw: Record<string, unknown>): Book {
  const book: Book = { version: 3, sources: array(raw.sources, 'sources', source), conversations: array(raw.conversations, 'conversations', conversation), jobs: array(raw.jobs, 'jobs', job), seen: array(raw.seen, 'seen', (value, at) => string(value, at)), notices: array(raw.notices, 'notices', notice) }
  unique(book.sources, (each) => each.id, 'sources.id')
  unique(book.conversations, (each) => each.id, 'conversations.id')
  unique(book.jobs, (each) => each.id, 'jobs.id')
  unique(book.jobs.filter((each) => each.ticketHash !== null), (each) => each.ticketHash!, 'jobs.ticketHash')
  unique(book.notices, (each) => JSON.stringify([each.appId, each.id]), 'notices.id')
  unique(book.seen, (each) => each, 'seen')
  const sources = new Map(book.sources.map((each) => [each.id, each]))
  const conversations = new Map(book.conversations.map((each) => [each.id, each]))
  const jobs = new Map(book.jobs.map((each) => [each.id, each]))
  for (const each of book.conversations) {
    const owner = sources.get(each.sourceId)
    if (owner === undefined || each.generation > owner.generation) fail(`conversation ${each.id} source/generation`)
    const latest = each.latest === null ? undefined : jobs.get(each.latest)
    if (each.latest !== null && (latest === undefined || latest.conversationId !== each.id || latest.round !== each.roundIndex)) fail(`conversation ${each.id} latest`)
  }
  for (const each of book.jobs) {
    if (!sources.has(each.sourceId)) fail(`job ${each.id} source`)
    if (each.conversationId === null) continue
    const owner = conversations.get(each.conversationId)
    if (owner === undefined || owner.sourceId !== each.sourceId || owner.agent !== each.agent || owner.workspace !== each.workspace || each.round > owner.roundIndex) fail(`job ${each.id} conversation`)
  }
  return book
}

function emptyBook(): Book { return { version: 3, sources: [], conversations: [], jobs: [], seen: [], notices: [] } }

export function loadBook(raw: unknown, owner: { home: string; appId: string }): Book {
  string(owner.home, 'identity.home'); string(owner.appId, 'identity.appId', true)
  if (raw === undefined) return emptyBook()
  const doc = record(raw, 'book')
  if (doc.version !== 3) return fail('version：仅接受直接回报账本，不迁移旧凭证')
  const book = validateV3(doc)
  if ([book.sources, book.conversations, book.jobs, book.seen, book.notices].some((items) => items.length > 0)) string(owner.appId, 'identity.appId')
  return book
}
