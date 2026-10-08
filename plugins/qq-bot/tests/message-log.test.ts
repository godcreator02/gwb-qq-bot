import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageLog, parseMessageQuery, queryMessages, type MessageQuery, type RawSendC2c } from '../src/qq/message-log.js'
import type { IncomingMessage } from '../src/qq/qq-protocol.js'

const dirs: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bot-message-log-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function clockAt(iso: string): { now: () => number; set(next: string): void } {
  let current = Date.parse(iso)
  return { now: () => current, set(next) { current = Date.parse(next) } }
}

const fakeLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
const message = (msgId: string, content: string, senderOpenid = 'alice'): IncomingMessage => ({ msgId, senderOpenid, content })
const sendOk: RawSendC2c = async () => ({ ok: true, id: 'out-1' })
const query = (overrides: Partial<MessageQuery> = {}): MessageQuery => ({ limit: 50, ...overrides })

describe('写入', () => {
  it('按机器人、按月分文件，跨月份查询按时间倒序', async () => {
    const dir = tempDir()
    const clock = clockAt('2026-09-30T23:59:00Z')
    const log = new MessageLog({ dir, appId: 'app-1', log: fakeLog(), now: clock.now })
    log.inbound(message('m1', '九月的'), { route: 'group', group: '默认' })
    clock.set('2026-10-01T00:01:00Z')
    log.inbound(message('m2', '十月的'), { route: 'group', group: '默认' })
    await log.settle()
    expect(fs.readdirSync(dir).sort()).toEqual(['messages-app-1-2026-09.jsonl', 'messages-app-1-2026-10.jsonl'])
    const found = await queryMessages(dir, 'app-1', query())
    expect(found.records.map((record) => record.msgId)).toEqual(['m2', 'm1'])
    expect(found).toMatchObject({ appId: 'app-1', more: false })
    expect((await queryMessages(dir, 'app-2', query())).records).toEqual([])
  })

  it('连上时删掉当月与前 3 个月以外的文件（所有机器人的），删了几个记一行日志；别的文件不动', async () => {
    const dir = tempDir()
    const kept = ['messages-app-1-2026-07.jsonl', 'messages-app-1-2026-08.jsonl', 'messages-app-1-2026-09.jsonl', 'messages-app-1-2026-10.jsonl', 'chats-app-1.json']
    for (const name of [...kept, 'messages-app-1-2026-05.jsonl', 'messages-app-1-2026-06.jsonl', 'messages-app-2-2025-12.jsonl']) fs.writeFileSync(path.join(dir, name), '')
    const logger = fakeLog()
    const log = new MessageLog({ dir, appId: 'app-1', log: logger, now: clockAt('2026-10-15T00:00:00Z').now })
    log.prune()
    await log.settle()
    expect(fs.readdirSync(dir).sort()).toEqual([...kept].sort())
    expect(logger.info).toHaveBeenCalledWith('删掉了 3 个 2026-07 以前的消息记录文件')
  })

  it('跨进新的月份时再清理一次', async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'messages-app-1-2026-06.jsonl'), '')
    const clock = clockAt('2026-09-30T23:59:00Z')
    const log = new MessageLog({ dir, appId: 'app-1', log: fakeLog(), now: clock.now })
    log.inbound(message('m1', '九月的'), { route: 'group', group: '默认' })
    await log.settle()
    expect(fs.existsSync(path.join(dir, 'messages-app-1-2026-06.jsonl'))).toBe(true)
    clock.set('2026-10-01T00:01:00Z')
    log.inbound(message('m2', '十月的'), { route: 'group', group: '默认' })
    await log.settle()
    expect(fs.existsSync(path.join(dir, 'messages-app-1-2026-06.jsonl'))).toBe(false)
  })

  it('写不进去只记一行 warn（不带正文），消息照常发出、结果原样交回', async () => {
    const parent = tempDir()
    const blocker = path.join(parent, 'not-a-dir')
    fs.writeFileSync(blocker, '')
    const logger = fakeLog()
    const log = new MessageLog({ dir: path.join(blocker, 'qq-bot'), appId: 'app-1', log: logger })
    const raw = vi.fn(sendOk)
    const send = log.recordingSend(raw)
    await expect(send('alice', '机密正文', undefined, undefined, undefined, { kind: 'notice', segment: { index: 1, total: 1 } })).resolves.toEqual({ ok: true, id: 'out-1' })
    expect(raw).toHaveBeenCalledWith('alice', '机密正文', undefined, undefined, undefined)
    await log.settle()
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(String(logger.warn.mock.calls[0]![0])).toContain('写消息记录失败（收发不受影响）')
    expect(String(logger.warn.mock.calls[0]![0])).not.toContain('机密正文')
  })

  it('发送抛错时记一条失败（原话），再把错误原样抛出', async () => {
    const dir = tempDir()
    const log = new MessageLog({ dir, appId: 'app-1', log: fakeLog() })
    const send = log.recordingSend(async () => { throw new Error('网络断了') })
    await expect(send('alice', '正文', 'm1', 1, 'm1', { kind: 'receipt', group: '默认', segment: { index: 1, total: 1 } })).rejects.toThrow('网络断了')
    await log.settle()
    expect((await queryMessages(dir, 'app-1', query())).records).toMatchObject([
      { direction: 'out', mode: 'passive', replyTo: 'm1', msgSeq: 1, quote: 'm1', msgId: null, result: { ok: false, message: '网络断了' } },
    ])
  })
})

