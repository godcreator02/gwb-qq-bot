import { describe, expect, it, vi } from 'vitest'
import { ChatBridge, type BridgeDeps } from '../src/bridge.js'

function setup() {
  const deps: BridgeDeps = {
    home: 'test-home', appId: () => 'app-a',
    runCommand: vi.fn(async (name: string) => name === 'collab.projects'
      ? { ok: true, data: { projects: [{ repo: 'D:/test', summary: { title: '测试项目' }, error: null }] } }
      : { ok: true, data: { taskId: 'test-task' } }),
    defaultWorkspace: () => 'D:/test', allowedOpenids: () => ['peer'],
    sendC2c: vi.fn(async () => ({ ok: true as const, id: 'sent' })),
    sendGroup: vi.fn(async () => ({ ok: true as const, id: 'sent' })),
    reportServer: () => 'gwb', journalLibrary: () => '', ownerOpenid: () => 'peer',
    read: async () => undefined, write: async () => {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
  const bridge = new ChatBridge(deps)
  const bind = async () => {
    await bridge.handleIncoming({ scene: 'group', msgId: 'help', senderOpenid: 'peer', replyTarget: 'group', content: '/帮助' })
    await bridge.bind({ sourceId: (await bridge.sources())[0]!.id, projectRepo: 'D:/test' })
    vi.mocked(deps.runCommand).mockClear()
    vi.mocked(deps.sendGroup).mockClear()
  }
  return { deps, bridge, bind }
}
describe('群机器人派单边界', () => {
  it('已授权机器人自然语言直接派单，自动回执不循环触发', async () => {
    const { deps, bridge, bind } = setup()
    await bind()
    const base = { scene: 'group' as const, msgId: 'in', senderOpenid: 'peer', replyTarget: 'group', senderIsBot: true }
    for (const content of ['【机器人回执】\n收到，已派给 ZCode', '【机器人回执】\n做完了']) await bridge.handleIncoming({ ...base, content })
    expect(deps.runCommand).not.toHaveBeenCalled()
    expect(deps.sendGroup).not.toHaveBeenCalled()
    await bridge.handleIncoming({ ...base, content: '只回复收到' })
    expect(deps.runCommand).toHaveBeenCalledWith('zcode.create', expect.objectContaining({ workspace: 'D:/test' }))
    expect(vi.mocked(deps.runCommand).mock.calls.find(([name]) => name === 'zcode.create')?.[1].prompt).toContain('只回复收到')
    expect(deps.sendGroup).toHaveBeenCalledTimes(1)
    expect(deps.sendGroup).toHaveBeenCalledWith('group', expect.stringMatching(/^【机器人回执】/u), 'in', 1)
    await bridge.dispose()
  })
  it('机器人显式指令也不能越过白名单，人类旧行为保留', async () => {
    const { deps, bridge, bind } = setup()
    const base = { scene: 'group' as const, msgId: 'in', senderOpenid: 'outsider', replyTarget: 'group', senderIsBot: true, content: '只回复收到' }
    await bridge.handleIncoming(base)
    expect(deps.runCommand).not.toHaveBeenCalled()
    expect(deps.sendGroup).not.toHaveBeenCalled()
    expect(await bridge.sources()).toEqual([])
    await bind()
    await bridge.handleIncoming({ ...base, senderOpenid: 'peer', senderIsBot: false, content: '只回复收到' })
    expect(deps.runCommand).toHaveBeenCalledWith('zcode.create', expect.objectContaining({ workspace: 'D:/test' }))
    expect(vi.mocked(deps.runCommand).mock.calls.find(([name]) => name === 'zcode.create')?.[1].prompt).toContain('只回复收到')
    await bridge.dispose()
  })
})
