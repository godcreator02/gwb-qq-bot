import { describe, expect, it, vi } from 'vitest'
const ticket = (prompt: unknown) => /"ticket":"([a-f0-9]{64})"/u.exec(String(prompt))![1]!
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
import { ChatBridge, type BridgeDeps } from '../src/bridge.js'
import type { Book } from '../src/conversations.js'
import type { IncomingMessage } from '../src/qq-protocol.js'

type CommandCall = { name: string; args: Record<string, unknown>; taskId: string }
const projects = ['D:/project-a', 'D:/project-b', 'D:/shared', 'D:/SHARED/'].map((repo) => ({ repo, summary: { title: `项目 ${repo}` }, error: null }))

function setup(initial?: unknown) {
  let doc = initial
  let app = 'app-a'
  let dispatchUnknown = false
  let projectResult: unknown = { projects }
  let libResult: unknown = [{ id: 'project-notes', plugins: ['@godcreator/gwb-bn-journal'] }]
  const calls: CommandCall[] = []
  let taskIndex = 0
  const deps: BridgeDeps = {
    home: 'isolated-home', appId: () => app,
    defaultWorkspace: () => 'D:/personal', allowedOpenids: () => ['owner', 'peer', 'other'],
    reportServer: () => 'gwb_botb', journalLibrary: () => 'private-notes', ownerOpenid: () => 'owner',
    read: async () => structuredClone(doc), write: async (value) => { doc = structuredClone(value) },
    runCommand: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'collab.projects') return { ok: true, data: projectResult }
      if (name === 'block-note.lib.list') return libResult === null ? { ok: false, error: 'block-note 未安装' } : { ok: true, data: libResult }
      const taskId = typeof args.task === 'string' ? args.task : `task-${++taskIndex}`
      calls.push({ name, args, taskId })
      if (dispatchUnknown && (name === 'zcode.create' || name === 'zcode.send')) return { ok: false, error: 'Runtime.evaluate 30 秒无响应' }
      return { ok: true, data: { taskId, status: 'running', replies: [] } }
    }),
    sendC2c: vi.fn(async () => ({ ok: true as const, id: 'sent' })),
    sendGroup: vi.fn(async () => ({ ok: true as const, id: 'sent' })),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
  const bridge = new ChatBridge(deps)
  const dispatched = () => calls.filter((call) => call.name === 'zcode.create' || call.name === 'zcode.send')
  const report = (index: number, text = `result-${index}`) => {
    const call = dispatched()[index]!
    return { ticket: ticket(call.args.prompt), state: 'completed', text }
  }
  const bindGroup = async (target: string, repo: string, journalLibrary?: string) => {
    await bridge.handleIncoming(group(`help-${target}`, target, '/帮助'))
    const source = (await bridge.sources()).find((each) => each.scene === 'group' && each.target === target && each.appId === app)!
    await bridge.bind({ sourceId: source.id, projectRepo: repo, ...(journalLibrary === undefined ? {} : { journalLibrary }) })
    vi.mocked(deps.sendGroup).mockClear()
    return source.id
  }
  return { bridge, deps, calls, dispatched, report, jobId: (index: number) => (doc as Book).jobs[index]!.id, bindGroup, setApp: (value: string) => { app = value }, setUnknown: (value = true) => { dispatchUnknown = value }, setProjects: (value: unknown) => { projectResult = value }, setLibs: (value: unknown) => { libResult = value } }
}
function group(msgId: string, target: string, content = '处理项目任务', senderOpenid = 'owner'): IncomingMessage {
  return { scene: 'group', msgId, replyTarget: target, senderOpenid, content }
}
function privateMessage(msgId: string, senderOpenid = 'owner', content = '处理个人任务'): IncomingMessage {
  return { scene: 'c2c', msgId, replyTarget: senderOpenid, senderOpenid, content }
}
function expectSource(prompt: unknown, values: Record<string, string>) {
  expect(typeof prompt).toBe('string')
  for (const [key, value] of Object.entries(values)) {
    const property = `${JSON.stringify(key)}\\s*:\\s*${JSON.stringify(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`
    expect(prompt).toMatch(new RegExp(property, 'u'))
  }
}

