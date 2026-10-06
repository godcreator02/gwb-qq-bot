import { describe, expect, it, vi } from 'vitest'
import { ChatBridge, type BridgeDeps } from '../src/bridge.js'
import type { Book } from '../src/conversations.js'
import { ticketHash } from '../src/direct-report.js'

const ticket = (prompt: unknown) => /"ticket":"([a-f0-9]{64})"/u.exec(String(prompt))![1]!
const message = (id: string) => ({ scene: 'c2c' as const, senderOpenid: 'human', replyTarget: 'human', msgId: id, content: '任务' })
function setup() {
  let doc: unknown
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const deps: BridgeDeps = { home: 'test', appId: () => 'app', defaultWorkspace: () => 'D:/test', ownerOpenid: () => 'human', allowedOpenids: () => ['human'], reportServer: () => 'gwb_botb', journalLibrary: () => 'personal', read: async () => structuredClone(doc), write: async (v) => { doc = structuredClone(v) },
    runCommand: vi.fn(async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { ok: true, data: name.startsWith('claudecode.') ? { sessionId: args.sessionId ?? 'claude-session' } : { taskId: args.task ?? 'zcode-task' } } }),
    sendC2c: vi.fn(async () => ({ ok: true as const, id: 'reply' })), sendGroup: vi.fn(async () => ({ ok: true as const, id: 'reply' })), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }
  const bridge = new ChatBridge(deps)
  return { bridge, deps, calls, book: () => doc as Book, report: (index: number) => ({ ticket: ticket(calls[index]!.args.prompt), state: 'completed', text: `done-${index}` }) }
}
describe('直接回报与原生 agent 接缝', () => {
  it('派发回执丢失但已有结果，人工解除阻塞后同理由重复确认仍幂等', async () => {
    const { bridge, deps, report, book } = setup()
    const run = vi.mocked(deps.runCommand).getMockImplementation()!
    vi.mocked(deps.runCommand).mockImplementation(async (name, args) => { await run(name, args); return { ok: false } })
    await bridge.handleIncoming(message('unknown'))
    await bridge.receiveReport(report(0))
    const request = { jobId: book().jobs[0]!.id, confirmedStopped: true, note: '已核对执行端停止' }
    await expect(bridge.resolve(request)).resolves.toMatchObject({ duplicate: false })
    expect(book().jobs[0]!.text).toBe('done-0')
    await expect(bridge.resolve(request)).resolves.toMatchObject({ duplicate: true })
    await expect(bridge.resolve({ ...request, note: '另一结论' })).rejects.toThrow()
    await bridge.dispose()
  })
  it('切换 agent 保留来源与日志绑定，但新建原生会话；旧票不能回报新轮次', async () => {
    const { bridge, calls, report, book } = setup()
    await bridge.handleIncoming(message('first'))
    const source = (await bridge.sources())[0]!
    await expect(bridge.switchAgent({ sourceId: source.id, agent: 'claudecode' })).rejects.toThrow('还有')
    const proof = report(0)
    expect(JSON.stringify(book())).not.toContain(proof.ticket)
    expect(book().jobs[0]!.ticketHash).toBe(ticketHash(proof.ticket))
    expect(calls[0]!.args).not.toHaveProperty('report')
    await bridge.receiveReport(proof)
    const changed = await bridge.switchAgent({ sourceId: source.id, agent: 'claudecode' })
    expect(changed.binding).toEqual({ ...source.binding, agent: 'claudecode' })
    await bridge.handleIncoming(message('second'))
    expect(calls[1]).toMatchObject({ name: 'claudecode.create', args: { workspace: 'D:/test' } })
    expect(calls[1]!.args).not.toHaveProperty('sessionId')
    expect(report(1).ticket).not.toBe(proof.ticket)
    await expect(bridge.receiveReport({ ...proof, text: 'new result' })).rejects.toThrow('已有不同结果')
    await bridge.receiveReport(report(1))
    await bridge.handleIncoming(message('third'))
    expect(calls[2]).toMatchObject({ name: 'claudecode.send', args: { sessionId: 'claude-session' } })
    expect(calls[2]!.args).not.toHaveProperty('task')
    await bridge.dispose()
  })
  it('QQ 网络阻塞时，回报先持久化返回，后续派发仍可推进', async () => {
    const { bridge, deps, calls, report } = setup()
    await bridge.handleIncoming(message('first'))
    await bridge.handleIncoming(message('second'))
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(deps.sendC2c).mockImplementation(async () => { await blocked; return { ok: true, id: 'reply' } })
    try {
      await expect(bridge.receiveReport(report(0))).resolves.toMatchObject({ recorded: true })
      await vi.waitFor(() => expect(calls).toHaveLength(2))
      await expect(bridge.receiveReport(report(1))).resolves.toMatchObject({ recorded: true })
    } finally { release(); await bridge.dispose() }
  })
  it('回报早于 create 回执时，不在原生会话 ID 未确定前推进下一轮', async () => {
    const { bridge, deps, calls, book } = setup()
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const run = vi.mocked(deps.runCommand).getMockImplementation()!
    vi.mocked(deps.runCommand).mockImplementation(async (name, args) => {
      const result = await run(name, args)
      if (name === 'zcode.create') { await bridge.receiveReport({ ticket: ticket(args.prompt), state: 'completed', text: 'fast' }); await barrier }
      return result
    })
    const first = bridge.handleIncoming(message('first'))
    try {
      await vi.waitFor(() => expect(book().jobs[0]?.text).toBe('fast'))
      await bridge.handleIncoming(message('second'))
      expect(calls).toHaveLength(1)
      release(); await first
      await vi.waitFor(() => expect(calls).toHaveLength(2))
      expect(calls[1]).toMatchObject({ name: 'zcode.send', args: { task: 'zcode-task' } })
    } finally { release(); await first; await bridge.dispose() }
  })
  it('同一票重载后去重，异 home 或异 App 拒绝提交', async () => {
    const { bridge, deps, report } = setup()
    await bridge.handleIncoming(message('first'))
    const proof = report(0)
    await bridge.receiveReport(proof)
    await bridge.dispose()
    const restored = new ChatBridge(deps)
    await expect(restored.receiveReport(proof)).resolves.toMatchObject({ duplicate: true })
    await restored.dispose()
    for (const overrides of [{ home: 'other' }, { appId: () => 'other' }]) {
      const foreign = new ChatBridge({ ...deps, ...overrides })
      await expect(foreign.receiveReport(proof)).rejects.toThrow('不属于')
      await foreign.dispose()
    }
  })
})
