/** QQ 开放平台机器人 v2 API 的常量、事件解析与共用类型。字段名与位值照 2026-10 的官方文档，接口报错时先对官方文档核对再改这里 */

export type QqLog = {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** WebSocket 网关的 OP 码 */
export const OP_DISPATCH = 0
export const OP_HEARTBEAT = 1
export const OP_IDENTIFY = 2
export const OP_RESUME = 6
export const OP_RECONNECT = 7
export const OP_INVALID_SESSION = 9
export const OP_HELLO = 10
export const OP_HEARTBEAT_ACK = 11

/** 订阅的事件位：群 @ 消息（GROUP_AT_MESSAGES）与 C2C 单聊消息（C2C_DEFAULT_RELATIONSHIP） */
export const INTENT_GROUP_AT_MESSAGES = 1 << 0
export const INTENT_C2C_MESSAGES = 1 << 25

export function intentsNumber(): number {
  return INTENT_GROUP_AT_MESSAGES | INTENT_C2C_MESSAGES
}

export const EVENT_READY = 'READY'
export const EVENT_C2C_MESSAGE_CREATE = 'C2C_MESSAGE_CREATE'
export const EVENT_GROUP_AT_MESSAGE_CREATE = 'GROUP_AT_MESSAGE_CREATE'

export type MessageScene = 'c2c' | 'group'

/** 归一后的入站消息：senderOpenid 用于白名单与会话映射（按人），replyTarget 是回复地址（群聊是 group_openid） */
export interface IncomingMessage {
  scene: MessageScene
  msgId: string
  senderOpenid: string
  replyTarget: string
  content: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 系统边界：事件来自 QQ 网关，形状不对说明官方改了接口，记日志丢弃，不抛出打断连接 */
function readEventInto(raw: unknown, scene: MessageScene): IncomingMessage | null {
  if (!isRecord(raw)) return null
  const msgId = raw['id']
  const content = raw['content']
  const author = raw['author']
  if (typeof msgId !== 'string' || typeof content !== 'string' || !isRecord(author)) return null
  if (scene === 'c2c') {
    const openid = author['id']
    if (typeof openid !== 'string') return null
    return { scene, msgId, senderOpenid: openid, replyTarget: openid, content }
  }
  const groupOpenid = raw['group_openid']
  const memberOpenid = author['member_openid']
  if (typeof groupOpenid !== 'string' || typeof memberOpenid !== 'string') return null
  return { scene, msgId, senderOpenid: memberOpenid, replyTarget: groupOpenid, content }
}

export function readC2cMessageEvent(raw: unknown): IncomingMessage | null {
  return readEventInto(raw, 'c2c')
}

export function readGroupAtMessageEvent(raw: unknown): IncomingMessage | null {
  return readEventInto(raw, 'group')
}
