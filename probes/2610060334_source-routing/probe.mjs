import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { ZcodeBridge } from './input/bridge.mjs'

const fixture = JSON.parse(await readFile(new URL('./input/fixtures.json', import.meta.url), 'utf8'))
const bundle = await readFile(new URL('./input/bridge.mjs', import.meta.url))
const startedAt = new Date().toISOString()
const output = {
  experiment: 'source-routing', startedAt,
  environment: { node: process.version, platform: process.platform, arch: process.arch, baseCommit: '98c25f5d44b31e8802d3ba035fe4e3354e1288f7+worktree' },
  frozenInput: { file: 'input/bridge.mjs', sha256: createHash('sha256').update(bundle).digest('hex') },
  fixtureSha256: createHash('sha256').update(await readFile(new URL('./input/fixtures.json', import.meta.url))).digest('hex'),
  checks: [], traces: [],
}

function group(id, target, content = '执行无害的实验任务', senderOpenid = fixture.owner) {
  return { scene: 'group', msgId: id, senderOpenid, replyTarget: target, content }
}
function privateMessage(id, content = '执行个人实验任务') {
  return { scene: 'c2c', msgId: id, senderOpenid: fixture.owner, replyTarget: fixture.owner, content }
}
function sourceFromPrompt(prompt) {
  for (const line of prompt.split('\n')) {
    try {
      const value = JSON.parse(line)
      if (value && typeof value === 'object' && value.home && value.appId && value.scene && value.senderOpenid) return value
    } catch { /* 任务正文和说明文字不是 JSON。 */ }
  }
  assert.fail('派单没有可读取的可信来源 JSON 元数据')
}
function harness(name, initial) {
  let doc = structuredClone(initial)
  let nextTask = 0
  const trace = { name, commands: [], dispatches: [], replies: [], logs: [] }
  output.traces.push(trace)
  const deps = {
    home: fixture.home, appId: () => fixture.appId,
    defaultWorkspace: () => fixture.personalWorkspace,
    allowedOpenids: () => [fixture.owner, fixture.peer], ownerOpenid: () => fixture.owner,
    journalLibrary: () => fixture.personalLibrary, reportServer: () => fixture.reportServer,
    read: async () => structuredClone(doc), write: async (value) => { doc = structuredClone(value) },
    runCommand: async (name, args) => {
      trace.commands.push({ name, args: structuredClone(args) })
      if (name === 'collab.projects') return { ok: true, data: { projects: structuredClone(fixture.projects) } }
      if (name === 'zcode.create' || name === 'zcode.send') {
        const taskId = args.task ?? `probe-task-${++nextTask}`
        trace.dispatches.push({ name, workspace: args.workspace, taskId, report: structuredClone(args.report), source: sourceFromPrompt(args.prompt), prompt: args.prompt })
        return { ok: true, data: { taskId } }
      }
      if (name === 'zcode.status') return { ok: true, data: { status: 'running', replies: [] } }
      if (name === 'zcode.archive' || name === 'zcode.report.replay') return { ok: true, data: {} }
      assert.fail(`实验未声明的 GWB 命令：${name}`)
    },
    sendC2c: async (target, content, msgId, msgSeq) => { trace.replies.push({ scene: 'c2c', target, content, msgId, msgSeq }); return { ok: true, id: `sent-${trace.replies.length}` } },
    sendGroup: async (target, content, msgId, msgSeq) => { trace.replies.push({ scene: 'group', target, content, msgId, msgSeq }); return { ok: true, id: `sent-${trace.replies.length}` } },
    log: Object.fromEntries(['info', 'warn', 'error'].map((level) => [level, (message) => trace.logs.push({ level, message })])),
  }
  let bridge = new ZcodeBridge(deps)
  const report = (index, text = `完成结果 ${index}`) => {
    const sent = trace.dispatches[index]
    assert.ok(sent, `找不到第 ${index} 次派单`)
    return { id: sent.report.id, taskId: sent.taskId, workspace: sent.workspace, state: 'completed', text }
  }
  return {
    trace, get bridge() { return bridge }, report,
    async bind(target, projectIndex = 0, journalLibrary) {
      await bridge.handleIncoming(group(`help-${target}`, target, '/帮助'))
      const source = (await bridge.sources()).find((item) => item.target === target && item.scene === 'group')
      assert.ok(source)
      return bridge.bind({ sourceId: source.id, projectRepo: fixture.projects[projectIndex].repo, ...(journalLibrary === undefined ? {} : { journalLibrary }) })
    },
    async reload() { await bridge.dispose(); bridge = new ZcodeBridge(deps); await bridge.restore() },
    async close() { trace.finalStatus = bridge.report(); await bridge.dispose() },
  }
}
async function eventually(condition, label) {
  for (let attempt = 0; attempt < 100; attempt++) { if (condition()) return; await delay(5) }
  assert.ok(condition(), label)
}
async function check(name, run) {
  const start = performance.now()
  try { await run(); output.checks.push({ name, passed: true, elapsedMs: Math.round(performance.now() - start) }) }
  catch (error) { output.checks.push({ name, passed: false, elapsedMs: Math.round(performance.now() - start), error: { message: String(error), stack: error.stack } }) }
}

