import { describe, expect, it } from 'vitest'
import { C2C_PASSIVE_WINDOW_MS, chooseReplyRoute } from '../src/reply-window.js'

const NOW = 1_700_000_000_000

describe('chooseReplyRoute', () => {
  it('窗口内且次数没用完：走被动，msgSeq 从 1 起', () => {
    const trigger = { msgId: 'msg-1', receivedAt: NOW, repliesSent: 0 }
    expect(chooseReplyRoute(trigger, NOW + 1_000)).toEqual({ kind: 'passive', msgId: 'msg-1', msgSeq: 1 })
  })

  it('次数随 repliesSent 递增', () => {
    const trigger = { msgId: 'msg-1', receivedAt: NOW, repliesSent: 2 }
    expect(chooseReplyRoute(trigger, NOW + 1_000)).toEqual({ kind: 'passive', msgId: 'msg-1', msgSeq: 3 })
  })

  it('过 60 分钟窗口：降级主动', () => {
    const trigger = { msgId: 'msg-1', receivedAt: NOW, repliesSent: 0 }
    expect(chooseReplyRoute(trigger, NOW + C2C_PASSIVE_WINDOW_MS + 1)).toEqual({ kind: 'active', reason: 'window-elapsed' })
  })

  it('被动次数用完：降级主动', () => {
    const trigger = { msgId: 'msg-c', receivedAt: NOW, repliesSent: 4 }
    expect(chooseReplyRoute(trigger, NOW + 1_000)).toEqual({ kind: 'active', reason: 'replies-used-up' })
  })

  it('没有触发消息：走主动', () => {
    expect(chooseReplyRoute(null, NOW)).toEqual({ kind: 'active', reason: 'no-trigger' })
  })
})
