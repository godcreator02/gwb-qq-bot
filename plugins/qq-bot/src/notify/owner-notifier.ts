/** 主动私聊主人的通知：服务 gwbQqBot.notify 与命令 qq-bot.notify 的实现，按通知 id 去重，去重记录存在共用的聊天表里 */
import type { QqLog } from '../qq/qq-protocol.js'
import type { SendC2c } from '../qq/reply-sender.js'
import type { ChatTable } from '../storage/chat-table.js'

const NOTICE_MAX_CHARS = 600

export interface OwnerNotifierDeps {
  table: ChatTable
  allowedOpenids(): string[]
  ownerOpenid(): string
  sendC2c: SendC2c
  log: QqLog
}

export class OwnerNotifier {
  constructor(private readonly deps: OwnerNotifierDeps) {}

  /** 主动私聊主人；同一个 id 只发一次，发不出去不重发 */
  async notify(id: string, text: string): Promise<{ delivered: boolean; duplicate: boolean }> {
    const table = this.deps.table
    if (id.trim() === '' || text.trim() === '' || text.length > NOTICE_MAX_CHARS) throw new Error(`notify 要非空的 id 与 1–${NOTICE_MAX_CHARS} 字的正文`)
    const owner = this.deps.ownerOpenid()
    if (owner === '' || !this.deps.allowedOpenids().includes(owner)) throw new Error('请先配置主人私聊 owner-openid，并把它加进 allowed-openids')
    const fresh = await table.serial(async () => {
      const existing = table.book.notices.find((notice) => notice.id === id)
      if (existing !== undefined) {
        if (existing.text !== text) throw new Error(`通知 id ${id} 已经用于另一段内容`)
        return { duplicate: true, delivered: existing.delivered }
      }
      table.book.notices.push({ id, text, delivered: false })
      await table.save()
      return null
    })
    if (fresh !== null) return fresh
    let delivered = false
    try { delivered = (await this.deps.sendC2c(owner, text, undefined, undefined, undefined)).ok }
    catch (error) { this.deps.log.warn(`通知 ${id} 发送失败：${String(error)}`) }
    if (delivered) {
      await table.serial(async () => {
        const notice = table.book.notices.find((each) => each.id === id)
        if (notice !== undefined) { notice.delivered = true; await table.save() }
      })
    }
    return { delivered, duplicate: false }
  }
}
