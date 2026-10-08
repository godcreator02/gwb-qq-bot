import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCommandRegistry } from '../src/dispatch/command-registry.js'
import { commandPanelCandidates } from '../src/dispatch/panel-candidates.js'
import { CommandPanelSync, PANEL_MARKER, planPanelItems, reconcileCommandPanel, truncateToWeight, type DesiredPanel, type PanelEndpoints } from '../src/qq/command-panel.js'
import type { PanelItem, PanelRecord } from '../src/qq/qq-protocol.js'
import { QqApiError, type PanelContent } from '../src/qq/qq-rest.js'

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const command = (name: string, desc = '说明'): PanelItem => ({ name, desc, type: 'command' })
const RESERVED = ['/新会话', '/状态', '/帮助']

/** 内存里的 QQ 面板接口：记下每次调用，按需在某次调用时抛错 */
class FakePanels implements PanelEndpoints {
  readonly calls: string[] = []
  panels: (PanelRecord & { openids: string[] })[] = []
  failures: Error[] = []
  private nextId = 1

  private enter(call: string): void {
    this.calls.push(call)
    const failure = this.failures.shift()
    if (failure !== undefined) throw failure
  }

  async listC2cPanels(cursor: string) {
    this.enter(`list ${cursor}`)
    return { records: this.panels.map(({ openids: _openids, ...record }) => structuredClone(record)), nextCursor: '', isEnd: true }
  }

  async createC2cPanel(panel: PanelContent, openids: string[]) {
    this.enter('create')
    const panelId = `p${this.nextId++}`
    this.panels.push({ panelId, targetType: 'specific', remark: panel.remark, items: structuredClone(panel.items), openids: [...openids] })
    return panelId
  }

  async updatePanel(panelId: string, panel: PanelContent) {
    this.enter(`update ${panelId}`)
    const record = this.require(panelId)
    record.items = structuredClone(panel.items)
    record.remark = panel.remark
  }

  async deletePanel(panelId: string) {
    this.enter(`delete ${panelId}`)
    this.panels = this.panels.filter((panel) => panel.panelId !== panelId)
  }

  async panelOpenids(panelId: string) {
    this.enter(`detail ${panelId}`)
    return [...this.require(panelId).openids]
  }

  async changePanelTargets(panelId: string, op: 'add' | 'del', openids: string[]) {
    this.enter(`target ${op} ${openids.join(',')}`)
    const record = this.require(panelId)
    record.openids = op === 'add' ? [...record.openids, ...openids] : record.openids.filter((openid) => !openids.includes(openid))
  }

  private require(panelId: string) {
    const record = this.panels.find((panel) => panel.panelId === panelId)
    if (record === undefined) throw new Error(`没有面板 ${panelId}`)
    return record
  }
}

const ours = (panelId: string, items: PanelItem[], openids: string[]) => ({ panelId, targetType: 'specific', remark: PANEL_MARKER, items, openids })

describe('面板条目', () => {
  it('任务组（命令登记的在前）→ 直接命令 → 保留命令，任务组用称呼作说明', () => {
    const candidates = commandPanelCandidates(
      [{ command: '/论文', title: '学位论文' }, { command: '/mmc', title: '混合型 MMC 样机' }],
      [{ command: '/血糖', description: '查最近的血糖' }],
    )
    expect(candidates.map((candidate) => candidate.command)).toEqual(['/论文', '/mmc', '/血糖', ...RESERVED])
    expect(planPanelItems(candidates).items.slice(0, 3)).toEqual([command('/论文', '学位论文'), command('/mmc', '混合型 MMC 样机'), command('/血糖', '查最近的血糖')])
  })

  it('名字超过 14（含斜杠、汉字算 2）不进面板并写明原因；说明超过 30 截短；同一个命令只放一次', () => {
    const { items, omitted } = planPanelItems([
      { command: '/一二三四五六七', description: '名字 15' },
      { command: '/一二三四五六', description: '一二三四五六七八九十一二三四五六' },
      { command: '/一二三四五六', description: '重名的第二项' },
      { command: '/abcdefghijklm', description: '名字正好 14' },
    ])
    expect(omitted.map((entry) => entry.command)).toEqual(['/一二三四五六七'])
    expect(omitted[0]?.reason).toContain('这个是 15')
    expect(items).toEqual([command('/一二三四五六', '一二三四五六七八九十一二三四…'), command('/abcdefghijklm', '名字正好 14')])
    expect(truncateToWeight('短', 30)).toBe('短')
  })

  it('最多 20 条，排在后面的不进面板（保留命令排最后，也会被挤掉）', () => {
    const groups = Array.from({ length: 19 }, (_, index) => ({ command: `/g${index}`, title: `组 ${index}` }))
    const { items, omitted } = planPanelItems(commandPanelCandidates(groups, []))
    expect(items).toHaveLength(20)
    expect(items.at(-1)?.name).toBe('/新会话')
    expect(omitted.map((entry) => entry.command)).toEqual(['/状态', '/帮助'])
    expect(omitted[0]?.reason).toContain('最多 20 条')
  })
})

