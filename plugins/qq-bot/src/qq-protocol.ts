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

/** 官方把单聊事件和群事件放在同一位 GROUP_AND_C2C_EVENT 里；本插件只处理单聊，群事件到了只记一行日志 */
export const INTENT_GROUP_AND_C2C_EVENT = 1 << 25

export function intentsNumber(): number {
  return INTENT_GROUP_AND_C2C_EVENT
}

export const EVENT_READY = 'READY'
export const EVENT_RESUMED = 'RESUMED'
export const EVENT_C2C_MESSAGE_CREATE = 'C2C_MESSAGE_CREATE'

/** 归一后的私聊消息：senderOpenid 既是白名单与本轮发言者，也是回复的对象 */
export interface IncomingMessage {
  msgId: string
  /** 入站投递序号，与 msgId 一起去重；和出站回复的 msg_seq 分别计数 */
  msgSeq?: number
  senderOpenid: string
  content: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 系统边界：事件来自 QQ 网关，形状不对说明官方改了接口，记日志丢弃，不抛出打断连接 */
export function readC2cMessageEvent(raw: unknown): IncomingMessage | null {
  if (!isRecord(raw)) return null
  const msgId = raw['id']
  const content = raw['content']
  const author = raw['author']
  if (typeof msgId !== 'string' || typeof content !== 'string' || !isRecord(author)) return null
  const rawSeq = raw['msg_seq']
  if (rawSeq !== undefined && (typeof rawSeq !== 'number' || !Number.isInteger(rawSeq))) return null
  const msgSeq = rawSeq as number | undefined
  const openid = author['id']
  if (typeof openid !== 'string') return null
  return { msgId, msgSeq, senderOpenid: openid, content }
}