describe('聊天来源与绑定', () => {
  it('同一人跨两个群和私聊建立三份上下文，来源来自网关，个人笔记库只进入私聊', async () => {
    const { bridge, bindGroup, dispatched } = setup()
    await bindGroup('group-a', 'D:/project-a')
    await bindGroup('group-b', 'D:/project-b')
    await bridge.handleIncoming(group('ga', 'group-a'))
    await bridge.handleIncoming(group('gb', 'group-b'))
    await bridge.handleIncoming(privateMessage('dm'))
    expect(dispatched().map((call) => [call.name, call.args.workspace])).toEqual([
      ['zcode.create', 'D:/project-a'], ['zcode.create', 'D:/project-b'], ['zcode.create', 'D:/personal'],
    ])
    expectSource(dispatched()[0]!.args.prompt, { home: 'isolated-home', appId: 'app-a', scene: 'group', target: 'group-a', senderOpenid: 'owner', projectRepo: 'D:/project-a', title: '项目 D:/project-a' })
    expectSource(dispatched()[1]!.args.prompt, { scene: 'group', target: 'group-b', projectRepo: 'D:/project-b' })
    expectSource(dispatched()[2]!.args.prompt, { scene: 'c2c', target: 'owner', senderOpenid: 'owner' })
    expect(dispatched()[0]!.args.prompt).not.toContain('private-notes')
    expect(dispatched()[1]!.args.prompt).not.toContain('private-notes')
    expect(dispatched()[2]!.args.prompt).toContain('private-notes')
    expect(bridge.report().conversations).toHaveLength(3)
    await bridge.dispose()
  })

  it('群内多人接续同一会话，每轮保留实际发言者及原触发地址', async () => {
    const { bridge, bindGroup, dispatched, report, deps } = setup()
    await bindGroup('group-a', 'D:/project-a', 'project-notes')
    await bridge.handleIncoming(group('first', 'group-a', '第一人任务', 'owner'))
    await bridge.receiveReport(report(0))
    await flush()
    await bridge.handleIncoming(group('second', 'group-a', '第二人继续', 'peer'))
    expect(dispatched()).toHaveLength(2)
    expect(dispatched()[1]).toMatchObject({ name: 'zcode.send', args: { task: dispatched()[0]!.taskId, workspace: 'D:/project-a' } })
    expectSource(dispatched()[1]!.args.prompt, { senderOpenid: 'peer', target: 'group-a' })
    expect(dispatched()[1]!.args.prompt).toContain('project-notes')
    await bridge.receiveReport(report(1, '第二人的结果'))
    await flush()
    expect(deps.sendGroup).toHaveBeenCalledWith('group-a', expect.stringContaining('第二人的结果'), 'second', 2)
    expect(bridge.report().conversations).toHaveLength(1)
    await bridge.dispose()
  })

  it('未绑定群只登记来源；其他白名单用户私聊不借用主人工作区或笔记库', async () => {
    const { bridge, deps, dispatched } = setup()
    await bridge.handleIncoming(group('unbound', 'unknown-group'))
    await bridge.handleIncoming(privateMessage('other', 'other'))
    expect(dispatched()).toEqual([])
    expect(deps.sendGroup).toHaveBeenCalledWith('unknown-group', expect.stringContaining('绑定'), 'unbound', 1)
    const sources = await bridge.sources()
    expect(sources).toHaveLength(2)
    expect(sources.every((source) => source.binding === null)).toBe(true)
    const other = sources.find((source) => source.scene === 'c2c')!
    await bridge.bind({ sourceId: other.id, workspace: 'D:/other' })
    await bridge.handleIncoming(privateMessage('other-bound', 'other'))
    expect(dispatched()[0]!.args.workspace).toBe('D:/other')
    expect(dispatched()[0]!.args.prompt).not.toContain('private-notes')
    await bridge.dispose()
  })

  it('来源与项目绑定严格校验，失败不会改变绑定或派任务', async () => {
    const { bridge, setProjects, dispatched } = setup()
    await expect(bridge.bind({ sourceId: 'not-observed', projectRepo: 'D:/project-a' })).rejects.toThrow()
    await bridge.handleIncoming(group('help', 'group-a', '/帮助'))
    const sourceId = (await bridge.sources())[0]!.id
    await expect(bridge.bind({ sourceId, workspace: 'D:/project-a' })).rejects.toThrow()
    await expect(bridge.bind({ sourceId, projectRepo: 'D:/not-registered' })).rejects.toThrow()
    await expect(bridge.bind({ sourceId, projectRepo: 'relative/path' })).rejects.toThrow()
    await expect(bridge.bind({ sourceId, projectRepo: 'D:/project-a', surprise: true })).rejects.toThrow()
    setProjects({ projects: [{ repo: 'D:/project-a', error: 'unavailable', summary: null }] })
    await expect(bridge.bind({ sourceId, projectRepo: 'D:/project-a' })).rejects.toThrow()
    setProjects({ projects: 'bad shape' })
    await expect(bridge.bind({ sourceId, projectRepo: 'D:/project-a' })).rejects.toThrow()
    expect((await bridge.sources())[0]!.binding).toBeNull()
    expect(dispatched()).toEqual([])
    await bridge.dispose()
  })

  it('白名单外消息既不回复，也不登记可绑定来源', async () => {
    const { bridge, deps, dispatched } = setup()
    await bridge.handleIncoming(group('outsider', 'group-x', '/帮助', 'outsider'))
    expect(await bridge.sources()).toEqual([])
    expect(deps.sendGroup).not.toHaveBeenCalled()
    expect(dispatched()).toEqual([])
    await bridge.dispose()
  })

  it('绑定时校验随手记库：库不存在、未开放日志插件、读不到列表都拒绝并说明缺哪项；留空不查', async () => {
    const { bridge, deps, setLibs, dispatched } = setup()
    await bridge.handleIncoming(group('help', 'group-a', '/帮助'))
    const sourceId = (await bridge.sources())[0]!.id
    setLibs([{ id: 'other-lib', plugins: ['@godcreator/gwb-bn-journal'] }])
    await expect(bridge.bind({ sourceId, projectRepo: 'D:/project-a', journalLibrary: 'project-notes' })).rejects.toThrow('库不存在：project-notes')
    setLibs([{ id: 'project-notes', plugins: [] }])
    await expect(bridge.bind({ sourceId, projectRepo: 'D:/project-a', journalLibrary: 'project-notes' })).rejects.toThrow('库 project-notes 未开放日志插件')
    setLibs(null)
    await expect(bridge.bind({ sourceId, projectRepo: 'D:/project-a', journalLibrary: 'project-notes' })).rejects.toThrow('读不到笔记库列表（block-note.lib.list 失败）')
    await bridge.bind({ sourceId, projectRepo: 'D:/project-a' })
    expect(vi.mocked(deps.runCommand).mock.calls.filter(([name]) => name === 'block-note.lib.list')).toHaveLength(3)
    expect((await bridge.sources())[0]!.binding).toMatchObject({ journalLibrary: '' })
    expect(dispatched()).toEqual([])
    await bridge.dispose()
  })
})

