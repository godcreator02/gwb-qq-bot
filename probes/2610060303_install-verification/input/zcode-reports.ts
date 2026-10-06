import { randomUUID } from 'node:crypto'

export type ReportState = 'completed' | 'failed' | 'needs_input'
export interface ReportTarget { id: string; callback: string; server: string }
export interface TaskReport { id: string; taskId: string; workspace: string; state: ReportState; text: string; reportedAt: string }
interface Entry {
  target: ReportTarget
  ticket: string
  workspace: string
  taskId: string
  result: TaskReport | null
  accepted: boolean
}
export interface ReportDeps {
  home: string
  read(): Promise<unknown>
  write(value: unknown): Promise<void>
  deliver(command: string, report: TaskReport): Promise<{ ok: boolean; error?: string }>
  warn(message: string): void
}

function object(raw: unknown, keys: string[]): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('回报参数必须是对象')
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`回报参数只接受 ${keys.join(', ')}`)
  return value
}
function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`缺少 ${name}`)
  return value
}
export function parseReportTarget(raw: unknown): ReportTarget | undefined {
  if (raw === undefined) return undefined
  const value = object(raw, ['id', 'callback', 'server'])
  const id = string(value.id, 'report.id')
  const callback = string(value.callback, 'report.callback')
  const server = string(value.server, 'report.server')
  if (!/^[\w.-]{1,160}$/u.test(id) || !/^[a-z][\w.-]{1,100}$/u.test(callback) || !/^[\w-]{1,80}$/u.test(server)) throw new Error('report 的 id / callback / server 格式不正确')
  return { id, callback, server }
}
export function parseReport(raw: unknown): { ticket: string; state: ReportState; text: string } {
  const value = object(raw, ['ticket', 'state', 'text'])
  if (!['completed', 'failed', 'needs_input'].includes(String(value.state))) throw new Error('state 必须是 completed / failed / needs_input')
  const text = string(value.text, 'text')
  if (text.length > 16000) throw new Error('回报最多 16000 字符，请提交结果摘要')
  return { ticket: string(value.ticket, 'ticket'), state: value.state as ReportState, text }
}
export function parseReplay(raw: unknown): string {
  return string(object(raw, ['callback']).callback, 'callback')
}

/** 先保存报告再通知调用方。通知失败保留报告，由调用方加载时或同一 ticket 重交时补交。 */
export class ReportBook {
  private entries: Entry[] = []
  private queue: Promise<unknown>
  private storageError: unknown
  private readonly delivering = new Map<string, Promise<boolean>>()

  constructor(private readonly deps: ReportDeps) {
    this.queue = deps.read().then((raw) => {
      if (raw === undefined) return
      const doc = raw as { version?: unknown; entries?: Entry[] }
      if (doc.version !== 1 || !Array.isArray(doc.entries)) throw new Error('ZCode 回报记录格式不正确，停止写入')
      this.entries = doc.entries
    }).catch((error: unknown) => { this.storageError = error; throw error })
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => { if (this.storageError !== undefined) throw this.storageError; return run() })
    this.queue = next.catch(() => {})
    return next
  }
  private async save(): Promise<void> {
    try { await this.deps.write({ version: 1, entries: this.entries }) }
    catch (error) { this.storageError = error; throw error }
  }

  async prepare(target: ReportTarget, workspace: string, taskId: string): Promise<string> {
    return this.serial(async () => {
      if (this.entries.some((entry) => entry.target.id === target.id)) throw new Error('这轮派单 id 已存在；不要重复派发，请查原任务')
      const ticket = randomUUID()
      this.entries.push({ target, ticket, workspace, taskId, result: null, accepted: false })
      await this.save()
      return ticket
    })
  }

  prompt(prompt: string, target: ReportTarget, ticket: string): string {
    return `${prompt}\n\n[本轮结果回报约定]\n任务来源 home=${this.deps.home}，MCP 服务名=${target.server}。本轮 ticket=${ticket}。\n完成工作后、最终答复之前，经这个 MCP 服务的 run 调用 zcode.report，参数 {ticket: 上面的本轮 ticket, state: "completed" 或 "failed" 或 "needs_input", text: 给发起人的结果或需要回答的问题}。必须实际调用工具，不能只在聊天里写结果。回报成功后结束本轮，不再执行工作。只用本轮 ticket，不能用历史 ticket；不要把 ticket 发到 QQ、笔记或仓库。调用失败时保留原 ticket 重试报告，不能重做任务。不要通过其他 home 的同名命令回报。`
  }

  async report(raw: unknown): Promise<{ recorded: true; accepted: boolean; duplicate: boolean }> {
    const input = parseReport(raw)
    // 参数或未知 ticket 的拒绝不使写队列失效。
    await this.queue
    const entry = this.entries.find((each) => each.ticket === input.ticket)
    if (entry === undefined) throw new Error('本 home 不认识这个回报 ticket，请使用派单指定的 MCP 服务')
    if (entry.result !== null && (entry.result.text !== input.text || entry.result.state !== input.state)) throw new Error('本轮已有不同结果，不能覆盖；请开启下一轮')
    const duplicate = entry.result !== null
    await this.serial(async () => {
      if (entry.result !== null && (entry.result.text !== input.text || entry.result.state !== input.state)) throw new Error('本轮已有不同结果')
      if (entry.result === null) {
        entry.result = { id: entry.target.id, taskId: entry.taskId, workspace: entry.workspace, state: input.state, text: input.text, reportedAt: new Date().toISOString() }
        await this.save()
      }
    })
    return { recorded: true, accepted: await this.deliver(entry), duplicate }
  }

  async replay(callback: string): Promise<{ pending: number }> {
    await this.queue
    const entries = this.entries.filter((entry) => entry.target.callback === callback && entry.result !== null && !entry.accepted)
    for (const entry of entries) await this.deliver(entry)
    return { pending: entries.filter((entry) => !entry.accepted).length }
  }

  private deliver(entry: Entry): Promise<boolean> {
    if (entry.accepted) return Promise.resolve(true)
    const running = this.delivering.get(entry.ticket)
    if (running !== undefined) return running
    const pending = this.deliverOnce(entry).finally(() => this.delivering.delete(entry.ticket))
    this.delivering.set(entry.ticket, pending)
    return pending
  }
  private async deliverOnce(entry: Entry): Promise<boolean> {
    if (entry.result === null) return false
    try {
      const outcome = await this.deps.deliver(entry.target.callback, entry.result)
      if (!outcome.ok) { this.deps.warn(`回报 ${entry.target.id} 已保存，接收方暂未接收`); return false }
      await this.serial(async () => { entry.accepted = true; await this.save() })
      return true
    } catch {
      this.deps.warn(`回报 ${entry.target.id} 已保存，接收方调用失败`)
      return false
    }
  }
  async close(): Promise<void> { await Promise.allSettled([this.queue, ...this.delivering.values()]) }
}
