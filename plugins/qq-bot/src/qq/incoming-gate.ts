/** 入站私聊的两道关：白名单（名单外静默拒绝，只记日志与 recentRejected）与按消息 id 去重（网关重推不重复处理） */
import type { Chat, ChatTable } from '../storage/chat-table.js'
import type { IncomingMessage, QqLog } from './qq-protocol.js'

const REJECTED_LIMIT = 10

export class AllowedSenderGate {
  readonly recentRejected: { openid: string; at: string; excerpt: string }[] = []

  constructor(private readonly deps: { allowedOpenids(): string[]; log: QqLog }) {}

  /** 发言人在白名单里回 true；不在就记下 openid、回 false，绝不回消息 */
  admit(message: IncomingMessage): boolean {
    if (this.deps.allowedOpenids().includes(message.senderOpenid)) return true
    this.recentRejected.push({ openid: message.senderOpenid, at: new Date().toISOString(), excerpt: message.content.slice(0, 40) })
    if (this.recentRejected.length > REJECTED_LIMIT) this.recentRejected.shift()
    this.deps.log.info(`拒绝白名单外的私聊消息，openid=${message.senderOpenid}`)
    return false
  }
}

/**
 * 在聊天表的串行队列里收下一条私聊：没有这个聊天就建一行；这条消息处理过就只存盘、回 null，
 * 第一次见到才在同一步里交给 onFirstDelivery 改表，存盘后回它的结果
 */
export function intakeFirstDelivery<T>(table: ChatTable, message: IncomingMessage, onFirstDelivery: (chat: Chat) => T): Promise<T | null> {
  return table.serial(async () => {
    const chat = table.observe(message.senderOpenid)
    if (!table.firstSeen(chat.id, message.msgId)) { await table.save(); return null }
    const intake = onFirstDelivery(chat)
    await table.save()
    return intake
  })
}