describe('让 QQ 上的面板变成给定的样子', () => {
  const items = [command('/mmc'), command('/帮助')]

  it('找不到带标记的面板就新建，只给白名单里的人看；别人的面板不动', async () => {
    const qq = new FakePanels()
    qq.panels.push({ panelId: 'other', targetType: 'all', remark: '别人建的', items: [], openids: [] })
    expect(await reconcileCommandPanel(qq, items, ['u1'])).toEqual({ panelId: 'p1', actions: ['新建面板 p1'] })
    expect(qq.panels.find((panel) => panel.panelId === 'p1')).toMatchObject({ remark: PANEL_MARKER, items, openids: ['u1'] })
    expect(qq.calls).toEqual(['list ', 'create'])
  })

  it('白名单为空且没有面板时不新建', async () => {
    const qq = new FakePanels()
    expect(await reconcileCommandPanel(qq, items, [])).toEqual({ panelId: null, actions: [] })
    expect(qq.calls).toEqual(['list '])
  })

  it('找到就改那一个；内容没变不调修改', async () => {
    const qq = new FakePanels()
    qq.panels.push(ours('p9', [command('/旧')], ['u1']))
    expect(await reconcileCommandPanel(qq, items, ['u1'])).toEqual({ panelId: 'p9', actions: ['更新条目'] })
    expect(qq.calls).toEqual(['list ', 'update p9', 'detail p9'])
    qq.calls.length = 0
    expect(await reconcileCommandPanel(qq, items, ['u1'])).toEqual({ panelId: 'p9', actions: [] })
    expect(qq.calls).toEqual(['list ', 'detail p9'])
  })

  it('带标记的面板有多个时留第一个、删掉其余；关联用户按差集增删', async () => {
    const qq = new FakePanels()
    qq.panels.push(ours('keep', items, ['u1', 'gone']), ours('extra', items, []), { ...ours('wrong-shape', items, []), targetType: 'all' })
    expect(await reconcileCommandPanel(qq, items, ['u1', 'new'])).toEqual({ panelId: 'keep', actions: ['删掉多余的面板 extra', '删掉多余的面板 wrong-shape', '加上 1 个用户', '去掉 1 个用户'] })
    expect(qq.panels.map((panel) => panel.panelId)).toEqual(['keep'])
    expect(qq.panels[0]?.openids).toEqual(['u1', 'new'])
    expect(qq.calls).toEqual(['list ', 'delete extra', 'delete wrong-shape', 'detail keep', 'target add new', 'target del gone'])
  })
})

