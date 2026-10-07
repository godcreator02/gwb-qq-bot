import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatTable, loadBook } from '../src/chats.js'
import { ExecutorTable, type Executor } from '../src/executors/executor.js'
import type { IncomingMessage } from '../src/qq-protocol.js'
import { Rounds } from '../src/rounds.js'

const OWNER = 'owner-openid'
const ALICE = 'alice-openid'
const WORKSPACE = process.cwd()

interface FakeExecutor extends Executor {
  starts: { workspace: string; session: string | null; prompt: string }[]
  over: boolean
  reply: string
  failStart: Error | null
}

function fakeExecutor(id: string): FakeExecutor {
  const executor: FakeExecutor = {
    id, title: id === 'zcode' ? 'ZCode' : 'Claude Code', starts: [], over: false, reply: '', failStart: null,
    async start(input) {
      if (executor.failStart !== null) throw executor.failStart
      executor.starts.push(input)
      return input.session ?? `${id}-session-${executor.starts.length}`
    },
    async check() { return { over: executor.over, reply: executor.reply } },
  }
  return executor
}

const roundsCreated: Rounds[] = []
function setup(options: { defaultWorkspace?: string; stored?: unknown } = {}) {
  let doc = options.stored
  const store = { read: async () => structuredClone(doc), write: async (value: unknown) => { doc = structuredClone(value) } }
  const table = new ChatTable(store)
  const executors = new ExecutorTable()
  const zcode = fakeExecutor('zcode'), claudecode = fakeExecutor('claudecode')
  executors.register(zcode); executors.register(claudecode)
  const sent: { target: string; content: string; msgId: string | undefined; msgSeq: number | undefined; quote: string | undefined }[] = []
  const sendOk = { ok: true as const, id: 'sent' }
  const deps = {
    home: 'default', table, executors,
    allowedOpenids: () => [OWNER, ALICE],
    ownerOpenid: () => OWNER,
    defaultWorkspace: () => options.defaultWorkspace ?? WORKSPACE,
    sendC2c: vi.fn(async (target: string, content: string, msgId: string | undefined, msgSeq: number | undefined, quote: string | undefined): Promise<{ ok: true; id: string } | { ok: false; status: number; message: string }> => { sent.push({ target, content, msgId, msgSeq, quote }); return sendOk }),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
  const rounds = new Rounds(deps)
  roundsCreated.push(rounds)
  return { rounds, table, zcode, claudecode, sent, deps, store: () => doc }
}
afterEach(async () => { await Promise.all(roundsCreated.splice(0).map((r) => r.dispose())) })

let msgCounter = 0
function c2c(content: string, sender = OWNER): IncomingMessage {
  return { msgId: `m${++msgCounter}`, senderOpenid: sender, content }
}
const roundIdOf = (prompt: string): string => /本轮编号 (r-[0-9a-f]+)/u.exec(prompt)![1]!
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('一轮：派出、回报、发回', () => {
  it('主人私聊按默认工作区派给 ZCode；提示词带本轮编号与 home 名；回报后结果按被动回复发回，msg_seq 接着「已接收」往下数', async () => {
    const { rounds, zcode, sent, table } = setup()
    const message = c2c('把 README 的错别字改掉')
    await rounds.handleIncoming(message)
    expect(zcode.starts).toHaveLength(1)
    expect(zcode.starts[0]).toMatchObject({ workspace: WORKSPACE, session: null })
    expect(zcode.starts[0]!.prompt).toContain('把 README 的错别字改掉')
    expect(zcode.starts[0]!.prompt).toContain('gwb home「default」')
    expect(zcode.starts[0]!.prompt).toContain('qq-bot.report')
    expect(sent.at(-1)).toMatchObject({ content: expect.stringContaining('已接收') as unknown, msgId: message.msgId, msgSeq: 1, quote: message.msgId })
    const roundId = roundIdOf(zcode.starts[0]!.prompt)
    await expect(rounds.report({ round: roundId, text: '改了 3 处错别字' })).resolves.toEqual({ recorded: true, duplicate: false })
    await flush()
    expect(sent.at(-1)).toMatchObject({ content: '改了 3 处错别字', msgId: message.msgId, msgSeq: 2, quote: message.msgId })
    expect(table.find(`c2c:${OWNER}`)?.round).toBeNull()
  })

  it('同一轮同一段话重交回 duplicate；换了内容、不认识的编号、超长都拒绝', async () => {
    const { rounds, zcode } = setup()
    await rounds.handleIncoming(c2c('任务'))
    const roundId = roundIdOf(zcode.starts[0]!.prompt)
    await rounds.report({ round: roundId, text: '做完了' })
    await expect(rounds.report({ round: roundId, text: '做完了' })).resolves.toEqual({ recorded: true, duplicate: true })
    await expect(rounds.report({ round: roundId, text: '另一个结果' })).rejects.toThrow('已经结束')
    await expect(rounds.report({ round: 'r-000000000000', text: '结果' })).rejects.toThrow('不认识本轮编号')
    await expect(rounds.report({ round: roundId, text: 'x'.repeat(2001) })).rejects.toThrow('最多 2000 字')
    await expect(rounds.report({ round: roundId, text: '结果', state: 'completed' })).rejects.toThrow('不认识参数 state')
  })

  it('同一个聊天一次一轮：第二条排队，回报后自动开下一轮并续用同一个会话', async () => {
    const { rounds, zcode, sent } = setup()
    await rounds.handleIncoming(c2c('第一件'))
    zcode.over = false
    await rounds.handleIncoming(c2c('第二件'))
    expect(zcode.starts).toHaveLength(1)
    expect(sent.at(-1)!.content).toContain('排在第 1 个')
    await rounds.report({ round: roundIdOf(zcode.starts[0]!.prompt), text: '第一件做完' })
    await vi.waitFor(() => expect(zcode.starts).toHaveLength(2))
    expect(zcode.starts[1]).toMatchObject({ session: 'zcode-session-1' })
    expect(zcode.starts[1]!.prompt).toContain('第二件')
  })

  it('懒检查：上一轮没回报，又来新消息时问一次执行端，做完了就收尾发回最后的回答、再开新一轮', async () => {
    const { rounds, zcode, sent } = setup()
    await rounds.handleIncoming(c2c('第一件'))
    zcode.over = true; zcode.reply = 'agent 最后说的话'
    await rounds.handleIncoming(c2c('第二件'))
    expect(sent.some((each) => each.content.includes('没有收到回报') && each.content.includes('agent 最后说的话'))).toBe(true)
    expect(zcode.starts).toHaveLength(2)
    expect(zcode.starts[1]!.prompt).toContain('第二件')
    expect(sent.at(-1)!.content).toContain('已接收')
    expect(sent.some((each) => each.content.includes('排在第'))).toBe(false)
  })

  it('派单失败：原话回给聊天，这一轮作废，下一条照常派', async () => {
    const { rounds, zcode, sent, table } = setup()
    zcode.failStart = new Error('应有一个 ZCode 主进程，实际 0 个')
    await rounds.handleIncoming(c2c('任务'))
    expect(sent.at(-1)!.content).toContain('派单失败：应有一个 ZCode 主进程')
    expect(table.find(`c2c:${OWNER}`)?.round).toBeNull()
    zcode.failStart = null
    await rounds.handleIncoming(c2c('再来'))
    expect(zcode.starts).toHaveLength(1)
  })
})

describe('入站', () => {
  it('白名单外拒绝并记下 openid；重推的同一条消息不处理', async () => {
    const { rounds, zcode, sent } = setup()
    await rounds.handleIncoming(c2c('任务', 'stranger'))
    expect(rounds.recentRejected).toMatchObject([{ openid: 'stranger' }])
    const message = c2c('任务')
    await rounds.handleIncoming(message)
    await rounds.handleIncoming(message)
    expect(zcode.starts).toHaveLength(1)
    expect(sent.filter((each) => each.content.includes('已接收'))).toHaveLength(1)
  })

  it('不是主人、又没绑定的私聊回一句怎么绑，不派单；/帮助 回说明', async () => {
    const { rounds, zcode, sent } = setup()
    await rounds.handleIncoming(c2c('帮我做', ALICE))
    expect(sent.at(-1)!.content).toContain('qq-bot.bind')
    await rounds.handleIncoming(c2c('/帮助', ALICE))
    expect(sent.at(-1)!.content).toContain('/状态')
    expect(zcode.starts).toHaveLength(0)
  })
})

describe('绑定', () => {
  it('私聊绑协作仓并选 Claude Code：提示词写明 collab.submit 与 home 名；有任务时拒绝改绑', async () => {
    const { rounds, claudecode, sent } = setup()
    await rounds.handleIncoming(c2c('/帮助', ALICE))
    const bound = await rounds.bind({ chat: `c2c:${ALICE}`, workspace: WORKSPACE, title: '混合型 MMC 样机', agent: 'claudecode', collab: true })
    expect(bound.binding).toEqual({ workspace: WORKSPACE, agent: 'claudecode', title: '混合型 MMC 样机', collab: true })
    await rounds.handleIncoming(c2c('改一下仿真参数', ALICE))
    expect(claudecode.starts[0]!.prompt).toContain('collab.submit')
    expect(claudecode.starts[0]!.prompt).toContain('这条任务来自 QQ 私聊')
    expect(sent.at(-1)!.content).toContain('交给 Claude Code 在「混合型 MMC 样机」里做')
    await expect(rounds.bind({ chat: `c2c:${ALICE}`, workspace: WORKSPACE, title: '别的' })).rejects.toThrow('还有在做或排队的任务')
  })

  it('参数不对直接报错：相对路径、没装的执行端、不认识的键、没见过的聊天', async () => {
    const { rounds } = setup()
    await rounds.handleIncoming(c2c('/帮助', ALICE))
    await expect(rounds.bind({ chat: `c2c:${ALICE}`, workspace: 'relative', title: 'x' })).rejects.toThrow('绝对路径')
    await expect(rounds.bind({ chat: `c2c:${ALICE}`, workspace: WORKSPACE, title: 'x', agent: 'codex' })).rejects.toThrow('没装')
    await expect(rounds.bind({ chat: `c2c:${ALICE}`, workspace: WORKSPACE, title: 'x', projectRepo: 'x' })).rejects.toThrow('不认识参数 projectRepo')
    await expect(rounds.bind({ chat: 'c2c:nobody', workspace: WORKSPACE, title: 'x' })).rejects.toThrow('没有聊天')
  })

  it('改绑与 /新会话 之后下一轮用新会话', async () => {
    const { rounds, zcode } = setup()
    await rounds.handleIncoming(c2c('第一件'))
    await rounds.report({ round: roundIdOf(zcode.starts[0]!.prompt), text: '好了' })
    await flush()
    await rounds.handleIncoming(c2c('/新会话'))
    await rounds.handleIncoming(c2c('第二件'))
    expect(zcode.starts[1]).toMatchObject({ session: null })
  })
})

describe('/状态 与没送达的结果', () => {
  it('结果被动、主动都发不出去就记进未送达，/状态 时补发：被动回复挂在 /状态 上，引用的仍是派出这一轮的那条', async () => {
    const { rounds, zcode, sent, table, deps } = setup()
    const task = c2c('长任务')
    await rounds.handleIncoming(task)
    const refused = { ok: false as const, status: 400, message: '频控' }
    deps.sendC2c.mockResolvedValueOnce(refused).mockResolvedValueOnce(refused)
    await rounds.report({ round: roundIdOf(zcode.starts[0]!.prompt), text: '长任务结果' })
    await flush()
    expect(table.find(`c2c:${OWNER}`)?.undelivered).toEqual([{ text: '长任务结果', quote: task.msgId }])
    const status = c2c('/状态')
    await rounds.handleIncoming(status)
    expect(sent.at(-1)).toMatchObject({ content: expect.stringContaining('长任务结果') as unknown, msgId: status.msgId, quote: task.msgId })
    expect(table.find(`c2c:${OWNER}`)?.undelivered).toEqual([])
  })

  it('过了 60 分钟的被动窗口，结果改用主动消息发出，仍引用派出这一轮的那条', async () => {
    const { rounds, zcode, sent } = setup()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const task = c2c('长任务')
    await rounds.handleIncoming(task)
    vi.spyOn(Date, 'now').mockReturnValue(now + 61 * 60 * 1000)
    await rounds.report({ round: roundIdOf(zcode.starts[0]!.prompt), text: '长任务结果' })
    await flush()
    expect(sent.at(-1)).toMatchObject({ content: '长任务结果', msgId: undefined, msgSeq: undefined, quote: task.msgId })
    vi.restoreAllMocks()
  })

  it('在做的时候 /状态 回最新回答的末尾', async () => {
    const { rounds, zcode, sent } = setup()
    await rounds.handleIncoming(c2c('任务'))
    zcode.over = false; zcode.reply = '正在读文件'
    await rounds.handleIncoming(c2c('/状态'))
    expect(sent.at(-1)!.content).toContain('还在做')
    expect(sent.at(-1)!.content).toContain('正在读文件')
  })
})

describe('通知与重载', () => {
  it('notify 同一个 id 只发一次，内容不同报错', async () => {
    const { rounds, deps } = setup()
    await expect(rounds.notify('collab-1', '新 MR')).resolves.toEqual({ delivered: true, duplicate: false })
    await expect(rounds.notify('collab-1', '新 MR')).resolves.toEqual({ delivered: true, duplicate: true })
    await expect(rounds.notify('collab-1', '别的')).rejects.toThrow('已经用于另一段内容')
    expect(deps.sendC2c).toHaveBeenCalledTimes(1)
    expect(deps.sendC2c).toHaveBeenCalledWith(OWNER, '新 MR', undefined, undefined, undefined)
  })

  it('聊天表里没送达的结果不是 { text, quote } 就停止处理', async () => {
    const chat = { id: `c2c:${OWNER}`, target: OWNER, queue: [], undelivered: ['旧的纯文本结果'] }
    const { rounds } = setup({ stored: { version: 2, chats: [chat], notices: [], seen: [], replies: {} } })
    await expect(rounds.notify('n-1', '通知')).rejects.toThrow('形状不对')
  })
})

describe('聊天表的版本', () => {
  const binding = { workspace: WORKSPACE, agent: 'zcode', title: '个人空间', collab: false }
  const privateChat = { id: `c2c:${ALICE}`, scene: 'c2c', target: ALICE, lastSeen: '', lastSender: ALICE, binding, session: null, round: null, queue: [], lastClosed: null, undelivered: [] }
  const groupChat = { ...privateChat, id: 'group:g-1', scene: 'group', target: 'g-1' }

  it('第 1 版：去掉群聊、私聊去掉 scene，换成第 2 版，私聊的绑定照留', () => {
    const { book, droppedGroups } = loadBook({ version: 1, chats: [privateChat, groupChat], notices: [], seen: [], replies: {} })
    expect(droppedGroups).toBe(1)
    expect(book.version).toBe(2)
    expect(book.chats).toHaveLength(1)
    expect(book.chats[0]).not.toHaveProperty('scene')
    expect(book.chats[0]).toMatchObject({ id: `c2c:${ALICE}`, binding })
  })

  it('读回第 1 版以后，下次写盘就是第 2 版，私聊照常收任务', async () => {
    const { rounds, table, zcode, store } = setup({ stored: { version: 1, chats: [privateChat, groupChat], notices: [], seen: [], replies: {} } })
    await table.settle()
    expect(table.droppedGroups).toBe(1)
    await rounds.handleIncoming(c2c('任务', ALICE))
    expect(zcode.starts).toHaveLength(1)
    expect(store()).toMatchObject({ version: 2 })
    expect((store() as { chats: unknown[] }).chats).toHaveLength(1)
  })

  it('第 2 版里还带着 scene、第 1 版里 scene 认不出，都停止处理', () => {
    expect(() => loadBook({ version: 2, chats: [privateChat], notices: [], seen: [], replies: {} })).toThrow('还带着 scene')
    expect(() => loadBook({ version: 1, chats: [{ ...privateChat, scene: 'guild' }], notices: [], seen: [], replies: {} })).toThrow('scene 既不是 c2c 也不是 group')
    expect(() => loadBook({ version: 3, chats: [], notices: [], seen: [], replies: {} })).toThrow('格式不对')
  })

  it('重载后聊天表读回，在跑的那一轮照样收回报', async () => {
    const first = setup()
    await first.rounds.handleIncoming(c2c('任务'))
    const roundId = roundIdOf(first.zcode.starts[0]!.prompt)
    await first.rounds.dispose()
    const second = setup({ stored: first.store() })
    await expect(second.rounds.report({ round: roundId, text: '重载后的结果' })).resolves.toEqual({ recorded: true, duplicate: false })
    await flush()
    expect(second.sent.at(-1)!.content).toBe('重载后的结果')
  })
})
