/**
 * 单聊指令面板（手机 QQ 私聊里打「/」弹出的那一栏）：给定条目与能看到它的 openid，让 QQ 那边的面板变成这样。
 * 条目按什么顺序由调用方给，这里只套官方的上限、防抖、找到我们的面板再增删改
 */
import { PANEL_ERROR_BUSY, PANEL_ITEM_COMMAND, PANEL_TARGET_SPECIFIC, type PanelItem, type PanelPage, type QqLog } from './qq-protocol.js'
import { QqApiError, type PanelContent } from './qq-rest.js'

/** 写在面板备注里，按它认出这个插件建的面板；备注不对用户展示 */
export const PANEL_MARKER = 'gwb-qq-bot 自动同步'
export const PANEL_MAX_ITEMS = 20
/** 建面板与改关联用户时官方单次最多 20 个 */
export const PANEL_MAX_OPENIDS = 20
/** 官方上限：name 14 个字符、desc 30 个字符，汉字约算 2 个 */
const PANEL_NAME_MAX_WEIGHT = 14
const PANEL_DESC_MAX_WEIGHT = 30
const ELLIPSIS = '…'
/** 注册表变化停下这么久才同步一次 */
export const PANEL_DEBOUNCE_MS = 2_000
/** 撞上「面板操作进行中」后隔这么久重试一次 */
export const PANEL_BUSY_RETRY_MS = 5_000
/** 白名单设置没有变化通知，隔这么久在本地比对一次，变了才排同步 */
export const PANEL_WATCH_INTERVAL_MS = 30_000

/** 调用方给的一条：完整的斜杠命令与一句说明 */
export interface PanelCandidate {
  command: string
  description: string
}

export interface OmittedPanelEntry {
  command: string
  reason: string
}

/** 汉字等非 ASCII 字符算 2，其余算 1 */
export function panelTextWeight(text: string): number {
  let weight = 0
  for (const character of text) weight += character.codePointAt(0)! > 0x7f ? 2 : 1
  return weight
}

/** 超过上限就截短，末尾换成「…」 */
export function truncateToWeight(text: string, maxWeight: number): string {
  if (panelTextWeight(text) <= maxWeight) return text
  let kept = '', weight = panelTextWeight(ELLIPSIS)
  for (const character of text) {
    weight += panelTextWeight(character)
    if (weight > maxWeight) break
    kept += character
  }
  return kept + ELLIPSIS
}

/** 按调用方给的顺序排成面板条目：名字超长、超过 20 条的不进面板并写明原因；说明超长只截短展示文字；同一个命令只放一次 */
export function planPanelItems(candidates: PanelCandidate[]): { items: PanelItem[]; omitted: OmittedPanelEntry[] } {
  const items: PanelItem[] = [], omitted: OmittedPanelEntry[] = [], seen = new Set<string>()
  for (const { command, description } of candidates) {
    if (seen.has(command)) continue
    seen.add(command)
    const nameWeight = panelTextWeight(command)
    if (nameWeight > PANEL_NAME_MAX_WEIGHT) {
      omitted.push({ command, reason: `名字超过面板上限 ${PANEL_NAME_MAX_WEIGHT}（含斜杠，汉字算 2），这个是 ${nameWeight}` })
      continue
    }
    if (items.length >= PANEL_MAX_ITEMS) {
      omitted.push({ command, reason: `面板最多 ${PANEL_MAX_ITEMS} 条，排在后面放不下` })
      continue
    }
    items.push({ name: command, desc: truncateToWeight(description, PANEL_DESC_MAX_WEIGHT), type: PANEL_ITEM_COMMAND })
  }
  return { items, omitted }
}

/** 同步用到的官方接口，由 QqRestClient 实现；失败抛 QqApiError */
export interface PanelEndpoints {
  listC2cPanels(cursor: string): Promise<PanelPage>
  createC2cPanel(panel: PanelContent, openids: string[]): Promise<string>
  updatePanel(panelId: string, panel: PanelContent): Promise<void>
  deletePanel(panelId: string): Promise<void>
  panelOpenids(panelId: string): Promise<string[]>
  changePanelTargets(panelId: string, op: 'add' | 'del', openids: string[]): Promise<void>
}

const sameItems = (a: PanelItem[], b: PanelItem[]): boolean =>
  a.length === b.length && a.every((item, index) => item.name === b[index]!.name && item.desc === b[index]!.desc && item.type === b[index]!.type)