describe('查询', () => {
  async function seeded(): Promise<string> {
    const dir = tempDir()
    const clock = clockAt('2026-10-08T08:00:00Z')
    const log = new MessageLog({ dir, appId: 'app-1', log: fakeLog(), now: clock.now })
    const send = log.recordingSend(sendOk)
    log.inbound(message('m1', '默认组的任务'), { route: 'group', group: '默认' })
    clock.set('2026-10-08T08:00:01Z')
    await send('alice', '已接收', 'm1', 1, 'm1', { kind: 'receipt', group: '默认', round: 'r-1', segment: { index: 1, total: 1 } })
    clock.set('2026-10-08T09:00:00Z')
    log.inbound(message('m2', '/mmc 样机的事', 'bob'), { route: 'group', group: 'mmc' })
    clock.set('2026-10-08T09:00:01Z')
    await send('bob', '【mmc】已接收', 'm2', 1, 'm2', { kind: 'receipt', group: 'mmc', round: 'r-2', segment: { index: 1, total: 1 } })
    clock.set('2026-10-08T10:00:00Z')
    await send('alice', '【默认 · 第 1 轮】\n做完了', 'm1', 2, 'm1', { kind: 'result', group: '默认', round: 'r-1', segment: { index: 1, total: 1 } })
    await log.settle()
    return dir
  }
  const idsAndTexts = async (dir: string, overrides: Partial<MessageQuery>) => (await queryMessages(dir, 'app-1', query(overrides))).records.map((record) => record.direction === 'out' ? record.text : record.msgId)

  it('按 chat、group、round、direction、since 筛，条件之间是「并且」', async () => {
    const dir = await seeded()
    expect(await idsAndTexts(dir, {})).toEqual(['【默认 · 第 1 轮】\n做完了', '【mmc】已接收', 'm2', '已接收', 'm1'])
    expect(await idsAndTexts(dir, { chat: 'c2c:bob' })).toEqual(['【mmc】已接收', 'm2'])
    expect(await idsAndTexts(dir, { group: '默认' })).toEqual(['【默认 · 第 1 轮】\n做完了', '已接收', 'm1'])
    expect(await idsAndTexts(dir, { round: 'r-1' })).toEqual(['【默认 · 第 1 轮】\n做完了', '已接收'])
    expect(await idsAndTexts(dir, { direction: 'in' })).toEqual(['m2', 'm1'])
    expect(await idsAndTexts(dir, { since: '2026-10-08T09:00:00Z' })).toEqual(['【默认 · 第 1 轮】\n做完了', '【mmc】已接收', 'm2'])
    expect(await idsAndTexts(dir, { group: '默认', direction: 'out', since: '2026-10-08T09:00:00Z' })).toEqual(['【默认 · 第 1 轮】\n做完了'])
  })

  it('limit 取最近的几条，more 说明还有更早的', async () => {
    const dir = await seeded()
    const found = await queryMessages(dir, 'app-1', query({ limit: 2 }))
    expect(found.records).toHaveLength(2)
    expect(found.more).toBe(true)
    expect((await queryMessages(dir, 'app-1', query({ limit: 5 }))).more).toBe(false)
  })

  it('还没有目录时回空列表', async () => {
    await expect(queryMessages(path.join(tempDir(), 'missing'), 'app-1', query())).resolves.toEqual({ appId: 'app-1', records: [], more: false })
  })

  it('回执超过 MCP 单次 40000 字就报错，让调用方缩小范围，不截断', async () => {
    const dir = tempDir()
    const log = new MessageLog({ dir, appId: 'app-1', log: fakeLog() })
    for (let index = 0; index < 60; index++) log.inbound(message(`m${index}`, '字'.repeat(1000)), { route: 'group', group: '默认' })
    await log.settle()
    await expect(queryMessages(dir, 'app-1', query({ limit: 60 }))).rejects.toThrow('超过 MCP 单次 40000 字的上限：把 limit 改小（这次 60）')
    expect((await queryMessages(dir, 'app-1', query({ limit: 30 }))).records).toHaveLength(30)
  })

  it('记录文件里有不是 JSON 的行就报错指出哪一行', async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'messages-app-1-2026-10.jsonl'), '{"at":"2026-10-08T00:00:00Z","direction":"in","chat":"c2c:a"}\n{坏了\n')
    await expect(queryMessages(dir, 'app-1', query())).rejects.toThrow('messages-app-1-2026-10.jsonl 第 2 行不是 JSON')
  })
})

describe('参数', () => {
  it('都可选，limit 缺省 50；不认识的参数、类型不对、超出范围都报错', () => {
    expect(parseMessageQuery(undefined)).toEqual({ limit: 50 })
    expect(parseMessageQuery({ chat: 'c2c:a', group: '默认', round: 'r-1', direction: 'out', since: '2026-10-08', limit: 500 }))
      .toEqual({ chat: 'c2c:a', group: '默认', round: 'r-1', direction: 'out', since: '2026-10-08', limit: 500 })
    expect(() => parseMessageQuery({ chats: 'c2c:a' })).toThrow('不认识参数 chats')
    expect(() => parseMessageQuery('c2c:a')).toThrow('参数要是对象')
    expect(() => parseMessageQuery({ chat: '' })).toThrow('chat 要是非空字符串')
    expect(() => parseMessageQuery({ direction: 'both' })).toThrow('direction 只能是 in 或 out')
    expect(() => parseMessageQuery({ since: '昨天' })).toThrow('since 要是 ISO 时间')
    expect(() => parseMessageQuery({ limit: 0 })).toThrow('limit 要是 1–500 的整数')
    expect(() => parseMessageQuery({ limit: 501 })).toThrow('limit 要是 1–500 的整数')
    expect(() => parseMessageQuery({ limit: 1.5 })).toThrow('limit 要是 1–500 的整数')
  })
})
