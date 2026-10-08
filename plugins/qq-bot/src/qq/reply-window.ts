/** 私聊回复发往哪条路：被动窗口与次数是 QQ 官方的硬限制（单聊 60 分钟、每条 4 次，超了按主动消息的频控与配额算），纯函数，测试在 tests/reply-window.test.ts */

export const C2C_PASSIVE_WINDOW_MS = 60 * 60 * 1000
export const C2C_MAX_PASSIVE_REPLIES = 4

export type ReplyExhaustReason = 'no-trigger' | 'window-elapsed' | 'replies-used-up'

export type ReplyRoute =
  | { kind: 'passive'; msgId: string; msgSeq: number }
  | { kind: 'active'; reason: ReplyExhaustReason }

/** 一轮任务的回复依据：触发那条消息的 msgId、收到时间、已用它被动回过几条 */
export interface ReplyTrigger {
  msgId: string
  receivedAt: number
  repliesSent: number
}

export function chooseReplyRoute(trigger: ReplyTrigger | null, now: number): ReplyRoute {
  if (trigger === null) return { kind: 'active', reason: 'no-trigger' }
  const exhausted: ReplyExhaustReason | null =
    now - trigger.receivedAt > C2C_PASSIVE_WINDOW_MS ? 'window-elapsed' : trigger.repliesSent >= C2C_MAX_PASSIVE_REPLIES ? 'replies-used-up' : null
  if (exhausted === null) return { kind: 'passive', msgId: trigger.msgId, msgSeq: trigger.repliesSent + 1 }
  return { kind: 'active', reason: exhausted }
}