function chunks<T>(list: T[], size: number): T[][] {
  const result: T[][] = []
  for (let start = 0; start < list.length; start += size) result.push(list.slice(start, start + size))
  return result
}

async function listMarkedPanels(endpoints: PanelEndpoints): Promise<PanelPage['records']> {
  const marked: PanelPage['records'] = []
  let cursor = ''
  for (;;) {
    const page = await endpoints.listC2cPanels(cursor)
    marked.push(...page.records.filter((record) => record.remark === PANEL_MARKER))
    if (page.isEnd || page.nextCursor === '') return marked
    cursor = page.nextCursor
  }
}

/**
 * 让 QQ 上带标记的单聊面板变成给定的样子，回做了哪些改动（没改动是空数组）。
 * 按标记找：找不到就新建（白名单为空时不建）；找到多个留第一个、其余删掉；条目没变不调修改；关联用户按差集增删
 */
export async function reconcileCommandPanel(endpoints: PanelEndpoints, items: PanelItem[], openids: string[]): Promise<{ panelId: string | null; actions: string[] }> {
  const actions: string[] = []
  const marked = await listMarkedPanels(endpoints)
  // 关联用户只有 specific 面板才能改，别的形状的带标记面板一并删掉重建
  const kept = marked.find((record) => record.targetType === PANEL_TARGET_SPECIFIC) ?? null
  for (const extra of marked.filter((record) => record !== kept)) {
    await endpoints.deletePanel(extra.panelId)
    actions.push(`删掉多余的面板 ${extra.panelId}`)
  }
  const content: PanelContent = { items, remark: PANEL_MARKER }
  if (kept === null) {
    if (openids.length === 0) return { panelId: null, actions }
    const panelId = await endpoints.createC2cPanel(content, openids)
    actions.push(`新建面板 ${panelId}`)
    return { panelId, actions }
  }
  if (!sameItems(kept.items, items)) {
    await endpoints.updatePanel(kept.panelId, content)
    actions.push('更新条目')
  }
  const current = await endpoints.panelOpenids(kept.panelId)
  const added = openids.filter((openid) => !current.includes(openid))
  const removed = current.filter((openid) => !openids.includes(openid))
  for (const batch of chunks(added, PANEL_MAX_OPENIDS)) await endpoints.changePanelTargets(kept.panelId, 'add', batch)
  for (const batch of chunks(removed, PANEL_MAX_OPENIDS)) await endpoints.changePanelTargets(kept.panelId, 'del', batch)
  if (added.length > 0) actions.push(`加上 ${added.length} 个用户`)
  if (removed.length > 0) actions.push(`去掉 ${removed.length} 个用户`)
  return { panelId: kept.panelId, actions }
}

/** 此刻面板该是什么样；openids 已经截到前 20 个，截掉的在 omittedOpenids */
export interface DesiredPanel {
  items: PanelItem[]
  omitted: OmittedPanelEntry[]
  openids: string[]
  omittedOpenids: string[]
}

export interface CommandPanelSyncDeps {
  endpoints: PanelEndpoints
  /** 现算此刻该有的面板；不该同步（没配机器人、没连上）时回原因 */
  desired(): DesiredPanel | string
  log: QqLog
}

/** qq-bot.status 的 panel 字段 */
export interface CommandPanelStatus {
  /** 此刻不同步的原因，同步着是 null */
  notSyncing: string | null
  /** 有一次同步排着或正在做 */
  pending: boolean
  panelId: string | null
  /** 上次同步成功的时间 */
  syncedAt: string | null
  items: PanelItem[]
  omitted: OmittedPanelEntry[]
  targets: string[]
  omittedTargets: string[]
  /** 最近一次同步失败的原话，成功后清空 */
  error: string | null
  errorAt: string | null
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)
const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

/** 防抖地把面板同步成 desired() 的样子：一次只跑一个，跑着时又有变化就跑完再排一次。qq-bot 卸载、断开都不删面板 */
export class CommandPanelSync {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private watchTimer: ReturnType<typeof setInterval> | null = null
  private running = false
  private rerun = false
  private disposed = false
  /** 上一次开始同步时的期望，白名单比对按它判断有没有变 */
  private lastAttempt: string | null = null
  private synced: Omit<CommandPanelStatus, 'notSyncing' | 'pending' | 'error' | 'errorAt'> = { panelId: null, syncedAt: null, items: [], omitted: [], targets: [], omittedTargets: [] }
  private failure: { error: string; at: string } | null = null