await check('两个群与主人私聊各自绑定和独立上下文', async () => {
  const h = harness('three-sources')
  try {
    await h.bind(fixture.groups.a, 0)
    await h.bind(fixture.groups.b, 1)
    await h.bridge.handleIncoming(group('a-task', fixture.groups.a))
    await h.bridge.handleIncoming(group('b-task', fixture.groups.b))
    await h.bridge.handleIncoming(privateMessage('private-task'))
    const sends = h.trace.dispatches
    assert.equal(sends.length, 3)
    assert.deepEqual(sends.map((item) => [item.name, item.workspace]), [
      ['zcode.create', fixture.projects[0].repo], ['zcode.create', fixture.projects[1].repo], ['zcode.create', fixture.personalWorkspace],
    ])
    assert.equal(new Set(sends.map((item) => item.taskId)).size, 3)
    assert.deepEqual(sends.map((item) => [item.source.scene, item.source.target, item.source.senderOpenid]), [
      ['group', fixture.groups.a, fixture.owner], ['group', fixture.groups.b, fixture.owner], ['c2c', fixture.owner, fixture.owner],
    ])
    assert.ok(sends.every((item) => item.source.home === fixture.home && item.source.appId === fixture.appId))
    assert.equal(sends[0].source.projectRepo, fixture.projects[0].repo)
    assert.equal(sends[1].source.projectRepo, fixture.projects[1].repo)
    assert.ok(!sends[0].prompt.includes(fixture.personalLibrary) && !sends[1].prompt.includes(fixture.personalLibrary))
    assert.ok(sends[2].prompt.includes(fixture.personalLibrary))
    assert.equal(h.bridge.report().conversations.length, 3)
  } finally { await h.close() }
})

await check('同群多人接续同一会话并保留实际发言者', async () => {
  const h = harness('shared-group')
  try {
    await h.bind(fixture.groups.a, 0, fixture.projectLibrary)
    await h.bridge.handleIncoming(group('owner-first', fixture.groups.a, '主人开始'))
    await h.bridge.receiveReport(h.report(0))
    await h.bridge.handleIncoming(group('peer-next', fixture.groups.a, '成员接着做', fixture.peer))
    assert.equal(h.trace.dispatches.length, 2)
    assert.equal(h.trace.dispatches[1].name, 'zcode.send')
    assert.equal(h.trace.dispatches[1].taskId, h.trace.dispatches[0].taskId)
    assert.equal(h.trace.dispatches[1].source.senderOpenid, fixture.peer)
    assert.equal(h.trace.dispatches[1].source.journalLibrary, fixture.projectLibrary)
    await h.bridge.receiveReport(h.report(1, '成员任务完成'))
    assert.ok(h.trace.replies.some((item) => item.target === fixture.groups.a && item.msgId === 'peer-next' && item.content.includes('成员任务完成')))
    assert.equal(h.bridge.report().conversations.length, 1)
  } finally { await h.close() }
})

await check('同工作区排队，其他工作区可以派发，回报推进队列', async () => {
  const h = harness('workspace-queue')
  try {
    await h.bind(fixture.groups.a, 0)
    await h.bind(fixture.groups.shared, 0)
    await h.bind(fixture.groups.b, 1)
    await h.bridge.handleIncoming(group('first', fixture.groups.a))
    await h.bridge.handleIncoming(group('queued', fixture.groups.shared))
    await h.bridge.handleIncoming(group('parallel', fixture.groups.b))
    assert.deepEqual(h.trace.dispatches.map((item) => item.source.target), [fixture.groups.a, fixture.groups.b])
    await h.bridge.receiveReport(h.report(0))
    await eventually(() => h.trace.dispatches.length === 3, '前一工作区任务回报后没有派出队首')
    assert.equal(h.trace.dispatches[2].source.target, fixture.groups.shared)
    assert.equal(h.trace.dispatches[2].name, 'zcode.create')
    assert.notEqual(h.trace.dispatches[2].taskId, h.trace.dispatches[0].taskId)
  } finally { await h.close() }
})

await check('当前群 /状态 不查询或回显另一群的结果', async () => {
  const h = harness('local-status')
  try {
    await h.bind(fixture.groups.a, 0)
    await h.bind(fixture.groups.b, 1)
    await h.bridge.handleIncoming(group('a-task', fixture.groups.a))
    await h.bridge.receiveReport(h.report(0, '只属于 A 群的结果'))
    const before = h.trace.replies.length
    await h.bridge.handleIncoming(group('b-status', fixture.groups.b, '/状态'))
    const statusReplies = h.trace.replies.slice(before)
    assert.ok(statusReplies.length > 0)
    assert.ok(statusReplies.every((item) => item.target === fixture.groups.b && !item.content.includes('只属于 A 群的结果')))
    assert.equal(h.trace.commands.filter((item) => item.name === 'zcode.status').length, 0)
    await h.bridge.handleIncoming(group('a-status', fixture.groups.a, '/状态'))
    assert.ok(h.trace.replies.some((item) => item.msgId === 'a-status' && item.content.includes('只属于 A 群的结果')))
  } finally { await h.close() }
})

