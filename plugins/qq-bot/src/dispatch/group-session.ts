/** 一个组的下一轮接着用哪个会话、空闲时长怎么取——纯函数，测试在 tests/group-session.test.ts */
import type { GroupSession, GroupState } from '../storage/chat-table.js'

const HOUR_MS = 60 * 60 * 1000

export type SessionChoice =
  /** 接着用这个会话 */
  | { kind: 'reuse'; session: GroupSession }
  /** 开新会话：没有会话（还没做过、/新会话 清掉了）、或执行端与工作区变了 */
  | { kind: 'fresh' }
  /** 开新会话：这一组空闲超过 idleHours 小时，回执里写明 */
  | { kind: 'idle'; idleHours: number }

/** 下一轮的会话：有会话、执行端与工作区没变、空闲没超过 idleHours 就接着用 */
export function chooseSession(state: GroupState, group: { agent: string; workspace: string }, now: number, idleHours: number): SessionChoice {
  const session = state.session
  if (session === null || session.agent !== group.agent || session.workspace !== group.workspace) return { kind: 'fresh' }
  if (state.lastTaskAt !== null && now - Date.parse(state.lastTaskAt) > idleHours * HOUR_MS) return { kind: 'idle', idleHours }
  return { kind: 'reuse', session }
}

/**
 * 这一组的空闲时长：组自己给了就用组的（注册时已校验为正数），否则用设置 idle-hours。
 * 设置值不是正数回报错的原因，不替它改值
 */
export function resolveIdleHours(groupIdleHours: number | undefined, settingValue: unknown): number | string {
  if (groupIdleHours !== undefined) return groupIdleHours
  if (typeof settingValue !== 'number' || !Number.isFinite(settingValue) || settingValue <= 0) {
    return `设置 idle-hours 要是正数（小时），现在是 ${JSON.stringify(settingValue)}：到设置的 qq-bot 分区改好再发`
  }
  return settingValue
}