describe('任务队列与来源隔离', () => {
  it('QQ 接单确认发送抛错不阻止已持久化的任务派发', async () => {
    const { bridge, deps, bindGroup, dispatched, report } = setup()
    await bindGroup('group-a', 'D:/project-a')
    vi.mocked(deps.sendGroup).mockRejectedValueOnce(new Error('QQ send timeout'))
    await expect(bridge.handleIncoming(group('ack-failed', 'group-a'))).resolves.toBeUndefined()
    expect(dispatched()).toHaveLength(1)
    expect(dispatched()[0]!.name).toBe('zcode.create')
    await bridge.receiveReport(report(0, '确认消息失败但任务完成'))
    await flush()
    expect(deps.sendGroup).toHaveBeenCalledWith('group-a', expect.stringContaining('确认消息失败但任务完成'), 'ack-failed', 2)
    await bridge.dispose()
  })

  it.each(['', '   '])('派单返回空白 taskId %j 时保留未确认任务，不污染账本', async (taskId) => {
    const { bridge, deps, bindGroup, dispatched } = setup()
    await bindGroup('group-a', 'D:/project-a')
    const run = vi.mocked(deps.runCommand).getMockImplementation()!
    vi.mocked(deps.runCommand).mockImplementation(async (name, args) => {
      const outcome = await run(name, args)
      return name === 'zcode.create' || name === 'zcode.send' ? { ok: true, data: { taskId } } : outcome
    })
    await bridge.handleIncoming(group('blank-id', 'group-a'))
    expect(dispatched()).toHaveLength(1)
    expect(await deps.read()).toMatchObject({ jobs: [{ state: 'dispatch_unknown', taskId: null, text: null }] })
    await bridge.handleIncoming(group('must-queue', 'group-a'))
    expect(dispatched()).toHaveLength(1)
    await bridge.dispose()
    const restored = new ChatBridge(deps)
    await expect(restored.restore()).resolves.toBeUndefined()
    expect(dispatched()).toHaveLength(1)
    await restored.dispose()
  })

  it.each(['', '   '])('回报含空白 taskId %j 时拒绝，正常回报与重载仍可完成', async (taskId) => {
    const { bridge, deps, bindGroup, report, setUnknown } = setup()
    await bindGroup('group-a', 'D:/project-a')
    setUnknown()
    await bridge.handleIncoming(group('first', 'group-a'))
    await expect(bridge.receiveReport({ ...report(0), taskId })).rejects.toThrow()
    expect(await deps.read()).toMatchObject({ jobs: [{ state: 'dispatch_unknown', taskId: null, text: null }] })
    await bridge.receiveReport(report(0))
    await flush()
    await bridge.dispose()
    const restored = new ChatBridge(deps)
    await expect(restored.restore()).resolves.toBeUndefined()
    expect(restored.report().conversations[0]).toMatchObject({ roundRunning: true, resultDelivered: true })
    await restored.dispose()
  })

  it('人工确认未执行后关闭未确认任务，队列只推进下一项，重复同说明安全', async () => {
    const { bridge, deps, bindGroup, dispatched, report, jobId, setUnknown } = setup()
    await bindGroup('group-a', 'D:/project-a')
    setUnknown()
    await bridge.handleIncoming(group('uncertain', 'group-a'))
    await bridge.handleIncoming(group('queued', 'group-a'))
    const resolvedId = jobId(0)
    const request = { jobId: resolvedId, confirmedStopped: true, note: '已在 ZCode 侧栏确认未启动，允许后续任务继续' }
    setUnknown(false)
    await bridge.resolve(request)
    await vi.waitFor(() => expect(dispatched()).toHaveLength(2))
    expect(await deps.read()).toMatchObject({ jobs: [{ id: resolvedId, state: 'failed' }, { state: 'pending' }] })
    expect(report(1).ticket).not.toBe(report(0).ticket)
    expect(dispatched().every((call) => call.args.report === undefined)).toBe(true)
    await expect(bridge.resolve(request)).resolves.toBeDefined()
    expect(dispatched()).toHaveLength(2)
    await expect(bridge.resolve({ ...request, note: '不同的人工结论' })).rejects.toThrow()
    await expect(bridge.receiveReport(report(0, '迟到的原任务结果'))).rejects.toThrow()
    await bridge.dispose()
    const restored = new ChatBridge(deps)
    await restored.restore()
    await expect(restored.resolve(request)).resolves.toBeDefined()
    expect(dispatched()).toHaveLength(2)
    await restored.dispose()
  })

  it('人工关闭必须明确确认停止并给出说明，不接受其他状态或其他 App 的任务', async () => {
    const { bridge, deps, bindGroup, report, jobId, setUnknown, setApp } = setup()
    await bindGroup('group-a', 'D:/project-a')
    await bridge.handleIncoming(group('pending', 'group-a'))
    await expect(bridge.resolve({ jobId: jobId(0), confirmedStopped: true, note: '尚在运行' })).rejects.toThrow()
    await bridge.receiveReport(report(0))
    await flush()
    await expect(bridge.resolve({ jobId: jobId(0), confirmedStopped: true, note: '已经完成' })).rejects.toThrow()
    setUnknown()
    await bridge.handleIncoming(group('unknown', 'group-a'))
    const request = { jobId: jobId(1), confirmedStopped: true, note: '已确认停止' }
    await expect(bridge.resolve({ ...request, confirmedStopped: false })).rejects.toThrow()
    await expect(bridge.resolve({ ...request, note: '' })).rejects.toThrow()
    await expect(bridge.resolve({ ...request, note: '   ' })).rejects.toThrow()
    await expect(bridge.resolve({ jobId: request.jobId, note: request.note })).rejects.toThrow()
    await expect(bridge.resolve({ ...request, jobId: 'not-known' })).rejects.toThrow()
    await expect(bridge.resolve({ ...request, surprise: true })).rejects.toThrow()
    await bridge.handleIncoming(group('queued-after-unknown', 'group-a'))
    const queuedId = bridge.report().conversations[0]!.latest!
    await expect(bridge.resolve({ ...request, jobId: queuedId })).rejects.toThrow()
    const foreignHome = new ChatBridge({ ...deps, home: 'another-home' })
    await expect(foreignHome.resolve(request)).rejects.toThrow()
    await foreignHome.dispose()
    setApp('another-app')
    await expect(bridge.resolve(request)).rejects.toThrow()
    expect(await deps.read()).toMatchObject({ jobs: [{ state: 'completed' }, { state: 'dispatch_unknown', text: null }, { state: 'queued', text: null }] })
    await bridge.dispose()
  })

  it('规范化后相同工作区排队，其他工作区立即派发；回报后才推进队首', async () => {
    const { bridge, bindGroup, dispatched, report } = setup()
    await bindGroup('shared-a', 'D:/shared')
    await bindGroup('shared-b', 'D:/SHARED/')
    await bindGroup('independent', 'D:/project-b')
    await bridge.handleIncoming(group('first', 'shared-a'))
    await bridge.handleIncoming(group('queued', 'shared-b'))
    await bridge.handleIncoming(group('other-workspace', 'independent'))
    expect(dispatched()).toHaveLength(2)
    expect(dispatched().map((call) => call.args.workspace)).toEqual(['D:/shared', 'D:/project-b'])
    await bridge.receiveReport(report(0))
    await flush()
    await vi.waitFor(() => expect(dispatched()).toHaveLength(3))
    expect(dispatched()[2]!.name).toBe('zcode.create')
    expectSource(dispatched()[2]!.args.prompt, { target: 'shared-b' })
    expect(dispatched()[2]!.taskId).not.toBe(dispatched()[0]!.taskId)
    await bridge.dispose()
  })

  it('同一群连续任务不会在上一轮未回报时调用 send，回报后接续原会话', async () => {
    const { bridge, bindGroup, dispatched, report } = setup()
    await bindGroup('group-a', 'D:/project-a')
    await bridge.handleIncoming(group('first', 'group-a'))
    await bridge.handleIncoming(group('second', 'group-a'))
    expect(dispatched()).toHaveLength(1)
    await bridge.receiveReport(report(0))
    await flush()
    await vi.waitFor(() => expect(dispatched()).toHaveLength(2))
    expect(dispatched()[1]).toMatchObject({ name: 'zcode.send', args: { task: dispatched()[0]!.taskId } })
    await bridge.dispose()
  })

  it('回报确认不等待下一轮 ZCode 启动，避免 agent 工具回调死锁', async () => {
    const { bridge, deps, bindGroup, report } = setup()
    await bindGroup('group-a', 'D:/project-a')
    await bridge.handleIncoming(group('first', 'group-a'))
    await bridge.handleIncoming(group('second', 'group-a'))
    let release!: () => void
    const waitForStart = new Promise<void>((resolve) => { release = resolve })
    const run = vi.mocked(deps.runCommand).getMockImplementation()!
    let nextStarting = false
    vi.mocked(deps.runCommand).mockImplementation(async (name, args) => {
      if (name === 'zcode.send') { nextStarting = true; await waitForStart }
      return run(name, args)
    })
    let accepted = false
    const receiving = bridge.receiveReport(report(0)).then(() => { accepted = true })
    try {
      await vi.waitFor(() => expect(accepted).toBe(true))
      await vi.waitFor(() => expect(nextStarting).toBe(true))
    } finally {
      release()
      await receiving
      await bridge.dispose()
    }
  })

  it('ZCode 尚未返回派单回执时可以主动回报，避免快任务卡在派单锁上', async () => {
    const { bridge, deps, bindGroup } = setup()
    await bindGroup('group-a', 'D:/project-a')
    vi.mocked(deps.runCommand).mockImplementation(async (name, args) => {
      if (name !== 'zcode.create') return { ok: true, data: {} }
      await bridge.receiveReport({ ticket: ticket(args.prompt), state: 'completed', text: '快任务完成' })
    await flush()
      return { ok: true, data: { taskId: 'fast-task' } }
    })
    await bridge.handleIncoming(group('fast', 'group-a'))
    await flush()
    expect(deps.sendGroup).toHaveBeenCalledWith('group-a', expect.stringContaining('快任务完成'), 'fast', expect.any(Number))
    await bridge.dispose()
  })

  it('派单结果不明时，同工作区队列在重载后仍不自动放行', async () => {
    const { bridge, deps, bindGroup, dispatched, setUnknown } = setup()
    await bindGroup('group-a', 'D:/shared')
    await bindGroup('group-b', 'D:/shared')
    setUnknown()
    await bridge.handleIncoming(group('uncertain', 'group-a'))
    await bridge.handleIncoming(group('queued', 'group-b'))
    expect(dispatched()).toHaveLength(1)
    await bridge.dispose()
    const restored = new ChatBridge(deps)
    await restored.restore()
    await restored.handleIncoming(group('queued-again', 'group-b'))
    expect(dispatched()).toHaveLength(1)
    await restored.dispose()
  })

  it('排队任务跨重载保留原来源，补交前一轮回报后接续一次', async () => {
    const { bridge, deps, bindGroup, dispatched, report } = setup()
    await bindGroup('group-a', 'D:/project-a')
    await bridge.handleIncoming(group('first', 'group-a', '先执行', 'owner'))
    await bridge.handleIncoming(group('second', 'group-a', '随后执行', 'peer'))
    await bridge.dispose()
    const restored = new ChatBridge(deps)
    await restored.restore()
    expect(dispatched()).toHaveLength(1)
    await restored.receiveReport(report(0))
    await flush()
    await vi.waitFor(() => expect(dispatched()).toHaveLength(2))
    expect(dispatched()[1]).toMatchObject({ name: 'zcode.send', args: { task: dispatched()[0]!.taskId } })
    expectSource(dispatched()[1]!.args.prompt, { target: 'group-a', senderOpenid: 'peer' })
    expect(dispatched()[1]!.args.prompt).toContain('随后执行')
    await restored.receiveReport(report(0))
    await flush()
    expect(dispatched()).toHaveLength(2)
    await restored.dispose()
  })

  it('/状态 与 /新会话 只操作当前群，不能查询或归档另一群', async () => {
    const { bridge, deps, bindGroup, dispatched, report, calls } = setup()
    await bindGroup('group-a', 'D:/project-a')
    await bindGroup('group-b', 'D:/project-b')
    await bridge.handleIncoming(group('a', 'group-a'))
    await bridge.receiveReport(report(0, 'A 群独有结果'))
    await flush()
    vi.mocked(deps.sendGroup).mockClear()
    await bridge.handleIncoming(group('b-status', 'group-b', '/状态'))
    expect(vi.mocked(deps.sendGroup).mock.calls.every((call) => !call[1].includes('A 群独有结果'))).toBe(true)
    expect(calls.filter((call) => call.name === 'zcode.status')).toEqual([])
    await bridge.handleIncoming(group('b', 'group-b'))
    await bridge.receiveReport(report(1))
    await flush()
    await bridge.handleIncoming(group('b-new', 'group-b', '/新会话'))
    expect(calls.filter((call) => call.name === 'zcode.archive')).toEqual([])
    await bridge.handleIncoming(group('a-next', 'group-a'))
    await bridge.handleIncoming(group('b-next', 'group-b'))
    expect(dispatched()[2]).toMatchObject({ name: 'zcode.send', args: { task: dispatched()[0]!.taskId } })
    expect(dispatched()[3]!.name).toBe('zcode.create')
    await bridge.dispose()
  })

  it('未完成或排队时拒绝改绑/解绑；改绑后不复用旧会话与旧结果', async () => {
    const { bridge, deps, bindGroup, dispatched, report } = setup()
    const sourceId = await bindGroup('group-a', 'D:/project-a')
    await bridge.handleIncoming(group('first', 'group-a'))
    await bridge.handleIncoming(group('queued', 'group-a'))
    await expect(bridge.bind({ sourceId, projectRepo: 'D:/project-b' })).rejects.toThrow()
    await expect(bridge.unbind({ sourceId })).rejects.toThrow()
    await bridge.receiveReport(report(0))
    await flush()
    await vi.waitFor(() => expect(dispatched()).toHaveLength(2))
    await expect(bridge.bind({ sourceId, projectRepo: 'D:/project-b' })).rejects.toThrow()
    await bridge.receiveReport(report(1, '旧项目结果'))
    await flush()
    await bridge.bind({ sourceId, projectRepo: 'D:/project-b' })
    vi.mocked(deps.sendGroup).mockClear()
    await bridge.handleIncoming(group('status-after-bind', 'group-a', '/状态'))
    expect(vi.mocked(deps.sendGroup).mock.calls.every((call) => !call[1].includes('旧项目结果'))).toBe(true)
    await bridge.receiveReport(report(1, '旧项目结果'))
    await flush()
    await bridge.handleIncoming(group('new-project', 'group-a'))
    expect(dispatched()[2]).toMatchObject({ name: 'zcode.create', args: { workspace: 'D:/project-b' } })
    await bridge.dispose()
  })

  it('换 App 后来源重新建立，旧 App 结果不借新机器人发送', async () => {
    const { bridge, deps, bindGroup, report, setApp, dispatched } = setup()
    await bindGroup('group-a', 'D:/project-a')
    await bridge.handleIncoming(group('same-id', 'group-a'))
    setApp('app-b')
    vi.mocked(deps.sendGroup).mockClear()
    await expect(bridge.receiveReport(report(0, '旧 App 结果'))).rejects.toThrow()
    await flush()
    expect(deps.sendGroup).not.toHaveBeenCalled()
    await bridge.handleIncoming(group('same-id', 'group-a'))
    expect(dispatched()).toHaveLength(1)
    const current = (await bridge.sources()).find((source) => source.appId === 'app-b')!
    expect(current.binding).toBeNull()
    expect(deps.sendGroup).toHaveBeenCalledWith('group-a', expect.stringContaining('绑定'), 'same-id', 1)
    await bridge.dispose()
  })

  it('派单收到 workspace 占用时任务留队列并告知用户，不进派单未确认；下次推进自动重派', async () => {
    const { bridge, deps, bindGroup, dispatched, report } = setup()
    await bindGroup('group-a', 'D:/project-a')
    await bridge.handleIncoming(group('first', 'group-a'))
    await bridge.receiveReport(report(0))
    await flush()
    let occupied = true
    const run = vi.mocked(deps.runCommand).getMockImplementation()!
    vi.mocked(deps.runCommand).mockImplementation(async (name, args) => {
      if (occupied && (name === 'zcode.create' || name === 'zcode.send')) return { ok: false, error: 'workspace 已被会话 lingering-session 占用：同工作区同一时间只跑一轮；先查那一轮做完没有，做完（或人工核对已停止）后再派' }
      return run(name, args)
    })
    await bridge.handleIncoming(group('second', 'group-a'))
    await flush()
    expect(await deps.read()).toMatchObject({ jobs: [{ state: 'completed' }, { state: 'queued', dispatch: 'queued', ticketHash: null }] })
    expect(deps.sendGroup).toHaveBeenCalledWith('group-a', expect.stringContaining('上一轮还在执行，这单已排队'), 'second', 2)
    expect(bridge.report().unresolvedTasks).toHaveLength(0)
    occupied = false
    await bridge.dispose()
    const restored = new ChatBridge(deps)
    await restored.restore()
    await vi.waitFor(() => expect(dispatched()).toHaveLength(2))
    expect(dispatched()[1]).toMatchObject({ name: 'zcode.send', args: { workspace: 'D:/project-a' } })
    await restored.receiveReport(report(1))
    await flush()
    await restored.dispose()
  })

  it('旧账本不迁移到直接回报链路', async () => {
    const { bridge } = setup({ version: 1 })
    await expect(bridge.restore()).rejects.toThrow('version')
    await bridge.dispose()
  })
})
