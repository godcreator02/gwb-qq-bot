/** WebSocket 网关客户端：出站长连接、鉴权（Identify / Resume）、心跳、断线退避重连，把消息事件交给回调 */

import { platform } from 'node:process'

import {
  EVENT_C2C_MESSAGE_CREATE,
  EVENT_GROUP_AT_MESSAGE_CREATE,
  EVENT_READY,
  OP_DISPATCH,
  OP_HEARTBEAT,
  OP_HEARTBEAT_ACK,
  OP_HELLO,
  OP_IDENTIFY,
  OP_INVALID_SESSION,
  OP_RECONNECT,
  OP_RESUME,
  intentsNumber,
  isRecord,
  readC2cMessageEvent,
  readGroupAtMessageEvent,
  type IncomingMessage,
  type QqLog,
} from './qq-protocol.js'
import type { QqRestClient } from './qq-rest.js'

export type GatewayState = 'stopped' | 'connecting' | 'open'

export interface GatewayEvents {
  onMessage(message: IncomingMessage): void
  onState(state: GatewayState, detail?: string): void
}

/** 重连退避：1 秒起步、翻倍、封顶 60 秒；收到 READY 后归零 */
const BACKOFF_START_MS = 1_000
const BACKOFF_CAP_MS = 60_000

/** 网关 10 秒内不发 Hello 就放弃这一条连接 */
const HELLO_TIMEOUT_MS = 10_000

/** 事件按 msg_id 去重：官方会重复推送同一条消息 */
const SEEN_MESSAGE_LIMIT = 1000

export class QqGateway {
  private stopped = true
  private state: GatewayState = 'stopped'
  private sessionId: string | null = null
  private lastSeq: number | null = null
  private seenMessageIds = new Set<string>()
  private backoffMs = BACKOFF_START_MS

  constructor(
    private readonly rest: QqRestClient,
    private readonly log: QqLog,
    private readonly events: GatewayEvents,
  ) {}

  get currentState(): GatewayState {
    return this.state
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.connectLoop()
  }

  stop(): void {
    this.stopped = true
    this.setState('stopped')
  }

  private setState(state: GatewayState, detail?: string): void {
    this.state = state
    this.events.onState(state, detail)
  }

  private async connectLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.runSession()
      } catch (error) {
        if (this.stopped) return
        this.log.warn(`网关连接结束：${String(error)}；${this.backoffMs} 毫秒后重连`)
      }
      if (this.stopped) return
      this.setState('connecting', `${this.backoffMs} 毫秒后重连`)
      await sleep(this.backoffMs)
      this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_CAP_MS)
    }
  }

  /** 一次连接的完整生命周期：从打开到关闭。中途一切要放弃的原因都走 reject，由 connectLoop 退避重连 */
  private async runSession(): Promise<void> {
    if (typeof WebSocket !== 'function') throw new Error('运行时没有全局 WebSocket（需要 Node 22 级别的运行时）')
    const token = await this.rest.getAccessToken()
    const gatewayUrl = await this.rest.fetchGatewayUrl()
    this.setState('connecting', gatewayUrl)

    return await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(gatewayUrl)
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null
      let awaitingHeartbeatAck = false
      let readySeen = false

      const helloTimeout = setTimeout(() => giveUp('网关 10 秒内没发 Hello'), HELLO_TIMEOUT_MS)

      function clearHeartbeat(): void {
        if (heartbeatTimer !== null) clearInterval(heartbeatTimer)
      }

      function giveUp(reason: string): void {
        clearTimeout(helloTimeout)
        clearHeartbeat()
        try {
          socket.close()
        } catch {
          // 已经关了
        }
        reject(new Error(reason))
      }

      socket.addEventListener('error', () => giveUp('WebSocket 出错'))
      socket.addEventListener('close', () => {
        clearTimeout(helloTimeout)
        clearHeartbeat()
        reject(new Error(readySeen ? '连接被关闭' : '连接在 READY 前被关闭'))
      })
      socket.addEventListener('message', (event) => {
        const frame = parseGatewayFrame(event.data)
        if (frame === null) return
        if (typeof frame.s === 'number') this.lastSeq = frame.s

        if (frame.op === OP_HELLO) {
          clearTimeout(helloTimeout)
          const intervalMs = isRecord(frame.d) && typeof frame.d['heartbeat_interval'] === 'number' ? frame.d['heartbeat_interval'] : 30_000
          heartbeatTimer = setInterval(() => {
            if (awaitingHeartbeatAck) {
              giveUp('两次心跳间隔没收到 ACK')
              return
            }
            awaitingHeartbeatAck = true
            socket.send(JSON.stringify({ op: OP_HEARTBEAT, d: this.lastSeq }))
          }, intervalMs)
          const auth =
            this.sessionId === null
              ? {
                  op: OP_IDENTIFY,
                  d: {
                    token: `QQBot ${token}`,
                    intents: intentsNumber(),
                    shard: [0, 1],
                    properties: { $os: platform, $browser: 'gwb-qq-bot', $device: 'gwb-qq-bot' },
                  },
                }
              : { op: OP_RESUME, d: { token: `QQBot ${token}`, session_id: this.sessionId, seq: this.lastSeq } }
          socket.send(JSON.stringify(auth))
        } else if (frame.op === OP_HEARTBEAT_ACK) {
          awaitingHeartbeatAck = false
        } else if (frame.op === OP_RECONNECT) {
          giveUp('网关要求重连')
        } else if (frame.op === OP_INVALID_SESSION) {
          this.sessionId = null
          this.lastSeq = null
          giveUp('网关判定会话无效，清掉后重新 Identify')
        } else if (frame.op === OP_DISPATCH) {
          if (frame.t === EVENT_READY) {
            this.sessionId = isRecord(frame.d) && typeof frame.d['session_id'] === 'string' ? frame.d['session_id'] : null
            if (this.sessionId === null) {
              giveUp('READY 事件缺 session_id')
              return
            }
            this.backoffMs = BACKOFF_START_MS
            readySeen = true
            this.setState('open', this.sessionId)
          } else if (frame.t === EVENT_C2C_MESSAGE_CREATE || frame.t === EVENT_GROUP_AT_MESSAGE_CREATE) {
            const message = frame.t === EVENT_C2C_MESSAGE_CREATE ? readC2cMessageEvent(frame.d) : readGroupAtMessageEvent(frame.d)
            if (message === null) {
              this.log.warn(`${frame.t} 事件形状不对，丢弃：${JSON.stringify(frame.d)}`)
              return
            }
            if (this.seenMessageIds.has(message.msgId)) return
            this.seenMessageIds.add(message.msgId)
            if (this.seenMessageIds.size > SEEN_MESSAGE_LIMIT) this.seenMessageIds.clear()
            this.events.onMessage(message)
          }
        }
      })
    })
  }
}

interface GatewayFrame {
  op: number
  d: unknown
  t?: unknown
  s?: unknown
}

function parseGatewayFrame(data: unknown): GatewayFrame | null {
  if (typeof data !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (!isRecord(parsed) || typeof parsed['op'] !== 'number') return null
  return { op: parsed['op'], d: parsed['d'], t: parsed['t'], s: parsed['s'] }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
