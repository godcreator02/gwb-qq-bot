import { describe, expect, it, vi } from 'vitest'
const ticket = (prompt: unknown) => /"ticket":"([a-f0-9]{64})"/u.exec(String(prompt))![1]!
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
import { ChatBridge, type BridgeDeps } from '../src/bridge.js'

function setup() {
  let doc: unknown
  const sent: { name: string; args: Record<string, unknown> }[] = []
  const deps: BridgeDeps = {
    home: 'test-home', appId: () => 'app-a',
    runCommand: vi.fn(async (name: string, args: Record<string, unknown>) => {
      sent.push({ name, args })
      if (name === 'collab.projects') return { ok: true, data: { projects: ['D:/g1', 'D:/g2', 'D:/test'].map((repo) => ({ repo, summary: { title: repo }, error: null })) } }
      return { ok: true, data: { taskId: args.task ?? `sess_${args.workspace}` } }
    }),
    defaultWorkspace: () => 'D:/test', allowedOpenids: () => ['human', 'peer'], reportServer: () => 'gwb_botb', journalLibrary: () => '', ownerOpenid: () => 'human',
    read: async () => structuredClone(doc), write: async (value) => { doc = structuredClone(value) },
    sendC2c: vi.fn(async () => ({ ok: true as const, id: 'sent' })), sendGroup: vi.fn(async () => ({ ok: true as const, id: 'sent' })),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
  const report = (index: number, text: string) => {
    const call = sent.filter((each) => each.name === 'zcode.create' || each.name === 'zcode.send')[index]!
    return { ticket: ticket(call.args.prompt), state: 'completed', text }
  }
  const bridge = new ChatBridge(deps)
  const bind = async (target: string, workspace: string) => {
    await bridge.handleIncoming({ ...message(`help-${target}`, target), content: '/帮助' })
    const source = (await bridge.sources()).find((each) => each.target === target)!
    await bridge.bind({ sourceId: source.id, projectRepo: workspace })
    vi.mocked(deps.sendGroup).mockClear()
  }
  return { deps, bridge, sent, report, bind }
}
const message = (msgId: string, replyTarget = 'group') => ({ scene: 'group' as const, msgId, senderOpenid: 'human', replyTarget, content: '执行测试' })
describe('每轮回报与持久化', () => {
  it('不同群的乱序结果各回原地址，重复消息和回报不重发', async () => {
    const { bridge, deps, report, sent, bind } = setup()
    await bind('g1', 'D:/g1')
    await bind('g2', 'D:/g2')
    await Promise.all([bridge.handleIncoming(message('m1', 'g1')), bridge.handleIncoming(message('m2', 'g2'))])
    await bridge.receiveReport(report(1, 'second'))
    await flush()
    await bridge.receiveReport(report(0, 'first'))
    await flush()
    await bridge.receiveReport(report(0, 'first'))
    await flush()
    await bridge.handleIncoming(message('m1', 'g1'))
    expect(sent.filter((call) => call.name === 'zcode.create' || call.name === 'zcode.send')).toHaveLength(2)
    expect(deps.sendGroup).toHaveBeenCalledWith('g1', '【机器人回执】\nfirst', 'm1', 2)
    expect(deps.sendGroup).toHaveBeenCalledWith('g2', '【机器人回执】\nsecond', 'm2', 2)
    expect(deps.sendGroup).toHaveBeenCalledTimes(4)
    expect(bridge.report().conversations).toHaveLength(2)
    expect(bridge.report().conversations.every((each) => each.roundIndex === 1 && !each.roundRunning)).toBe(true)
    expect(sent.every((call) => call.name !== 'zcode.status')).toBe(true)
    await bridge.dispose()
  })
  it('重载后接回旧任务；群窗口过期保留结果，/状态 使用新消息取回', async () => {
    const { bridge, deps, report, bind } = setup()
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await bind('group', 'D:/test')
      await bind('other-group', 'D:/g2')
      await bridge.handleIncoming(message('old'))
      await bridge.dispose()
      vi.setSystemTime(Date.now() + 6 * 60_000)
      const restored = new ChatBridge(deps)
      await restored.receiveReport(report(0, '保存的结果'))
    await flush()
      expect(restored.report().pendingResults).toBe(1)
      await restored.handleIncoming({ ...message('other-status', 'other-group'), content: '/状态' })
      expect(vi.mocked(deps.sendGroup).mock.calls.filter(([target]) => target === 'other-group').every((call) => !call[1].includes('保存的结果'))).toBe(true)
      expect(restored.report().pendingResults).toBe(1)
      await restored.handleIncoming({ ...message('fresh'), content: '/状态' })
      expect(deps.sendGroup).toHaveBeenCalledWith('group', expect.stringContaining('保存的结果'), 'fresh', 1)
      expect(restored.report().pendingResults).toBe(0)
      await restored.dispose()
    } finally { vi.useRealTimers() }
  })
  it('通知只发给主人，跨重载按 id 去重；未知回报不干扰正常回报', async () => {
    const { bridge, deps, report, bind } = setup()
    await bind('group', 'D:/test')
    await bridge.handleIncoming(message('m1'))
    await expect(bridge.receiveReport({ ...report(0, '结果'), ticket: '0'.repeat(64) })).rejects.toThrow()
    await expect(bridge.receiveReport({ ...report(0, '结果'), taskId: 'different-task' })).rejects.toThrow()
    await expect(bridge.receiveReport({ ...report(0, '结果'), workspace: 'D:/different' })).rejects.toThrow()
    await bridge.receiveReport(report(0, '结果'))
    await flush()
    await bridge.notify({ id: 'mr-1', text: '新的 MR' })
    await bridge.dispose()
    const restored = new ChatBridge(deps)
    await expect(restored.notify({ id: 'mr-1', text: '新的 MR' })).resolves.toEqual({ delivered: true, duplicate: true })
    expect(deps.sendC2c).toHaveBeenCalledTimes(1)
    expect(deps.sendC2c).toHaveBeenCalledWith('human', '新的 MR', undefined, undefined)
    await restored.dispose()
  })
})
