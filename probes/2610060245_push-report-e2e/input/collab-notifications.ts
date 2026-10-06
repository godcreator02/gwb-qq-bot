import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { Attention } from '@godcreator/collab-site/launch'
import type { CommandBus } from '../gitea/access.js'

interface Observation { repo: string; fingerprint: string; revision: number; text: string; pending: boolean }
interface AiResult { id: string; repo: string; state: string; text: string | null; taskId: string | null }
interface Book { version: 1; observations: Observation[]; results: AiResult[] }
export class QqNotifications {
  private book: Book = { version: 1, observations: [], results: [] }
  private queue: Promise<unknown>
  private storageError: unknown
  constructor(private readonly deps: {
    enabled(): boolean; server(): string; commands: Pick<CommandBus, 'run'>
    read(): Promise<unknown>; write(value: unknown): Promise<void>; warn(text: string): void
  }) {
    this.queue = deps.read().then((raw) => {
      if (raw === undefined) return
      const doc = raw as Book
      if (doc.version !== 1 || !Array.isArray(doc.observations) || !Array.isArray(doc.results)) throw new Error('协作站 QQ 通知记录格式不正确')
      this.book = doc
    }).catch((error: unknown) => { this.storageError = error })
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => {
      if (this.storageError !== undefined) throw this.storageError
      return run()
    })
    this.queue = next.catch(() => {})
    return next
  }
  private async save(): Promise<void> {
    try { await this.deps.write(this.book) }
    catch (error) { this.storageError = error; throw error }
  }
  observe(repo: string, attention: Attention): Promise<void> {
    return this.serial(async () => {
      if (!this.deps.enabled()) return
      // git 文件变化只触发入口；播报内容仅取检查结论，不广播每次保存。
      const pulls = [...(attention.pendingPulls ?? [])].sort((a, b) => a.url.localeCompare(b.url))
      const problems = [attention.checkError, attention.syncProblem, attention.submitFailure].filter((text): text is string => text !== null)
      if (attention.conflicts.length > 0) problems.push(`有 ${attention.conflicts.length} 个冲突文件`)
      const fingerprint = JSON.stringify({ pulls, problems })
      let observation = this.book.observations.find((item) => item.repo === repo)
      if (observation === undefined) {
        observation = { repo, fingerprint: '', revision: 0, text: '', pending: false }
        this.book.observations.push(observation)
      }
      if (observation.fingerprint !== fingerprint) {
        observation.fingerprint = fingerprint
        observation.revision++
        const lines = pulls.map((pull) => `${pull.repo} MR #${pull.number}：${pull.title}（${pull.poster}）`)
        observation.text = [`协作站 ${path.basename(repo)}`, ...lines, ...problems].join('\n').slice(0, 600)
        observation.pending = lines.length > 0 || problems.length > 0
        await this.save()
      }
      if (!observation.pending) return
      const repoId = createHash('sha256').update(repo).digest('hex').slice(0, 24)
      await this.notify(`collab-${repoId}-${observation.revision}`, observation.text)
      observation.pending = false
      await this.save()
    })
  }
  prepareAi(repo: string): Promise<{ id: string; callback: string; server: string } | undefined> {
    return this.serial(async () => {
      if (!this.deps.enabled()) return undefined
      const id = randomUUID()
      this.book.results.push({ id, repo, state: 'pending', text: null, taskId: null })
      await this.save()
      return { id, callback: 'collab.receive-report', server: this.deps.server() }
    })
  }
  receive(raw: unknown): Promise<{ accepted: true }> {
    return this.serial(async () => {
      const report = raw as { id?: string; taskId?: string; workspace?: string; text?: string; state?: string }
      if (report === null || typeof report !== 'object' || typeof report.text !== 'string' || typeof report.taskId !== 'string' || !['completed', 'failed', 'needs_input'].includes(report.state ?? '')) throw new Error('协作站回报格式不正确')
      const result = this.book.results.find((each) => each.id === report.id)
      if (result === undefined || result.repo !== report.workspace) throw new Error('本 home 没有这次协作站派单')
      if (result.text !== null && (result.text !== report.text || result.state !== report.state)) throw new Error('该协作任务已有不同结果')
      result.text = report.text; result.state = report.state!; result.taskId = report.taskId
      await this.save()
      if (this.deps.enabled()) await this.notify(`collab-ai-${result.id}`, `协作站 ${path.basename(result.repo)}：${result.state}\n${result.text}`.slice(0, 600))
      return { accepted: true }
    })
  }
  private async notify(id: string, text: string): Promise<void> {
    try {
      const sent = await this.deps.commands.run('qq-bot.notify', { id, text })
      if (!sent.ok || !(sent.data as { delivered?: boolean } | undefined)?.delivered) this.deps.warn(`QQ 通知 ${id} 未送达，结果仍保留在协作站`)
    } catch { this.deps.warn(`QQ 通知 ${id} 调用失败，结果仍保留在协作站`) }
  }
  async results(): Promise<AiResult[]> {
    await this.queue
    if (this.storageError !== undefined) throw this.storageError
    return structuredClone(this.book.results)
  }
  async close(): Promise<void> { await this.queue }
}
