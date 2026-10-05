import { describe, expect, it } from 'vitest'
import { C2C_PASSIVE_WINDOW_MS, GROUP_PASSIVE_WINDOW_MS, chooseReplyRoute } from '../src/reply-window.js'

const NOW = 1_700_000_000_000

describe('chooseReplyRoute', () => {
  it('窗口内且次数没用完：走被动，msgSeq 从 0 起', () => {
    const trigger = { msgId: 'msg-1', receivedAt: NOW, repliesSent: 0 }
    expect(chooseReplyRoute('c2c', trigger, NOW + 1_000)).toEqual({ kind: 'passive', msgId: 'msg-1', msgSeq: 0 })
    expect(chooseReplyRoute('group', trigger, NOW + 1_000)).toEqual({ kind: 'passive', msgId: 'msg-1', msgSeq: 0 })
  })

  it('次数随 repliesSent 递增', () => {
    const trigger = { msgId: 'msg-1', receivedAt: NOW, repliesSent: 2 }
    expect(chooseReplyRoute('c2c', trigger, NOW + 1_000)).toEqual({ kind: 'passive', msgId: 'msg-1', msgSeq: 2 })
  })

  it('群聊过 5 分钟窗口：不再推（结果留着等 /状态）', () => {
    const trigger = { msgId: 'msg-1', receivedAt: NOW, repliesSent: 0 }
    expect(chooseReplyRoute('group', trigger, NOW + GROUP_PASSIVE_WINDOW_MS + 1)).toEqual({ kind: 'none', reason: 'window-elapsed' })
  })

  it('单聊过 60 分钟窗口：降级主动', () => {
    const trigger = { msgId: 'msg-1', receivedAt: NOW, repliesSent: 0 }
    expect(chooseReplyRoute('c2c', trigger, NOW + C2C_PASSIVE_WINDOW_MS + 1)).toEqual({ kind: 'active', reason: 'window-elapsed' })
  })

  it('被动次数用完：群聊不推、单聊降级主动', () => {
    const groupTrigger = { msgId: 'msg-g', receivedAt: NOW, repliesSent: 5 }
    expect(chooseReplyRoute('group', groupTrigger, NOW + 1_000)).toEqual({ kind: 'none', reason: 'replies-used-up' })
    const c2cTrigger = { msgId: 'msg-c', receivedAt: NOW, repliesSent: 4 }
    expect(chooseReplyRoute('c2c', c2cTrigger, NOW + 1_000)).toEqual({ kind: 'active', reason: 'replies-used-up' })
  })

  it('没有触发消息：单聊走主动，群聊不推', () => {
    expect(chooseReplyRoute('c2c', null, NOW)).toEqual({ kind: 'active', reason: 'no-trigger' })
    expect(chooseReplyRoute('group', null, NOW)).toEqual({ kind: 'none', reason: 'no-trigger' })
  })
})
