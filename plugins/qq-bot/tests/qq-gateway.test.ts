import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QqGateway } from '../src/qq-gateway.js'
import type { QqRestClient } from '../src/qq-rest.js'

class Socket extends EventTarget {
  static instances: Socket[] = []
  sent: { op: number; d: Record<string, unknown> }[] = []
  closed = false
  constructor() { super(); Socket.instances.push(this) }
  send(raw: string): void { this.sent.push(JSON.parse(raw) as { op: number; d: Record<string, unknown> }) }
  close(): void { this.closed = true; this.dispatchEvent(new Event('close')) }
  receive(frame: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) })) }
}

const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const hello = { op: 10, d: { heartbeat_interval: 45_000 } }
const ready = { op: 0, t: 'READY', d: { session_id: 'session' }, s: 1 }
const group = (msgSeq = 1): unknown => ({ op: 0, t: 'GROUP_AT_MESSAGE_CREATE', s: 2,
  d: { id: 'incoming', msg_seq: msgSeq, content: ' /帮助 ', group_openid: 'group', author: { member_openid: 'member' } } })

beforeEach(() => { vi.useFakeTimers(); Socket.instances = []; vi.stubGlobal('WebSocket', Socket) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

function setup() {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const events = { onMessage: vi.fn(), onState: vi.fn() }
  const rest = { getAccessToken: vi.fn(async () => 'fake'), fetchGatewayUrl: vi.fn(async () => 'wss://test.invalid'), fetchGroupSelfId: vi.fn(async () => 'self') }
  const gateway = new QqGateway(rest as unknown as QqRestClient, log, events)
  return { gateway, rest, log, events }
}

describe('QQ 网关生命周期与群事件', () => {
  it('仅 @ 事件的机器人正文仍带显示前缀时，按 READY 自己的名字去掉', async () => {
    const { gateway, events } = setup()
    gateway.start(); await flush()
    const socket = Socket.instances[0]!
    socket.receive(hello); socket.receive({ ...ready, d: { session_id: 'session', user: { username: 'zcode2号' } } })
    socket.receive({ op: 0, t: 'GROUP_AT_MESSAGE_CREATE', d: { id: 'peer-at', group_openid: 'group', author: { member_openid: 'peer', bot: true }, content: '[@zcode2号] 只回复收到' } })
    expect(events.onMessage).toHaveBeenCalledWith(expect.objectContaining({ content: '只回复收到', senderIsBot: true }))
    gateway.stop()
  })
  it('全量群消息只派发 mentions 中确实有自己的消息，剥掉平台显示前缀', async () => {
    const { gateway, events, rest } = setup()
    gateway.start(); await flush()
    const socket = Socket.instances[0]!
    socket.receive(hello); socket.receive(ready)
    const raw = { id: 'full', content: '[@本机器人] /任务 只回复收到', group_openid: 'group', author: { member_openid: 'peer', bot: true } }
    socket.receive({ op: 0, t: 'GROUP_MESSAGE_CREATE', d: raw })
    socket.receive({ op: 0, t: 'GROUP_MESSAGE_CREATE', d: { ...raw, mentions: [{ member_openid: 'other', username: '别人' }] } })
    await flush()
    expect(events.onMessage).not.toHaveBeenCalled()
    socket.receive({ op: 0, t: 'GROUP_MESSAGE_CREATE', d: { ...raw, mentions: [{ member_openid: 'self', username: '本机器人' }] } })
    await flush()
    expect(events.onMessage).toHaveBeenCalledTimes(1)
    expect(events.onMessage).toHaveBeenCalledWith(expect.objectContaining({ content: '/任务 只回复收到', senderIsBot: true }))
    expect(rest.fetchGroupSelfId).toHaveBeenCalledTimes(1)
    gateway.stop()
  })

  it('全量与 @ 事件重复到达只处理一次，查询自己 ID 期间 stop 不派发', async () => {
    const { gateway, events, rest } = setup()
    gateway.start(); await flush()
    const socket = Socket.instances[0]!
    socket.receive(hello); socket.receive(ready)
    const raw = { id: 'incoming', msg_seq: 1, content: '/帮助', group_openid: 'group', author: { member_openid: 'member' }, mentions: [{ id: 'self' }] }
    socket.receive({ op: 0, t: 'GROUP_MESSAGE_CREATE', d: raw })
    socket.receive(group())
    await flush()
    expect(events.onMessage).toHaveBeenCalledTimes(1)
    gateway.stop(); gateway.start(); await flush()
    let finish!: (value: string) => void
    rest.fetchGroupSelfId.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    Socket.instances[1]!.receive({ op: 0, t: 'GROUP_MESSAGE_CREATE', d: { ...raw, id: 'late' } })
    gateway.stop(); finish('self'); await flush()
    expect(events.onMessage).toHaveBeenCalledTimes(1)
  })

  it('退避期间停止，不再重连', async () => {
    const { gateway } = setup()
    gateway.start(); await flush()
    Socket.instances[0]!.close(); await flush()
    gateway.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(Socket.instances).toHaveLength(1)
  })

  it('格式错误的群事件只记录类型，不泄露载荷里的 auth_token', async () => {
    const { gateway, log, events } = setup()
    gateway.start(); await flush()
    const socket = Socket.instances[0]!
    socket.receive(hello); socket.receive(ready)
    socket.receive({ op: 0, t: 'GROUP_AT_MESSAGE_CREATE', d: { message_scene: { ext: ['auth_token=private-value'] } } })
    expect(events.onMessage).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('事件形状不对'))
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('private-value')
    gateway.stop()
  })
  it('Identify 只订阅 GROUP_AND_C2C_EVENT，群消息进入回调并有入站日志', async () => {
    const { gateway, events, log } = setup()
    gateway.start(); await flush()
    const socket = Socket.instances[0]!
    socket.receive(hello); socket.receive(ready); socket.receive(group())
    expect(socket.sent[0]?.d['intents']).toBe(1 << 25)
    expect(events.onMessage).toHaveBeenCalledWith(expect.objectContaining({ scene: 'group', content: ' /帮助 ', senderOpenid: 'member' }))
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('GROUP_AT_MESSAGE_CREATE'))
    gateway.stop()
  })

  it('stop 关闭旧连接和心跳，重启只处理新连接的事件', async () => {
    const { gateway, events } = setup()
    gateway.start(); await flush()
    const old = Socket.instances[0]!
    old.receive(hello); old.receive(ready)
    gateway.stop()
    expect(old.closed).toBe(true)
    gateway.start(); await flush()
    const next = Socket.instances[1]!
    next.receive(hello); next.receive(ready)
    old.receive(group()); next.receive(group())
    expect(events.onMessage).toHaveBeenCalledTimes(1)
    expect(next.sent[0]?.op).toBe(2)
    gateway.stop()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(Socket.instances).toHaveLength(2)
    expect(old.sent).toHaveLength(1)
  })

  it('鉴权请求未完成时 stop，旧请求完成后不能再开连接', async () => {
    const { gateway, rest } = setup()
    let finish!: (value: string) => void
    rest.getAccessToken.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    gateway.start(); gateway.stop(); gateway.start(); await flush()
    finish('late'); await flush()
    expect(Socket.instances).toHaveLength(1)
    gateway.stop()
  })

  it('断线恢复收到 RESUMED 后状态重新变成 open', async () => {
    const { gateway } = setup()
    gateway.start(); await flush()
    Socket.instances[0]!.receive(hello); Socket.instances[0]!.receive(ready)
    Socket.instances[0]!.close(); await flush()
    await vi.advanceTimersByTimeAsync(1_000)
    const next = Socket.instances[1]!
    next.receive(hello)
    expect(next.sent[0]?.op).toBe(6)
    next.receive({ op: 0, t: 'RESUMED', s: 3, d: '' })
    expect(gateway.currentState).toBe('open')
    gateway.stop()
  })

  it('重复投递只处理一次，同 msg_id 不同 msg_seq 分别处理', async () => {
    const { gateway, events } = setup()
    gateway.start(); await flush()
    const socket = Socket.instances[0]!
    socket.receive(hello); socket.receive(ready)
    socket.receive(group(1)); socket.receive(group(1)); socket.receive(group(2))
    expect(events.onMessage).toHaveBeenCalledTimes(2)
    gateway.stop()
  })
})
