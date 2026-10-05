/** 回复发往哪条路：被动窗口与次数是 QQ 官方的硬限制（群 5 分钟 / 单聊 60 分钟，超了按主动消息的频控与配额算），纯函数，测试在 tests/reply-window.test.ts */

import type { MessageScene } from './qq-protocol.js'

export const C2C_PASSIVE_WINDOW_MS = 60 * 60 * 1000
export const GROUP_PASSIVE_WINDOW_MS = 5 * 60 * 1000
export const C2C_MAX_PASSIVE_REPLIES = 4
export const GROUP_MAX_PASSIVE_REPLIES = 5

export type ReplyExhaustReason = 'no-trigger' | 'window-elapsed' | 'replies-used-up'

export type ReplyRoute =
  | { kind: 'passive'; msgId: string; msgSeq: number }
  | { kind: 'active'; reason: ReplyExhaustReason }
  | { kind: 'none'; reason: ReplyExhaustReason }

/** 一轮任务的回复依据：触发那条消息的 msgId、收到时间、已用它被动回过几条 */
export interface ReplyTrigger {
  msgId: string
  receivedAt: number
  repliesSent: number
}

export function chooseReplyRoute(scene: MessageScene, trigger: ReplyTrigger | null, now: number): ReplyRoute {
  if (trigger === null) {
    // 群聊只做被动回复，没有触发消息就等用户来 /状态 查。
    return scene === 'c2c' ? { kind: 'active', reason: 'no-trigger' } : { kind: 'none', reason: 'no-trigger' }
  }
  const windowMs = scene === 'c2c' ? C2C_PASSIVE_WINDOW_MS : GROUP_PASSIVE_WINDOW_MS
  const maxReplies = scene === 'c2c' ? C2C_MAX_PASSIVE_REPLIES : GROUP_MAX_PASSIVE_REPLIES
  const exhausted: ReplyExhaustReason | null = now - trigger.receivedAt > windowMs ? 'window-elapsed' : trigger.repliesSent >= maxReplies ? 'replies-used-up' : null
  if (exhausted === null) return { kind: 'passive', msgId: trigger.msgId, msgSeq: trigger.repliesSent + 1 }
  // 群聊被动窗口过期不再推，把结果留着等 /状态。
  return scene === 'c2c' ? { kind: 'active', reason: exhausted } : { kind: 'none', reason: exhausted }
}
