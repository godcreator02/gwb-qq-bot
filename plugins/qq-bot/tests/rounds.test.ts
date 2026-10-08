import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { GwbZcodeApi } from '@godcreator/gwb-zcode'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginCommandRegistry } from '../src/dispatch/command-registry.js'
import { ExecutorTable, type Executor } from '../src/dispatch/executors/executor.js'
import { zcodeExecutor } from '../src/dispatch/executors/zcode.js'
import { MessageLog, queryMessages } from '../src/qq/message-log.js'
import type { IncomingMessage } from '../src/qq/qq-protocol.js'
import { Rounds } from '../src/rounds.js'
import { COLLAB_INSTRUCTIONS, ChatTable, loadBook } from '../src/storage/chat-table.js'

const OWNER = 'owner-openid'
const ALICE = 'alice-openid'
const WORKSPACE = process.cwd()
const MMC_WORKSPACE = path.join(process.cwd(), 'tests')
const HOUR = 60 * 60 * 1000

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
const messageDirs: string[] = []
function setup(options: { defaultWorkspace?: string; stored?: unknown; registry?: PluginCommandRegistry } = {}) {
  let doc = options.stored
  const store = { read: async () => structuredClone(doc), write: async (value: unknown) => { doc = structuredClone(value) } }
  const table = new ChatTable(store)
  const executors = new ExecutorTable()
  const zcode = fakeExecutor('zcode'), claudecode = fakeExecutor('claudecode')
  executors.register(zcode); executors.register(claudecode)
  const registry = options.registry ?? new PluginCommandRegistry()
  const settings = { idleHours: 6 as unknown }
  const sent: { target: string; content: string; msgId: string | undefined; msgSeq: number | undefined; quote: string | undefined }[] = []
  const sendOk = { ok: true as const, id: 'sent' }
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const messageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bot-messages-'))
  messageDirs.push(messageDir)
  const messages = new MessageLog({ dir: messageDir, appId: 'app-1', log })
  const records = async () => { await messages.settle(); return [...(await queryMessages(messageDir, 'app-1', { limit: 500 })).records].reverse() }
  const deps = {
    home: 'default', table, executors, registry, messages,
    allowedOpenids: () => [OWNER, ALICE],
    ownerOpenid: () => OWNER,
    defaultWorkspace: () => options.defaultWorkspace ?? WORKSPACE,
    idleHours: () => settings.idleHours,
    sendC2c: vi.fn(async (target: string, content: string, msgId: string | undefined, msgSeq: number | undefined, quote: string | undefined): Promise<{ ok: true; id: string } | { ok: false; status: number; message: string }> => { sent.push({ target, content, msgId, msgSeq, quote }); return sendOk }),
    log,
  }
  const rounds = new Rounds(deps)
  roundsCreated.push(rounds)
  return { rounds, table, zcode, claudecode, sent, deps, registry, settings, store: () => doc, records, messageDir }
}
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(roundsCreated.splice(0).map((r) => r.dispose()))
  for (const dir of messageDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

let msgCounter = 0
function c2c(content: string, sender = OWNER): IncomingMessage {
  return { msgId: `m${++msgCounter}`, senderOpenid: sender, content }
}
const roundIdOf = (prompt: string): string => /本轮编号 (r-[0-9a-f]+)/u.exec(prompt)![1]!
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const MMC = { command: '/mmc', title: '混合型 MMC 样机', workspace: MMC_WORKSPACE, agent: 'claudecode' as const }
const lastContent = (sent: { content: string }[]): string => sent.at(-1)!.content

describe('一轮：派出、回报、发回', () => {
  it('主人私聊直接发的文字进默认组：提示词带本轮编号与 home 名；回执带组名与会话行；结果开头写组名与轮数，msg_seq 接着「已接收」往下数', async () => {
    const { rounds, zcode, sent, table } = setup()
    const message = c2c('把 README 的错别字改掉')
    await rounds.handleIncoming(message)
    expect(zcode.starts).toHaveLength(1)
    expect(zcode.starts[0]).toMatchObject({ workspace: WORKSPACE, session: null })
    expect(zcode.starts[0]!.prompt).toContain('把 README 的错别字改掉')
    expect(zcode.starts[0]!.prompt).toContain('任务组「个人空间」')
    expect(zcode.starts[0]!.prompt).toContain('gwb home「default」')
    expect(zcode.starts[0]!.prompt).toContain('qq-bot.report')
    expect(zcode.starts[0]!.prompt).not.toContain('[任务组要求]')
    expect(sent.at(-1)).toMatchObject({ content: '【默认】已接收，交给 ZCode 在「个人空间」里做，做完回你。\n会话 on-1 · 第 1 轮', msgId: message.msgId, msgSeq: 1, quote: message.msgId })
    const roundId = roundIdOf(zcode.starts[0]!.prompt)
    await expect(rounds.report({ round: roundId, text: '改了 3 处错别字' })).resolves.toEqual({ recorded: true, duplicate: false })
    await flush()
    expect(sent.at(-1)).toMatchObject({ content: '【默认 · 第 1 轮】\n改了 3 处错别字', msgId: message.msgId, msgSeq: 2, quote: message.msgId })
    expect(table.find(`c2c:${OWNER}`)?.groups['']?.round).toBeNull()
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

  it('同一组一次一轮：第二条排队，回报后自动开下一轮，接着用同一个会话、轮数加一', async () => {
    const { rounds, zcode, sent } = setup()
    await rounds.handleIncoming(c2c('第一件'))
    zcode.over = false
    await rounds.handleIncoming(c2c('第二件'))
    expect(zcode.starts).toHaveLength(1)
    expect(lastContent(sent)).toBe('【默认】上一条还在做，这条排在第 1 个，做完自动开始。')
    await rounds.report({ round: roundIdOf(zcode.starts[0]!.prompt), text: '第一件做完' })
    await vi.waitFor(() => expect(zcode.starts).toHaveLength(2))
    expect(zcode.starts[1]).toMatchObject({ session: 'zcode-session-1' })
    expect(zcode.starts[1]!.prompt).toContain('第二件')
    await vi.waitFor(() => expect(lastContent(sent)).toContain('会话 on-1 · 第 2 轮'))
  })

  it('懒检查：上一轮没回报，又来新消息时问一次执行端，做完了就收尾发回最后的回答、再开新一轮', async () => {
    const { rounds, zcode, sent } = setup()
    await rounds.handleIncoming(c2c('第一件'))
    zcode.over = true; zcode.reply = 'agent 最后说的话'
    await rounds.handleIncoming(c2c('第二件'))
    expect(sent.some((each) => each.content.startsWith('【默认 · 第 1 轮】') && each.content.includes('没有收到回报') && each.content.includes('agent 最后说的话'))).toBe(true)
    expect(zcode.starts).toHaveLength(2)
    expect(zcode.starts[1]!.prompt).toContain('第二件')
    expect(lastContent(sent)).toContain('已接收')
    expect(sent.some((each) => each.content.includes('排在第'))).toBe(false)
  })

  it('派单失败：原话带组名回给私聊，这一轮作废，下一条照常派', async () => {
    const { rounds, zcode, sent, table } = setup()
    zcode.failStart = new Error('应有一个 ZCode 主进程，实际 0 个')
    await rounds.handleIncoming(c2c('任务'))
    expect(lastContent(sent)).toContain('【默认】派单失败：应有一个 ZCode 主进程')
    expect(table.find(`c2c:${OWNER}`)?.groups['']?.round).toBeNull()
    zcode.failStart = null
    await rounds.handleIncoming(c2c('再来'))
    expect(zcode.starts).toHaveLength(1)
  })

  it('ZCode 打开没打开过的工作区失败：不建会话、不记下，原话带组名回给私聊，这一轮作废', async () => {
    const { rounds, sent, table, deps } = setup()
    const created: unknown[] = []
    const zcodeApi = {
      async open() { throw new Error('应有一个工作区窗口，实际 0 个') },
      async create(input: unknown) { created.push(input); return { taskId: 'task-1' } },
    }
    const opened = { has: (workspace: string) => table.zcodeWorkspaceOpened(workspace), remember: (workspace: string) => table.rememberZcodeWorkspaceOpened(workspace) }
    deps.executors.register(zcodeExecutor(zcodeApi as unknown as GwbZcodeApi, opened))
    await rounds.handleIncoming(c2c('任务'))
    expect(lastContent(sent)).toBe(`【默认】派单失败：让 ZCode 打开工作区 ${WORKSPACE} 失败，这一轮没有发出：应有一个工作区窗口，实际 0 个`)
    expect(created).toEqual([])
    expect(table.book.zcodeOpenedWorkspaces).toEqual([])
    expect(table.find(`c2c:${OWNER}`)?.groups['']?.round).toBeNull()
  })
})

describe('入站与分发', () => {
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

  it('不是主人、又没绑定的私聊，直接发的文字回一句怎么绑，不派出；/帮助 回保留命令', async () => {
    const { rounds, zcode, sent } = setup()
    await rounds.handleIncoming(c2c('帮我做', ALICE))
    expect(lastContent(sent)).toContain('【默认】这个私聊还没绑定工作区')
    expect(lastContent(sent)).toContain('qq-bot.bind')
    await rounds.handleIncoming(c2c('/帮助', ALICE))
    expect(lastContent(sent)).toContain('/状态 — ')
    expect(lastContent(sent)).toContain('/新会话 [组名]')
    expect(zcode.starts).toHaveLength(0)
  })

  it('/帮助 按此刻注册的现算：任务组列「命令 — 称呼」，直接命令列「命令 — 说明」', async () => {
    const { rounds, sent, registry } = setup()
    await rounds.addGroup({ command: '/论文', title: '学位论文', workspace: WORKSPACE, agent: 'zcode' })
    registry.registerTaskGroup(MMC, { plugin: '@godcreator/gwb-collab', storedGroupCommands: [] })
    registry.registerCommand({ command: '/血糖', description: '查最近的血糖', handle: async () => '5.6' }, { plugin: undefined, storedGroupCommands: [] })
    await rounds.handleIncoming(c2c('/帮助'))
    const help = lastContent(sent)
    expect(help).toContain('直接发的文字进默认组（「个人空间」，交给 ZCode）')
    expect(help).toContain('/论文 — 学位论文')
    expect(help).toContain('/mmc — 混合型 MMC 样机')
    expect(help).toContain('/血糖 — 查最近的血糖')
  })

  it('/帮助 里默认组的执行端写显示名，没装的写 id 并注明没装', async () => {
    const { rounds, sent, deps } = setup()
    await rounds.handleIncoming(c2c('/帮助', ALICE))
    await rounds.bind({ chat: `c2c:${ALICE}`, workspace: WORKSPACE, title: '混合型 MMC 样机', agent: 'claudecode' })
    await rounds.handleIncoming(c2c('/帮助', ALICE))
    expect(lastContent(sent)).toContain('直接发的文字进默认组（「混合型 MMC 样机」，交给 Claude Code）')
    deps.executors.register({ ...deps.executors.get('claudecode') })()
    await rounds.handleIncoming(c2c('/帮助', ALICE))
    expect(lastContent(sent)).toContain('直接发的文字进默认组（「混合型 MMC 样机」，交给 claudecode（没装））')
  })

  it('以 / 开头却不是任何命令：回「没有指令」并附上帮助列表，不派出', async () => {
    const { rounds, zcode, sent } = setup()
    await rounds.addGroup(MMC)
    await rounds.handleIncoming(c2c('/mmcc 改一下参数'))
    expect(lastContent(sent)).toMatch(/^没有指令 \/mmcc，这条没有派出。\n/u)
    expect(lastContent(sent)).toContain('/mmc — 混合型 MMC 样机')
    await rounds.handleIncoming(c2c('/帮助一下'))
    expect(lastContent(sent)).toContain('没有指令 /帮助一下')
    expect(zcode.starts).toHaveLength(0)
  })

  it('保留命令后面带了别的文字、只发组命令没正文、/新会话 后面不止一个组名：都回用法，不派出', async () => {
    const { rounds, zcode, claudecode, sent } = setup()
    await rounds.addGroup(MMC)
    await rounds.handleIncoming(c2c('/帮助 一下'))
    expect(lastContent(sent)).toContain('/帮助 后面不带别的文字')
    await rounds.handleIncoming(c2c('/状态 默认'))
    expect(lastContent(sent)).toContain('/状态 后面不带别的文字')
    await rounds.handleIncoming(c2c('/mmc'))
    expect(lastContent(sent)).toBe('用法：/mmc <任务>，命令后面空一格写要做的事')
    await rounds.handleIncoming(c2c('/新会话 mmc 默认'))
    expect(lastContent(sent)).toContain('组名只有一个')
    expect(zcode.starts).toHaveLength(0)
    expect(claudecode.starts).toHaveLength(0)
  })

  it('组命令按第一个空白切分：全角空格、换行都算，正文是命令后面的部分', async () => {
    const { rounds, claudecode } = setup()
    await rounds.addGroup(MMC)
    await rounds.handleIncoming(c2c('/mmc　把 DSP 的采样频率改成 20k'))
    expect(claudecode.starts[0]!.prompt).toMatch(/^把 DSP 的采样频率改成 20k\n/u)
    expect(claudecode.starts[0]!.prompt).not.toContain('/mmc')
  })
})

describe('任务组', () => {
  it('命令登记的组：没绑定的私聊也能用；提示词写组的称呼、工作区与组要求；回执与结果开头写组名', async () => {
    const { rounds, claudecode, sent } = setup()
    await expect(rounds.addGroup({ ...MMC, instructions: '先读 skill collab' })).resolves.toEqual({ ...MMC, instructions: '先读 skill collab' })
    const task = c2c('/mmc 改一下仿真参数', ALICE)
    await rounds.handleIncoming(task)
    expect(claudecode.starts[0]).toMatchObject({ workspace: MMC_WORKSPACE, session: null })
    const prompt = claudecode.starts[0]!.prompt
    expect(prompt).toContain(`任务组「混合型 MMC 样机」。在工作区 ${MMC_WORKSPACE} 里做`)
    expect(prompt).toContain('[任务组要求]\n先读 skill collab\n')
    expect(lastContent(sent)).toBe('【mmc】已接收，交给 Claude Code 在「混合型 MMC 样机」里做，做完回你。\n会话 on-1 · 第 1 轮')
    await rounds.report({ round: roundIdOf(prompt), text: '参数改好了' })
    await flush()
    expect(sent.at(-1)).toMatchObject({ content: '【mmc · 第 1 轮】\n参数改好了', quote: task.msgId })
  })

  it('两个组可以同时在跑，各自排队；report 按本轮编号在所有组里找', async () => {
    const { rounds, zcode, claudecode, sent } = setup()
    await rounds.addGroup(MMC)
    await rounds.handleIncoming(c2c('日常的事'))
    await rounds.handleIncoming(c2c('/mmc 样机的事'))
    expect(zcode.starts).toHaveLength(1)
    expect(claudecode.starts).toHaveLength(1)
    await rounds.handleIncoming(c2c('/mmc 样机的第二件事'))
    expect(lastContent(sent)).toBe('【mmc】上一条还在做，这条排在第 1 个，做完自动开始。')
    await rounds.report({ round: roundIdOf(claudecode.starts[0]!.prompt), text: '样机做完' })
    await vi.waitFor(() => expect(claudecode.starts).toHaveLength(2))
    expect(sent.some((each) => each.content === '【mmc · 第 1 轮】\n样机做完')).toBe(true)
    await rounds.report({ round: roundIdOf(zcode.starts[0]!.prompt), text: '日常做完' })
    await flush()
    expect(sent.some((each) => each.content === '【默认 · 第 1 轮】\n日常做完')).toBe(true)
  })

  it('group.add 的命令名不合规则、重名、执行端没装、目录不对、不认识的键都报错', async () => {
    const { rounds, registry, deps } = setup()
    registry.registerCommand({ command: '/血糖', description: '查血糖', handle: async () => '' }, { plugin: '@godcreator/gwb-cgm', storedGroupCommands: [] })
    await rounds.addGroup(MMC)
    await expect(rounds.addGroup({ ...MMC, command: '/新会话' })).rejects.toThrow('保留命令')
    await expect(rounds.addGroup({ ...MMC })).rejects.toThrow('命令 /mmc 已经被命令登记的任务组（qq-bot.group.add）占用')
    await expect(rounds.addGroup({ ...MMC, command: '/血糖' })).rejects.toThrow('插件 @godcreator/gwb-cgm 注册的直接命令')
    await expect(rounds.addGroup({ ...MMC, command: '/一二三四五六七八九' })).rejects.toThrow('太长')
    await expect(rounds.addGroup({ ...MMC, command: '/a b' })).rejects.toThrow('不能含空白')
    await expect(rounds.addGroup({ ...MMC, command: '/x', workspace: 'relative' })).rejects.toThrow('绝对路径')
    await expect(rounds.addGroup({ ...MMC, command: '/x', agent: 'codex' })).rejects.toThrow('agent 只能是 zcode、claudecode')
    await expect(rounds.addGroup({ ...MMC, command: '/x', idleHours: 0 })).rejects.toThrow('idleHours 要是正数')
    await expect(rounds.addGroup({ ...MMC, command: '/x', collab: true })).rejects.toThrow('不认识参数 collab')
    deps.executors.register({ ...deps.executors.get('zcode'), id: 'zcode' })()
    await expect(rounds.addGroup({ ...MMC, command: '/x', agent: 'zcode' })).rejects.toThrow('执行端 zcode 没装')
  })

  it('group.remove：只删命令登记的组，插件注册的报错写明来源；有任务在做或排队时拒绝', async () => {
    const { rounds, registry, zcode } = setup()
    registry.registerTaskGroup({ ...MMC, command: '/sst' }, { plugin: '@godcreator/gwb-collab', storedGroupCommands: [] })
    await expect(rounds.removeGroup({ command: '/sst' })).rejects.toThrow('/sst 是插件 @godcreator/gwb-collab 注册的任务组，不能用命令删')
    await expect(rounds.removeGroup({ command: '/没有' })).rejects.toThrow('没有命令登记的任务组 /没有')
    await rounds.addGroup({ ...MMC, command: '/论文', agent: 'zcode' })
    await rounds.handleIncoming(c2c('/论文 改摘要'))
    await expect(rounds.removeGroup({ command: '/论文' })).rejects.toThrow('还有在做或排队的任务')
    await rounds.report({ round: roundIdOf(zcode.starts[0]!.prompt), text: '改好了' })
    await flush()
    await expect(rounds.removeGroup({ command: '/论文' })).resolves.toMatchObject({ command: '/论文' })
    await expect(rounds.listGroups()).resolves.toMatchObject({ groups: [{ source: 'default' }, { command: '/sst' }] })
  })

  it('group.list 列出三种来源的组与直接命令，插件注册的写插件名、取不到就不写', async () => {
    const { rounds, registry } = setup()
    await rounds.handleIncoming(c2c('/帮助', ALICE))
    await rounds.addGroup({ ...MMC, command: '/论文', agent: 'zcode' })
    registry.registerTaskGroup(MMC, { plugin: '@godcreator/gwb-collab', storedGroupCommands: [] })
    registry.registerCommand({ command: '/血糖', description: '查血糖', handle: async () => '' }, { plugin: undefined, storedGroupCommands: [] })
    const listed = await rounds.listGroups()
    expect(listed.groups).toEqual([
      { group: '默认', command: null, source: 'default', chats: [{ chat: `c2c:${ALICE}`, binding: null, bindingFromDefault: false }] },
      { group: '论文', ...MMC, command: '/论文', agent: 'zcode', source: 'command' },
      { group: 'mmc', ...MMC, source: 'plugin', plugin: '@godcreator/gwb-collab' },
    ])
    expect(listed.directCommands).toEqual([{ command: '/血糖', description: '查血糖', source: 'plugin' }])
  })

  it('插件注册的组能派任务，撤掉以后同一个命令回「没有指令」', async () => {
    const { rounds, registry, claudecode, sent } = setup()
    const unregister = registry.registerTaskGroup(MMC, { plugin: '@godcreator/gwb-collab', storedGroupCommands: [] })
    await rounds.handleIncoming(c2c('/mmc 跑一次仿真'))
    expect(claudecode.starts).toHaveLength(1)
    unregister()
    await rounds.handleIncoming(c2c('/mmc 再跑一次'))
    expect(lastContent(sent)).toContain('没有指令 /mmc')
    expect(claudecode.starts).toHaveLength(1)
  })

  it('插件在聊天表读回之前注册了和命令登记的组同名的命令：派到它的消息报重名，不派出', async () => {
    const first = setup()
    await first.rounds.addGroup(MMC)
    await first.rounds.dispose()
    const registry = new PluginCommandRegistry()
    registry.registerTaskGroup(MMC, { plugin: '@godcreator/gwb-collab', storedGroupCommands: [] })
    const second = setup({ stored: first.store(), registry })
    await second.table.settle()
    expect(second.rounds.conflictingCommands()).toEqual(['/mmc'])
    await second.rounds.handleIncoming(c2c('/mmc 改参数'))
    expect(lastContent(second.sent)).toContain('指令 /mmc 同时是命令登记的任务组和插件 @godcreator/gwb-collab 注册的任务组')
    expect(second.claudecode.starts).toHaveLength(0)
  })

  it('派任务时执行端没装：原因带组名回给私聊，不派出', async () => {
    const registry = new PluginCommandRegistry()
    const { rounds, deps, sent } = setup({ registry })
    registry.registerTaskGroup(MMC, { plugin: undefined, storedGroupCommands: [] })
    deps.executors.register({ ...deps.executors.get('claudecode') })()
    await rounds.handleIncoming(c2c('/mmc 改参数'))
    expect(lastContent(sent)).toContain('【mmc】派单失败：没装执行端 claudecode')
  })
})

describe('直接命令', () => {
  it('handle 交回的文字当场按被动回复发回，拿到正文与发消息的人；不排队、不开会话', async () => {
    const { rounds, registry, zcode, sent, table } = setup()
    const handle = vi.fn(async (input: { text: string; senderOpenid: string }) => `血糖 5.6（${input.text}）`)
    registry.registerCommand({ command: '/血糖', description: '查最近的血糖', handle }, { plugin: undefined, storedGroupCommands: [] })
    const message = c2c('/血糖 最近一小时')
    await rounds.handleIncoming(message)
    expect(handle).toHaveBeenCalledWith({ text: '最近一小时', senderOpenid: OWNER })
    expect(sent.at(-1)).toMatchObject({ content: '血糖 5.6（最近一小时）', msgId: message.msgId, quote: message.msgId })
    expect(zcode.starts).toHaveLength(0)
    expect(table.find(`c2c:${OWNER}`)?.groups).toEqual({})
  })

  it('handle 抛错时回「指令 /xxx 出错：原话」', async () => {
    const { rounds, registry, sent } = setup()
    registry.registerCommand({ command: '/血糖', description: '查血糖', handle: async () => { throw new Error('传感器没连上') } }, { plugin: undefined, storedGroupCommands: [] })
    await rounds.handleIncoming(c2c('/血糖'))
    expect(lastContent(sent)).toBe('指令 /血糖 出错：传感器没连上')
  })
})

describe('会话', () => {
  it('/新会话 只清默认组；/新会话 组名 只清那一组；组名不存在报错列出可用组名', async () => {
    const { rounds, zcode, claudecode, sent } = setup()
    await rounds.addGroup(MMC)
    await rounds.handleIncoming(c2c('默认的第一件'))
    await rounds.handleIncoming(c2c('/mmc 样机的第一件'))
    await rounds.report({ round: roundIdOf(zcode.starts[0]!.prompt), text: '好了' })
    await rounds.report({ round: roundIdOf(claudecode.starts[0]!.prompt), text: '好了' })
    await flush()
    await rounds.handleIncoming(c2c('/新会话 mmc'))
    expect(lastContent(sent)).toBe('【mmc】下一条起用新会话；在做的这一轮照常回报。')
    await rounds.handleIncoming(c2c('/新会话 sst'))
    expect(lastContent(sent)).toBe('没有任务组 sst。可用的组名：mmc；不写组名是默认组。')
    await rounds.handleIncoming(c2c('默认的第二件'))
    await rounds.handleIncoming(c2c('/mmc 样机的第二件'))
    expect(zcode.starts[1]).toMatchObject({ session: 'zcode-session-1' })
    expect(claudecode.starts[1]).toMatchObject({ session: null })
    await rounds.report({ round: roundIdOf(zcode.starts[1]!.prompt), text: '好了' })
    await flush()
    await rounds.handleIncoming(c2c('/新会话'))
    expect(lastContent(sent)).toBe('【默认】下一条起用新会话；在做的这一轮照常回报。')
    await rounds.handleIncoming(c2c('默认的第三件'))
    expect(zcode.starts[2]).toMatchObject({ session: null })
  })

  it('空闲超过设置 idle-hours，下一条开新会话并在回执里写明；没超过就接着用', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T08:00:00Z'))
    const { rounds, zcode, sent } = setup()
    await rounds.handleIncoming(c2c('第一件'))
    await rounds.report({ round: roundIdOf(zcode.starts[0]!.prompt), text: '好了' })
    await flush()
    vi.setSystemTime(new Date(Date.now() + 5 * HOUR))
    await rounds.handleIncoming(c2c('第二件'))
    expect(zcode.starts[1]).toMatchObject({ session: 'zcode-session-1' })
    expect(lastContent(sent)).toContain('会话 on-1 · 第 2 轮')
    await rounds.report({ round: roundIdOf(zcode.starts[1]!.prompt), text: '好了' })
    await flush()
    vi.setSystemTime(new Date(Date.now() + 7 * HOUR))
    await rounds.handleIncoming(c2c('第三件'))
    expect(zcode.starts[2]).toMatchObject({ session: null })
    expect(lastContent(sent)).toBe('【默认】已接收，交给 ZCode 在「个人空间」里做，做完回你。\n会话 on-3 · 第 1 轮\n已开新会话（空闲超过 6 小时）')
  })

  it('组自己的 idleHours 优先于设置', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T08:00:00Z'))
    const { rounds, claudecode, sent } = setup()
    await rounds.addGroup({ ...MMC, idleHours: 1 })
    await rounds.handleIncoming(c2c('/mmc 第一件'))
    await rounds.report({ round: roundIdOf(claudecode.starts[0]!.prompt), text: '好了' })
    await flush()
    vi.setSystemTime(new Date(Date.now() + 2 * HOUR))
    await rounds.handleIncoming(c2c('/mmc 第二件'))
    expect(claudecode.starts[1]).toMatchObject({ session: null })
    expect(lastContent(sent)).toContain('已开新会话（空闲超过 1 小时）')
  })

  it('设置 idle-hours 不是正数：派任务时报错，不派出', async () => {
    const { rounds, zcode, sent, settings } = setup()
    settings.idleHours = 0
    await rounds.handleIncoming(c2c('任务'))
    expect(lastContent(sent)).toBe('【默认】这条没有派出：设置 idle-hours 要是正数（小时），现在是 0：到设置的 qq-bot 分区改好再发')
    expect(zcode.starts).toHaveLength(0)
  })
})

describe('绑定', () => {
  it('绑定设的是默认组：instructions 写进「[任务组要求]」；默认组有任务时拒绝改绑，别的组在跑不影响', async () => {
    const { rounds, claudecode, sent } = setup()
    await rounds.addGroup({ ...MMC, command: '/sst' })
    await rounds.handleIncoming(c2c('/帮助', ALICE))
    await rounds.handleIncoming(c2c('/sst 别的组的事', ALICE))
    const bound = await rounds.bind({ chat: `c2c:${ALICE}`, workspace: WORKSPACE, title: '混合型 MMC 样机', agent: 'claudecode', instructions: '改动先给人看' })
    expect(bound.binding).toEqual({ workspace: WORKSPACE, agent: 'claudecode', title: '混合型 MMC 样机', instructions: '改动先给人看' })
    await rounds.handleIncoming(c2c('改一下仿真参数', ALICE))
    expect(claudecode.starts[1]!.prompt).toContain('[任务组要求]\n改动先给人看')
    expect(claudecode.starts[1]!.prompt).not.toContain('collab.submit')
    expect(lastContent(sent)).toContain('【默认】已接收，交给 Claude Code 在「混合型 MMC 样机」里做')
    await expect(rounds.bind({ chat: `c2c:${ALICE}`, workspace: WORKSPACE, title: '别的' })).rejects.toThrow('默认组还有在做或排队的任务')
  })

  it('参数不对直接报错：collab 已经删掉、相对路径、没装的执行端、不认识的键、没见过的聊天', async () => {
    const { rounds } = setup()
    await rounds.handleIncoming(c2c('/帮助', ALICE))
    await expect(rounds.bind({ chat: `c2c:${ALICE}`, workspace: WORKSPACE, title: 'x', collab: true })).rejects.toThrow('不认识参数 collab')
    await expect(rounds.bind({ chat: `c2c:${ALICE}`, workspace: 'relative', title: 'x' })).rejects.toThrow('绝对路径')
    await expect(rounds.bind({ chat: `c2c:${ALICE}`, workspace: WORKSPACE, title: 'x', agent: 'codex' })).rejects.toThrow('没装')
    await expect(rounds.bind({ chat: `c2c:${ALICE}`, workspace: WORKSPACE, title: 'x', projectRepo: 'x' })).rejects.toThrow('不认识参数 projectRepo')
    await expect(rounds.bind({ chat: 'c2c:nobody', workspace: WORKSPACE, title: 'x' })).rejects.toThrow('没有聊天')
  })

  it('改绑之后默认组下一条开新会话', async () => {
    const { rounds, zcode } = setup()
    await rounds.handleIncoming(c2c('第一件'))
    await rounds.report({ round: roundIdOf(zcode.starts[0]!.prompt), text: '好了' })
    await flush()
    await rounds.bind({ chat: `c2c:${OWNER}`, workspace: WORKSPACE, title: '个人空间' })
    await rounds.handleIncoming(c2c('第二件'))
    expect(zcode.starts[1]).toMatchObject({ session: null })
  })
})

describe('/状态 与没送达的结果', () => {
  it('结果被动、主动都发不出去就带组名记进没送达，/状态 时补发：被动回复挂在 /状态 上，引用的仍是派出这一轮的那条', async () => {
    const { rounds, zcode, sent, table, deps } = setup()
    const task = c2c('长任务')
    await rounds.handleIncoming(task)
    const refused = { ok: false as const, status: 400, message: '频控' }
    deps.sendC2c.mockResolvedValueOnce(refused).mockResolvedValueOnce(refused)
    await rounds.report({ round: roundIdOf(zcode.starts[0]!.prompt), text: '长任务结果' })
    await flush()
    expect(table.find(`c2c:${OWNER}`)?.undelivered).toEqual([{ group: '默认', text: '长任务结果', quote: task.msgId }])
    const status = c2c('/状态')
    await rounds.handleIncoming(status)
    expect(sent.at(-1)).toMatchObject({ content: '【默认】补发结果：\n长任务结果', msgId: status.msgId, quote: task.msgId })
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
    expect(sent.at(-1)).toMatchObject({ content: '【默认 · 第 1 轮】\n长任务结果', msgId: undefined, msgSeq: undefined, quote: task.msgId })
  })

  it('/状态 逐组报：在跑的组做一次懒检查、报第几轮与回答末尾，空闲的组报空闲', async () => {
    const { rounds, zcode, sent } = setup()
    await rounds.addGroup(MMC)
    await rounds.handleIncoming(c2c('任务'))
    await rounds.handleIncoming(c2c('排队的任务'))
    zcode.over = false; zcode.reply = '正在读文件'
    await rounds.handleIncoming(c2c('/状态'))
    expect(lastContent(sent)).toBe('【默认】还在做第 1 轮，排队 1 条。最新的回答末尾：\n正在读文件\n【mmc】空闲')
  })

  it('/状态 时在跑的那一轮已经结束却没回报：先报状态，再收尾发回最后的回答', async () => {
    const { rounds, zcode, sent } = setup()
    await rounds.handleIncoming(c2c('任务'))
    zcode.over = true; zcode.reply = '最后的话'
    await rounds.handleIncoming(c2c('/状态'))
    expect(sent.at(-2)!.content).toBe('【默认】第 1 轮已经结束、没有收到回报，最后的回答随后发')
    expect(lastContent(sent)).toContain('【默认 · 第 1 轮】\n执行端这一轮已经结束，没有收到回报。最后的回答：\n最后的话')
  })

  it('qq-bot.status 的私聊按组列出会话、在跑的一轮、排队与上一条任务的时间', async () => {
    const { rounds } = setup()
    await rounds.addGroup(MMC)
    await rounds.handleIncoming(c2c('/mmc 任务'))
    const [chat] = await rounds.summary()
    expect(chat).toMatchObject({ id: `c2c:${OWNER}`, binding: { title: '个人空间' }, bindingFromDefault: true, undelivered: 0 })
    expect(chat!.groups).toHaveLength(2)
    expect(chat!.groups[0]).toEqual({ group: '默认', title: '个人空间', workspace: WORKSPACE, agent: 'zcode', source: 'default', session: null, round: null, queued: 0, lastTaskAt: null })
    expect(chat!.groups[1]).toMatchObject({
      group: 'mmc', title: '混合型 MMC 样机', workspace: MMC_WORKSPACE, agent: 'claudecode', source: 'command',
      session: { agent: 'claudecode', workspace: MMC_WORKSPACE, id: 'claudecode-session-1', rounds: 1 },
      round: { turn: 1, agent: 'claudecode', session: 'claudecode-session-1' }, queued: 0,
    })
    expect(chat!.groups[1]!.lastTaskAt).toMatch(/^\d{4}-/u)
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

  it('重载后聊天表读回，在跑的那一轮照样收回报', async () => {
    const first = setup()
    await first.rounds.addGroup(MMC)
    await first.rounds.handleIncoming(c2c('/mmc 任务'))
    const roundId = roundIdOf(first.claudecode.starts[0]!.prompt)
    await first.rounds.dispose()
    const second = setup({ stored: first.store() })
    await expect(second.rounds.report({ round: roundId, text: '重载后的结果' })).resolves.toEqual({ recorded: true, duplicate: false })
    await flush()
    expect(lastContent(second.sent)).toBe('【mmc · 第 1 轮】\n重载后的结果')
  })
})

describe('消息记录', () => {
  it('入站记正文全文与分到哪；回执与结果记种类、组名、本轮编号、被动回复挂在哪条上、引用、第几段与结果', async () => {
    const { rounds, zcode, records } = setup()
    const task = c2c('把 README 的错别字改掉')
    await rounds.handleIncoming(task)
    const roundId = roundIdOf(zcode.starts[0]!.prompt)
    await rounds.report({ round: roundId, text: '改了 3 处' })
    await flush()
    const [inbound, receipt, result] = await records()
    expect(inbound).toMatchObject({ direction: 'in', chat: `c2c:${OWNER}`, msgId: task.msgId, text: '把 README 的错别字改掉', route: 'group', group: '默认' })
    expect(receipt).toMatchObject({
      direction: 'out', chat: `c2c:${OWNER}`, kind: 'receipt', group: '默认', round: roundId, mode: 'passive', replyTo: task.msgId, msgSeq: 1,
      quote: task.msgId, segment: { index: 1, total: 1 }, msgId: 'sent', result: { ok: true },
    })
    expect(receipt!.direction === 'out' && receipt!.text).toContain('已接收')
    expect(result).toMatchObject({ kind: 'result', group: '默认', round: roundId, text: '【默认 · 第 1 轮】\n改了 3 处', msgSeq: 2 })
    expect(Date.parse(inbound!.at)).not.toBeNaN()
  })

  it('白名单外的入站只记 openid 与正文前 40 字，标明被拒，不记全文', async () => {
    const { rounds, records } = setup()
    await rounds.handleIncoming(c2c(`${'甲'.repeat(40)}后面的不记`, 'stranger'))
    const [rejected] = await records()
    expect(rejected).toEqual({ at: expect.any(String) as string, direction: 'in', chat: 'c2c:stranger', msgId: expect.any(String) as string, route: 'rejected', excerpt: '甲'.repeat(40) })
  })

  it('没派出的入站记原因：没有指令、用法、重名之外的组派不出去、空消息、重复投递；对应的出站种类是 not-dispatched', async () => {
    const { rounds, records } = setup()
    await rounds.handleIncoming(c2c('/没有这个 做点事'))
    await rounds.handleIncoming(c2c('/帮助 一下'))
    await rounds.handleIncoming(c2c('帮我做', ALICE))
    await rounds.handleIncoming(c2c('   '))
    const repeated = c2c('/帮助')
    await rounds.handleIncoming(repeated)
    await rounds.handleIncoming(repeated)
    const inbound = (await records()).filter((record) => record.direction === 'in')
    expect(inbound).toMatchObject([
      { route: 'not-dispatched', reason: 'unknown-command', command: '/没有这个' },
      { route: 'not-dispatched', reason: 'usage', detail: '/帮助 后面不带别的文字，只发 /帮助' },
      { route: 'not-dispatched', reason: 'group-unavailable', group: '默认', chat: `c2c:${ALICE}` },
      { route: 'not-dispatched', reason: 'empty', text: '   ' },
      { route: 'reserved', command: '/帮助' },
      { route: 'not-dispatched', reason: 'duplicate', msgId: repeated.msgId },
    ])
    const kinds = (await records()).flatMap((record) => record.direction === 'out' ? [[record.kind, record.group ?? null]] : [])
    expect(kinds).toEqual([['not-dispatched', null], ['not-dispatched', null], ['not-dispatched', '默认'], ['command-answer', null]])
  })

  it('出站失败记官方错误码与原话；被动发不出去改发主动，两次各记一条', async () => {
    const { rounds, zcode, deps, records } = setup()
    await rounds.handleIncoming(c2c('长任务'))
    const roundId = roundIdOf(zcode.starts[0]!.prompt)
    const refused = { ok: false as const, status: 400, code: 22009, message: '频控' }
    deps.sendC2c.mockResolvedValueOnce(refused).mockResolvedValueOnce(refused)
    await rounds.report({ round: roundId, text: '结果' })
    await flush()
    const results = (await records()).filter((record) => record.direction === 'out' && record.kind === 'result')
    expect(results).toMatchObject([
      { mode: 'passive', msgId: null, round: roundId, result: { ok: false, status: 400, code: 22009, message: '频控' } },
      { mode: 'active', msgId: null, round: roundId, result: { ok: false, status: 400, code: 22009, message: '频控' } },
    ])
    expect(results[1]).not.toHaveProperty('replyTo')
  })

  it('分段发送的每段各记一条，标第几段', async () => {
    const { rounds, zcode, records } = setup()
    await rounds.handleIncoming(c2c('长任务'))
    const lines = ['一'.repeat(600), '二'.repeat(600), '三'.repeat(600)]
    await rounds.report({ round: roundIdOf(zcode.starts[0]!.prompt), text: lines.join('\n') })
    await flush()
    const results = (await records()).filter((record) => record.direction === 'out' && record.kind === 'result')
    expect(results.map((record) => record.direction === 'out' && record.segment)).toEqual([{ index: 1, total: 3 }, { index: 2, total: 3 }, { index: 3, total: 3 }])
    expect(results[2]).toMatchObject({ text: `(3/3) ${lines[2]}` })
  })

  it('主人通知记种类 notice 与通知 id，主动消息', async () => {
    const { rounds, records } = setup()
    await rounds.notify('collab-1', '新 MR')
    expect(await records()).toMatchObject([{ direction: 'out', kind: 'notice', notice: 'collab-1', mode: 'active', text: '新 MR', result: { ok: true } }])
  })

  it('/状态 补发的结果记成 resend，带组名', async () => {
    const { rounds, zcode, deps, records } = setup()
    await rounds.handleIncoming(c2c('长任务'))
    const refused = { ok: false as const, status: 400, message: '频控' }
    deps.sendC2c.mockResolvedValueOnce(refused).mockResolvedValueOnce(refused)
    await rounds.report({ round: roundIdOf(zcode.starts[0]!.prompt), text: '长任务结果' })
    await flush()
    await rounds.handleIncoming(c2c('/状态'))
    expect((await records()).at(-1)).toMatchObject({ kind: 'resend', group: '默认', text: '【默认】补发结果：\n长任务结果', result: { ok: true } })
  })
})

describe('聊天表的版本', () => {
  const binding = { workspace: WORKSPACE, agent: 'zcode', title: '个人空间', collab: false }
  const privateChat = { id: `c2c:${ALICE}`, scene: 'c2c', target: ALICE, lastSeen: '', lastSender: ALICE, binding, session: null, round: null, queue: [], lastClosed: null, undelivered: [] }
  const groupChat = { ...privateChat, id: 'group:g-1', scene: 'group', target: 'g-1' }
  const { scene: _scene, ...version2Chat } = privateChat

  it('第 1 版：去掉群聊、私聊去掉 scene，再换成第 3 版，私聊的绑定照留', () => {
    const { book, droppedGroups, migratedChats } = loadBook({ version: 1, chats: [privateChat, groupChat], notices: [], seen: [], replies: {} })
    expect(droppedGroups).toBe(1)
    expect(migratedChats).toBe(1)
    expect(book.version).toBe(3)
    expect(book.groups).toEqual([])
    expect(book.chats).toHaveLength(1)
    expect(book.chats[0]).not.toHaveProperty('scene')
    expect(book.chats[0]).toMatchObject({ id: `c2c:${ALICE}`, binding: { workspace: WORKSPACE, agent: 'zcode', title: '个人空间' } })
    expect(book.chats[0]!.binding).not.toHaveProperty('collab')
  })

  it('第 2 版：会话、在跑的一轮、队列、上一轮的结果归进默认组；没送达的补上组名「默认」；collab 为 true 的绑定换成任务组要求', () => {
    const trigger = { msgId: 'm-1', receivedAt: 1 }
    const round = { id: 'r-1', prompt: '在跑的', sender: OWNER, agent: 'claudecode', workspace: WORKSPACE, session: 's-abcd', trigger }
    const ownerChat = {
      id: `c2c:${OWNER}`, target: OWNER, lastSeen: '2026-10-07T00:00:00.000Z', lastSender: OWNER,
      binding: { workspace: WORKSPACE, agent: 'claudecode', title: '混合型 MMC 样机', collab: true },
      session: { agent: 'claudecode', id: 's-abcd' }, round, queue: [{ prompt: '排队的', sender: OWNER, trigger }],
      lastClosed: { id: 'r-0', text: '上一轮' }, undelivered: [{ text: '没送到的', quote: 'm-0' }],
    }
    const idleOwnerDefault = { ...version2Chat, id: 'c2c:bob', target: 'bob', binding: null, session: { agent: 'zcode', id: 's-lost' } }
    const { book, migratedChats } = loadBook({ version: 2, chats: [ownerChat, version2Chat, idleOwnerDefault], notices: [], seen: [], replies: {} })
    expect(migratedChats).toBe(3)
    expect(book.version).toBe(3)
    const [owner, alice, bob] = book.chats
    expect(owner).toEqual({
      id: `c2c:${OWNER}`, target: OWNER, lastSeen: '2026-10-07T00:00:00.000Z', lastSender: OWNER,
      binding: { workspace: WORKSPACE, agent: 'claudecode', title: '混合型 MMC 样机', instructions: COLLAB_INSTRUCTIONS },
      groups: { '': {
        session: { agent: 'claudecode', id: 's-abcd', workspace: WORKSPACE, rounds: 1 },
        round: { ...round, group: '', turn: 1 },
        queue: [{ prompt: '排队的', sender: OWNER, trigger }],
        lastClosed: { id: 'r-0', text: '上一轮' },
        lastTaskAt: null,
      } },
      undelivered: [{ group: '默认', text: '没送到的', quote: 'm-0' }],
    })
    expect(COLLAB_INSTRUCTIONS).toBe('先读 gwb 说明书 collab（经 gwb MCP 调 run skill.read {"name":"collab"}），协作仓和项目里其余仓的改动照它提交。')
    expect(alice!.binding).toEqual({ workspace: WORKSPACE, agent: 'zcode', title: '个人空间' })
    expect(bob!.groups['']!.session).toBeNull()
  })

  it('读回第 2 版以后，在跑的那一轮照样收回报，下次写盘就是第 3 版', async () => {
    const trigger = { msgId: 'm-1', receivedAt: Date.now() }
    const ownerChat = { ...version2Chat, id: `c2c:${OWNER}`, target: OWNER, binding: null, session: { agent: 'zcode', id: 's-1' }, round: { id: 'r-aaaaaaaaaaaa', prompt: 'x', sender: OWNER, agent: 'zcode', workspace: WORKSPACE, session: 's-1', trigger } }
    const { rounds, table, sent, store } = setup({ stored: { version: 2, chats: [ownerChat], notices: [], seen: [], replies: {} } })
    await table.settle()
    expect(table.migratedChats).toBe(1)
    await rounds.report({ round: 'r-aaaaaaaaaaaa', text: '迁移前派出的' })
    await flush()
    expect(lastContent(sent)).toBe('【默认 · 第 1 轮】\n迁移前派出的')
    expect(store()).toMatchObject({ version: 3, groups: [] })
  })

  it('第 3 版没有 zcodeOpenedWorkspaces 读成空列表，有就原样读回；从第 1、2 版迁过来的也是空列表；不是字符串列表停止处理', () => {
    const version3 = { version: 3, chats: [], groups: [], notices: [], seen: [], replies: {} }
    expect(loadBook(version3).book.zcodeOpenedWorkspaces).toEqual([])
    expect(loadBook({ ...version3, zcodeOpenedWorkspaces: [WORKSPACE] }).book.zcodeOpenedWorkspaces).toEqual([WORKSPACE])
    expect(loadBook({ version: 2, chats: [], notices: [], seen: [], replies: {} }).book.zcodeOpenedWorkspaces).toEqual([])
    expect(() => loadBook({ ...version3, zcodeOpenedWorkspaces: [1] })).toThrow('zcodeOpenedWorkspaces 不是字符串列表')
    expect(() => loadBook({ ...version3, zcodeOpenedWorkspaces: null })).toThrow('zcodeOpenedWorkspaces 不是字符串列表')
  })

  it('第 2 版里还带着 scene、第 1 版里 scene 认不出、版本号不认识、第 3 版缺 groups，都停止处理', () => {
    expect(() => loadBook({ version: 2, chats: [privateChat], notices: [], seen: [], replies: {} })).toThrow('还带着 scene')
    expect(() => loadBook({ version: 1, chats: [{ ...privateChat, scene: 'guild' }], notices: [], seen: [], replies: {} })).toThrow('scene 既不是 c2c 也不是 group')
    expect(() => loadBook({ version: 4, chats: [], notices: [], seen: [], replies: {} })).toThrow('格式不对')
    expect(() => loadBook({ version: 3, chats: [], notices: [], seen: [], replies: {} })).toThrow('缺 groups')
    expect(() => loadBook({ version: 3, chats: [{ ...version2Chat, groups: {}, undelivered: [{ text: 'x', quote: 'm' }] }], groups: [], notices: [], seen: [], replies: {} })).toThrow('形状不对')
  })
})
