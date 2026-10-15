import { describe, expect, it } from 'vitest'
import { chooseSession, resolveIdleHours } from '../src/dispatch/group-session.js'
import { emptyGroupState, type GroupState } from '../src/storage/chat-table.js'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-08T12:00:00Z')
const SESSION = { workspace: 'D:\\work', id: 's-1', rounds: 2 }
const GROUP = { workspace: 'D:\\work' }

function stateWith(lastTaskAgo: number | null, session = SESSION): GroupState {
  return { ...emptyGroupState(), session, lastTaskAt: lastTaskAgo === null ? null : new Date(NOW - lastTaskAgo).toISOString() }
}

describe('chooseSession', () => {
  it('有会话、工作区没变、空闲没超过：接着用', () => {
    expect(chooseSession(stateWith(5 * HOUR), GROUP, NOW, 6)).toEqual({ kind: 'reuse', session: SESSION })
    expect(chooseSession(stateWith(null), GROUP, NOW, 6)).toEqual({ kind: 'reuse', session: SESSION })
  })

  it('没有会话、换了工作区：开新会话', () => {
    expect(chooseSession(emptyGroupState(), GROUP, NOW, 6)).toEqual({ kind: 'fresh' })
    expect(chooseSession(stateWith(HOUR), { workspace: 'D:\\other' }, NOW, 6)).toEqual({ kind: 'fresh' })
  })

  it('空闲超过 idleHours：开新会话，带上时长给回执', () => {
    expect(chooseSession(stateWith(7 * HOUR), GROUP, NOW, 6)).toEqual({ kind: 'idle', idleHours: 6 })
    expect(chooseSession(stateWith(6 * HOUR), GROUP, NOW, 6)).toEqual({ kind: 'reuse', session: SESSION })
  })
})

describe('resolveIdleHours', () => {
  it('组给了就用组的，没给用设置', () => {
    expect(resolveIdleHours(2, 6)).toBe(2)
    expect(resolveIdleHours(undefined, 6)).toBe(6)
    expect(resolveIdleHours(undefined, 0.5)).toBe(0.5)
  })

  it('设置不是正数时回原因，不替它改值', () => {
    expect(resolveIdleHours(undefined, 0)).toContain('设置 idle-hours 要是正数')
    expect(resolveIdleHours(undefined, -1)).toContain('现在是 -1')
    expect(resolveIdleHours(undefined, '6')).toContain('现在是 "6"')
    expect(resolveIdleHours(undefined, undefined)).toContain('设置 idle-hours 要是正数')
  })
})