describe('防抖同步', () => {
  let qq: FakePanels
  let desired: DesiredPanel | string
  let sync: CommandPanelSync

  beforeEach(() => {
    vi.useFakeTimers()
    qq = new FakePanels()
    desired = { items: [command('/mmc')], omitted: [], openids: ['u1'], omittedOpenids: [] }
    sync = new CommandPanelSync({ endpoints: qq, desired: () => desired, log })
  })
  afterEach(() => {
    sync.dispose()
    vi.useRealTimers()
  })

  it('变化停下 2 秒才同步一次，连着几次变化只同步一次', async () => {
    sync.schedule()
    await vi.advanceTimersByTimeAsync(1500)
    sync.schedule()
    await vi.advanceTimersByTimeAsync(1500)
    expect(qq.calls).toEqual([])
    expect(sync.status().pending).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(qq.calls).toEqual(['list ', 'create'])
    expect(sync.status()).toMatchObject({ notSyncing: null, pending: false, panelId: 'p1', items: [command('/mmc')], targets: ['u1'], error: null })
    expect(sync.status().syncedAt).not.toBeNull()
  })

  it('插件注册、撤掉命令都触发同步，面板跟着变', async () => {
    const registry = new PluginCommandRegistry()
    sync.dispose()
    sync = new CommandPanelSync({
      endpoints: qq,
      desired: () => ({ ...planPanelItems(commandPanelCandidates([], registry.allDirectCommands().map(({ definition }) => definition))), openids: ['u1'], omittedOpenids: [] }),
      log,
    })
    registry.onChange(() => sync.schedule())
    const unregister = registry.registerCommand({ command: '/血糖', description: '查最近的血糖', handle: async () => '5.6' }, { plugin: undefined, storedGroupCommands: [] })
    await vi.advanceTimersByTimeAsync(2000)
    expect(qq.panels[0]?.items.map((item) => item.name)).toEqual(['/血糖', ...RESERVED])
    unregister()
    await vi.advanceTimersByTimeAsync(2000)
    expect(qq.panels[0]?.items.map((item) => item.name)).toEqual(RESERVED)
    expect(qq.calls).toEqual(['list ', 'create', 'list ', 'update p1', 'detail p1'])
  })

  it('白名单变了：定时比对发现后排一次同步；没变不调接口', async () => {
    sync.schedule()
    await vi.advanceTimersByTimeAsync(2000)
    sync.startWatching()
    qq.calls.length = 0
    await vi.advanceTimersByTimeAsync(30_000)
    expect(qq.calls).toEqual([])
    desired = { items: [command('/mmc')], omitted: [], openids: ['u1', 'u2'], omittedOpenids: [] }
    await vi.advanceTimersByTimeAsync(32_000)
    expect(qq.calls).toEqual(['list ', 'detail p1', 'target add u2'])
    expect(sync.status().targets).toEqual(['u1', 'u2'])
  })

  it('撞上 40030009（面板操作进行中）稍后重试一次', async () => {
    qq.failures.push(new QqApiError('POST /v2/panels', 200, 40030009, '指令面板操作进行中'))
    qq.calls.length = 0
    sync.schedule()
    await vi.advanceTimersByTimeAsync(2000)
    expect(qq.calls).toEqual(['list '])
    await vi.advanceTimersByTimeAsync(5000)
    expect(qq.calls).toEqual(['list ', 'list ', 'create'])
    expect(sync.status()).toMatchObject({ panelId: 'p1', error: null })
  })

  it('重试一次还在进行中、或别的错误，都不再重试，原话记进 error，下次变化再同步', async () => {
    qq.failures.push(new QqApiError('GET /v2/panels', 400, 40030013, '超出数量限制'))
    sync.schedule()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(qq.calls).toEqual(['list '])
    expect(sync.status()).toMatchObject({ panelId: null, syncedAt: null, error: 'GET /v2/panels 失败：HTTP 400 40030013 超出数量限制' })
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('40030013'))

    const busy = new QqApiError('GET /v2/panels', 200, 40030009, '指令面板操作进行中')
    qq.failures.push(busy, busy)
    sync.schedule()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(qq.calls).toEqual(['list ', 'list ', 'list '])
    expect(sync.status().error).toContain('40030009')

    sync.schedule()
    await vi.advanceTimersByTimeAsync(2000)
    expect(sync.status()).toMatchObject({ panelId: 'p1', error: null })
  })

  it('没配机器人时不同步，status 写明原因；卸载后排着的同步不再做', async () => {
    desired = '机器人没配好（没有 AppID），不同步'
    sync.schedule()
    await vi.advanceTimersByTimeAsync(2000)
    expect(qq.calls).toEqual([])
    expect(sync.status()).toMatchObject({ notSyncing: '机器人没配好（没有 AppID），不同步', pending: false, panelId: null })

    desired = { items: [command('/mmc')], omitted: [], openids: ['u1'], omittedOpenids: [] }
    sync.schedule()
    sync.dispose()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(qq.calls).toEqual([])
  })
})
