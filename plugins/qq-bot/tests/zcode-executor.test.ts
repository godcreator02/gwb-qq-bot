import type { GwbZcodeApi } from '@godcreator/gwb-zcode'
import { describe, expect, it } from 'vitest'
import { zcodeExecutor } from '../src/dispatch/executors/zcode.js'
import { ChatTable } from '../src/storage/chat-table.js'

const PAPER = 'D:\\work\\paper'
const MMC = 'D:\\work\\hybrid-mmc'

function setup() {
  const calls: { method: string; input: unknown }[] = []
  const zcodeState = { failOpen: null as Error | null }
  const api = {
    async open(input: { workspace: string }) {
      calls.push({ method: 'open', input })
      if (zcodeState.failOpen !== null) throw zcodeState.failOpen
      return { workspace: input.workspace, switched: true }
    },
    async create(input: { workspace: string; prompt: string }) {
      calls.push({ method: 'create', input })
      return { taskId: `task-${calls.length}` }
    },
    async send(input: { workspace: string; task: string; prompt: string }) {
      calls.push({ method: 'send', input })
      return { taskId: input.task }
    },
  }
  let doc: unknown
  const table = new ChatTable({ read: async () => structuredClone(doc), write: async (value) => { doc = structuredClone(value) } })
  const executor = zcodeExecutor(api as unknown as GwbZcodeApi, {
    has: (workspace) => table.zcodeWorkspaceOpened(workspace),
    remember: (workspace) => table.rememberZcodeWorkspaceOpened(workspace),
  })
  return { executor, calls, zcodeState, stored: () => doc as { zcodeOpenedWorkspaces: string[] } | undefined }
}

describe('ZCode 执行端：每个工作区只让 ZCode 打开一次', () => {
  it('第一次派到一个工作区：先 open 再建会话，并把工作区记进聊天表', async () => {
    const { executor, calls, stored } = setup()
    await expect(executor.start({ workspace: PAPER, session: null, prompt: '改摘要' })).resolves.toBe('task-2')
    expect(calls).toEqual([
      { method: 'open', input: { workspace: PAPER } },
      { method: 'create', input: { workspace: PAPER, prompt: '改摘要' } },
    ])
    expect(stored()?.zcodeOpenedWorkspaces).toEqual([PAPER])
  })

  it('同一个工作区再派：新会话、接着发都不再 open；换一个没打开过的工作区再 open 一次', async () => {
    const { executor, calls, stored } = setup()
    await executor.start({ workspace: PAPER, session: null, prompt: '第一件' })
    await executor.start({ workspace: PAPER, session: null, prompt: '新会话' })
    await executor.start({ workspace: PAPER, session: 'task-2', prompt: '接着做' })
    await executor.start({ workspace: MMC, session: null, prompt: '样机的事' })
    expect(calls.map((each) => `${each.method} ${(each.input as { workspace: string }).workspace}`)).toEqual([
      `open ${PAPER}`, `create ${PAPER}`, `create ${PAPER}`, `send ${PAPER}`, `open ${MMC}`, `create ${MMC}`,
    ])
    expect(stored()?.zcodeOpenedWorkspaces).toEqual([PAPER, MMC])
  })

  it('open 失败：不建会话、不记下，报错写明这一轮没有发出并带上 ZCode 的原话；下次派到这里再试 open', async () => {
    const { executor, calls, zcodeState, stored } = setup()
    zcodeState.failOpen = new Error('应有一个工作区窗口，实际 2 个')
    await expect(executor.start({ workspace: PAPER, session: null, prompt: '改摘要' }))
      .rejects.toThrow(`让 ZCode 打开工作区 ${PAPER} 失败，这一轮没有发出：应有一个工作区窗口，实际 2 个`)
    expect(calls.map((each) => each.method)).toEqual(['open'])
    expect(stored()).toBeUndefined()
    zcodeState.failOpen = null
    await executor.start({ workspace: PAPER, session: null, prompt: '改摘要' })
    expect(calls.map((each) => each.method)).toEqual(['open', 'open', 'create'])
  })
})