  constructor(private readonly deps: CommandPanelSyncDeps) {}

  /** 排一次同步：变化停下 PANEL_DEBOUNCE_MS 后才做 */
  schedule(): void {
    if (this.disposed) return
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.run()
    }, PANEL_DEBOUNCE_MS)
  }

  /** 定时现算一次期望，和上次同步时不同才排同步；给没有变化通知的设置（白名单）用 */
  startWatching(): void {
    if (this.disposed || this.watchTimer !== null) return
    this.watchTimer = setInterval(() => {
      if (this.debounceTimer === null && !this.running && fingerprint(this.deps.desired()) !== this.lastAttempt) this.schedule()
    }, PANEL_WATCH_INTERVAL_MS)
  }

  status(): CommandPanelStatus {
    const desired = this.deps.desired()
    return {
      notSyncing: typeof desired === 'string' ? desired : null,
      pending: this.debounceTimer !== null || this.running,
      ...structuredClone(this.synced),
      error: this.failure?.error ?? null,
      errorAt: this.failure?.at ?? null,
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer)
    if (this.watchTimer !== null) clearInterval(this.watchTimer)
    this.debounceTimer = null
    this.watchTimer = null
  }

  private async run(): Promise<void> {
    if (this.running) { this.rerun = true; return }
    this.running = true
    try {
      await this.syncOnce()
    } finally {
      this.running = false
      if (this.rerun) { this.rerun = false; this.schedule() }
    }
  }

  private async syncOnce(): Promise<void> {
    const desired = this.deps.desired()
    this.lastAttempt = fingerprint(desired)
    if (typeof desired === 'string') return
    let outcome: { panelId: string | null; actions: string[] }
    try {
      outcome = await this.reconcileRetryingOnceWhenBusy(desired)
    } catch (error) {
      this.failure = { error: errorText(error), at: new Date().toISOString() }
      this.deps.log.warn(`QQ 指令面板同步失败：${this.failure.error}；下次命令变化或重连时再同步`)
      return
    }
    const omittedChanged = JSON.stringify(desired.omitted) !== JSON.stringify(this.synced.omitted) || JSON.stringify(desired.omittedOpenids) !== JSON.stringify(this.synced.omittedTargets)
    this.synced = { panelId: outcome.panelId, syncedAt: new Date().toISOString(), items: desired.items, omitted: desired.omitted, targets: desired.openids, omittedTargets: desired.omittedOpenids }
    this.failure = null
    if (outcome.actions.length > 0 || omittedChanged) this.deps.log.info(syncSummary(outcome, desired))
  }

  private async reconcileRetryingOnceWhenBusy(desired: DesiredPanel): Promise<{ panelId: string | null; actions: string[] }> {
    try {
      return await reconcileCommandPanel(this.deps.endpoints, desired.items, desired.openids)
    } catch (error) {
      if (!(error instanceof QqApiError) || error.code !== PANEL_ERROR_BUSY) throw error
      this.deps.log.info(`QQ 指令面板操作进行中，${PANEL_BUSY_RETRY_MS} 毫秒后重试一次`)
      await sleep(PANEL_BUSY_RETRY_MS)
      if (this.disposed) throw new Error('等重试时 qq-bot 已经卸载，没有重试', { cause: error })
      return await reconcileCommandPanel(this.deps.endpoints, desired.items, desired.openids)
    }
  }
}

function fingerprint(desired: DesiredPanel | string): string {
  return JSON.stringify(typeof desired === 'string' ? desired : [desired.items, desired.openids])
}

function syncSummary(outcome: { panelId: string | null; actions: string[] }, desired: DesiredPanel): string {
  const parts = [`QQ 指令面板已同步：${outcome.actions.join('，') || '没有改动'}；面板里 ${desired.items.length} 条`]
  if (outcome.panelId === null) parts.push('白名单为空，没有建面板')
  if (desired.omitted.length > 0) parts.push(`没放进去 ${desired.omitted.map((entry) => `${entry.command}（${entry.reason}）`).join('、')}`)
  if (desired.omittedOpenids.length > 0) parts.push(`白名单超过 ${PANEL_MAX_OPENIDS} 个，后 ${desired.omittedOpenids.length} 个看不到面板`)
  return parts.join('；')
}
