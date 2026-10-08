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

/** 指令面板（/v2/panels）：只用单聊、指定用户、指令类条目 */
export const PANEL_SCOPE_C2C = 'c2c'
export const PANEL_TARGET_SPECIFIC = 'specific'
export const PANEL_ITEM_COMMAND = 'command'
/** 「指令面板操作进行中」：官方建议稍后重试 */
export const PANEL_ERROR_BUSY = 40030009

/** 面板里的一条；type 为 command 时点击后 name 填进输入框，不直接发送 */
export interface PanelItem {
  name: string
  desc: string
  type: string
}

export interface PanelRecord {
  panelId: string
  targetType: string
  remark: string
  items: PanelItem[]
}

export interface PanelPage {
  records: PanelRecord[]
  nextCursor: string
  isEnd: boolean
}

/** name、desc、type 官方标为可选，缺了按空串比较 */
function readPanelItem(raw: unknown): PanelItem | null {
  if (!isRecord(raw)) return null
  const name = raw['name'] ?? '', desc = raw['desc'] ?? '', type = raw['type'] ?? ''
  if (typeof name !== 'string' || typeof desc !== 'string' || typeof type !== 'string') return null
  return { name, desc, type }
}

function readPanelRecord(raw: unknown): PanelRecord | null {
  if (!isRecord(raw) || !isRecord(raw['panel'])) return null
  const panelId = raw['panel_id'], targetType = raw['target_type'], remark = raw['panel']['remark'] ?? '', rawItems = raw['panel']['items'] ?? []
  if (typeof panelId !== 'string' || typeof targetType !== 'string' || typeof remark !== 'string' || !Array.isArray(rawItems)) return null
  const items = rawItems.map(readPanelItem)
  if (items.some((item) => item === null)) return null
  return { panelId, targetType, remark, items: items as PanelItem[] }
}

/** GET /v2/panels 的回执；形状不对回 null，由调用方报错 */
export function readPanelPage(raw: unknown): PanelPage | null {
  if (!isRecord(raw)) return null
  // 实测：一个面板都没有时官方只回 {"is_end":true}，省略 records 与 next_cursor；缺省按空列表、空串是核对过的契约，不是放宽校验
  const rawRecords = raw['records'] ?? [], nextCursor = raw['next_cursor'] ?? '', isEnd = raw['is_end']
  if (!Array.isArray(rawRecords) || typeof nextCursor !== 'string' || typeof isEnd !== 'boolean') return null
  const records = rawRecords.map(readPanelRecord)
  if (records.some((record) => record === null)) return null
  return { records: records as PanelRecord[], nextCursor, isEnd }
}

/** GET /v2/panels/{panel_id} 回执里的 user_openids；列表为空时官方可能不带这个字段 */
export function readPanelOpenids(raw: unknown): string[] | null {
  if (!isRecord(raw)) return null
  const openids = raw['user_openids'] ?? []
  if (!Array.isArray(openids) || !openids.every((openid) => typeof openid === 'string')) return null
  return openids as string[]
}
