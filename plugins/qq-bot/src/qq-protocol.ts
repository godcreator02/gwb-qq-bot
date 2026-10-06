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

/** 官方 GROUP_AND_C2C_EVENT：群 @、单聊及群/好友关系事件共用这一位 */
export const INTENT_GROUP_AND_C2C_EVENT = 1 << 25

export function intentsNumber(): number {
  return INTENT_GROUP_AND_C2C_EVENT
}

export const EVENT_READY = 'READY'
export const EVENT_RESUMED = 'RESUMED'
export const EVENT_C2C_MESSAGE_CREATE = 'C2C_MESSAGE_CREATE'
export const EVENT_GROUP_AT_MESSAGE_CREATE = 'GROUP_AT_MESSAGE_CREATE'
export const EVENT_GROUP_MESSAGE_CREATE = 'GROUP_MESSAGE_CREATE'

export type MessageScene = 'c2c' | 'group'

/** 归一后的入站消息：senderOpenid 用于白名单与本轮发言者，scene + replyTarget 标识聊天来源（群聊是 group_openid） */
export interface IncomingMessage {
  scene: MessageScene
  msgId: string
  /** 入站投递序号，与 msgId 一起去重；和出站回复的 msg_seq 分别计数 */
  msgSeq?: number
  senderOpenid: string
  replyTarget: string
  content: string
  /** 平台声明的机器人发送者，用于区分任务与机器人回执。 */
  senderIsBot?: boolean
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
  const rawSeq = raw['msg_seq']
  if (rawSeq !== undefined && (typeof rawSeq !== 'number' || !Number.isInteger(rawSeq))) return null
  const msgSeq = rawSeq as number | undefined
  if (scene === 'c2c') {
    const openid = author['id']
    if (typeof openid !== 'string') return null
    return { scene, msgId, msgSeq, senderOpenid: openid, replyTarget: openid, content }
  }
  const groupOpenid = raw['group_openid']
  const memberOpenid = author['member_openid']
  if (typeof groupOpenid !== 'string' || typeof memberOpenid !== 'string') return null
  return { scene, msgId, msgSeq, senderOpenid: memberOpenid, replyTarget: groupOpenid, content, ...(author['bot'] === true ? { senderIsBot: true } : {}) }
}

export function readC2cMessageEvent(raw: unknown): IncomingMessage | null {
  return readEventInto(raw, 'c2c')
}

export function readGroupAtMessageEvent(raw: unknown, selfName?: string): IncomingMessage | null {
  const message = readEventInto(raw, 'group')
  if (message !== null && selfName !== undefined) stripSelfMention(message, selfName)
  return message
}

/** 全量事件不保证 @ 了自己；只信结构化 mentions，不能匹配正文昵称来决定执行。 */
export function readMentionedGroupMessageEvent(raw: unknown, selfId: string): IncomingMessage | null {
  const message = readEventInto(raw, 'group')
  if (message === null || !isRecord(raw) || !Array.isArray(raw['mentions'])) return null
  const self = raw['mentions'].find((entry: unknown) => isRecord(entry) && (entry['member_openid'] === selfId || entry['id'] === selfId)) as Record<string, unknown> | undefined
  if (self === undefined) return null
  if (typeof self['username'] === 'string') stripSelfMention(message, self['username'])
  return message
}

function stripSelfMention(message: IncomingMessage, name: string): void {
  const prefix = `[@${name}]`
  const text = message.content.trimStart()
  if (text.startsWith(prefix)) message.content = text.slice(prefix.length).trimStart()
}