await check('排队任务重载后等待旧回报，并只接续一次', async () => {
  const h = harness('queue-reload')
  try {
    await h.bind(fixture.groups.a, 0)
    await h.bridge.handleIncoming(group('first', fixture.groups.a))
    await h.bridge.handleIncoming(group('queued', fixture.groups.a, '重载后继续', fixture.peer))
    await h.reload()
    assert.equal(h.trace.dispatches.length, 1)
    await h.bridge.receiveReport(h.report(0))
    await eventually(() => h.trace.dispatches.length === 2, '重载后的队列没有推进')
    assert.equal(h.trace.dispatches[1].name, 'zcode.send')
    assert.equal(h.trace.dispatches[1].taskId, h.trace.dispatches[0].taskId)
    assert.equal(h.trace.dispatches[1].source.senderOpenid, fixture.peer)
    assert.ok(h.trace.dispatches[1].prompt.includes('重载后继续'))
    await h.bridge.receiveReport(h.report(0))
    await h.bridge.sources()
    assert.equal(h.trace.dispatches.length, 2)
  } finally { await h.close() }
})

await check('旧 v1 回报保留原地址，混合会话不用于新私聊', async () => {
  const initial = {
    version: 1,
    sessions: [{ openid: fixture.owner, workspace: fixture.personalWorkspace, taskId: 'old-mixed-task', roundIndex: 1, latest: 'old-job' }],
    jobs: [{ id: 'old-job', openid: fixture.owner, taskId: 'old-mixed-task', workspace: fixture.personalWorkspace, round: 1,
      route: { scene: 'group', target: fixture.groups.a, trigger: { msgId: 'old-message', receivedAt: Date.now(), repliesSent: 1 } },
      state: 'pending', text: null, delivery: 'pending' }], seen: [], notices: [],
  }
  const h = harness('v1-migration', initial)
  try {
    await h.bridge.receiveReport({ id: 'old-job', taskId: 'old-mixed-task', workspace: fixture.personalWorkspace, state: 'completed', text: '旧任务完成' })
    assert.ok(h.trace.replies.some((item) => item.target === fixture.groups.a && item.msgId === 'old-message' && item.content.includes('旧任务完成')))
    await h.bridge.handleIncoming(privateMessage('new-private'))
    assert.equal(h.trace.dispatches.length, 1)
    assert.equal(h.trace.dispatches[0].name, 'zcode.create')
    assert.notEqual(h.trace.dispatches[0].taskId, 'old-mixed-task')
    assert.equal(h.trace.dispatches[0].source.scene, 'c2c')
  } finally { await h.close() }
})

await check('未完成任务阻止改绑，新绑定代次不继承旧会话或旧结果', async () => {
  const h = harness('binding-generation')
  try {
    const bound = await h.bind(fixture.groups.a, 0)
    await h.bridge.handleIncoming(group('old-task', fixture.groups.a))
    await assert.rejects(h.bridge.bind({ sourceId: bound.id, projectRepo: fixture.projects[1].repo }))
    await assert.rejects(h.bridge.unbind({ sourceId: bound.id }))
    await h.bridge.receiveReport(h.report(0, '旧项目独有结果'))
    const changed = await h.bridge.bind({ sourceId: bound.id, projectRepo: fixture.projects[1].repo })
    assert.ok(changed.generation > bound.generation)
    const before = h.trace.replies.length
    await h.bridge.handleIncoming(group('new-status', fixture.groups.a, '/状态'))
    assert.ok(h.trace.replies.slice(before).every((item) => !item.content.includes('旧项目独有结果')))
    const afterStatus = h.trace.replies.length
    await h.bridge.receiveReport(h.report(0, '旧项目独有结果'))
    assert.equal(h.trace.replies.length, afterStatus)
    await h.bridge.handleIncoming(group('new-task', fixture.groups.a))
    assert.equal(h.trace.dispatches[1].name, 'zcode.create')
    assert.equal(h.trace.dispatches[1].workspace, fixture.projects[1].repo)
    assert.notEqual(h.trace.dispatches[1].taskId, h.trace.dispatches[0].taskId)
  } finally { await h.close() }
})

output.finishedAt = new Date().toISOString()
output.passed = output.checks.every((item) => item.passed)
output.summary = { checks: output.checks.length, passed: output.checks.filter((item) => item.passed).length, dispatches: output.traces.reduce((sum, item) => sum + item.dispatches.length, 0) }
const runs = new URL('./runs/', import.meta.url)
await mkdir(runs, { recursive: true })
const path = new URL(`${startedAt.replace(/[:.]/gu, '-')}-${process.pid}.json`, runs)
await writeFile(path, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ ...output.summary, passed: output.passed, raw: fileURLToPath(path), bridgeSha256: output.frozenInput.sha256 }))
if (!output.passed) process.exitCode = 1
