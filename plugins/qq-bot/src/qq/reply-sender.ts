/** 给一个私聊发一段话：按回复窗口选被动或主动、长的分段、每段引用一条消息。被动回复用掉的次数记在共用的聊天表里 */
import type { ChatTable, Trigger } from '../storage/chat-table.js'
import type { OutboundPurpose, SendC2c, SendPurpose } from './message-log.js'
import type { QqLog } from './qq-protocol.js'
import { chooseReplyRoute } from './reply-window.js'

/** 实测 5000 字的 markdown 一条完整显示；在代码块中间切开会坏掉渲染，所以段要尽量长 */
const SEGMENT_CHARS = 5000

/**
 * 把长回复切成能逐条发送的段：按行累积，放不下就出一段；单行超长才按字符硬切。
 * 多段时每段开头加 (i/n) 标记
 */
export function splitForSend(text: string, maxLen: number): string[] {
  const segments: string[] = []
  let current = ''
  const flush = (): void => {
    if (current !== '') {
      segments.push(current)
      current = ''
    }
  }
  for (const line of text.split('\n')) {
    if (line.length > maxLen) {
      flush()
      for (let start = 0; start < line.length; start += maxLen) {
        segments.push(line.slice(start, start + maxLen))
      }
      continue
    }
    const candidate = current === '' ? line : `${current}\n${line}`
    if (candidate.length > maxLen) {
      flush()
      current = line
    } else {
      current = candidate
    }
  }
  flush()
  if (segments.length <= 1) return segments
  return segments.map((segment, index) => `(${index + 1}/${segments.length}) ${segment}`)
}

export class ReplySender {
  constructor(private readonly deps: { table: ChatTable; sendC2c: SendC2c; log: QqLog }) {}

  /**
   * 按回复窗口给 target（对方 openid）发一段话（长的分段），每段都引用 quote 那条消息（缺省是触发消息）；都发出去回 true。
   * 被动回复用掉的次数先记进聊天表再发，msg_seq 不会重复；被动发不出去改发主动消息。purpose 原样交给消息记录，每段标第几段
   */
  async reply(target: string, trigger: Trigger, text: string, purpose: OutboundPurpose, quote = trigger.msgId): Promise<boolean> {
    const table = this.deps.table
    const segments = splitForSend(text, SEGMENT_CHARS)
    for (const [index, segment] of segments.entries()) {
      const segmentPurpose: SendPurpose = { ...purpose, segment: { index: index + 1, total: segments.length } }
      const route = await table.serial(async () => {
        const chosen = chooseReplyRoute({ ...trigger, repliesSent: table.repliesUsed(trigger.msgId) }, Date.now())
        if (chosen.kind === 'passive') { table.takeReply(trigger.msgId); await table.save() }
        return chosen
      })
      if (route.kind === 'passive' && (await this.send(target, segment, route.msgId, route.msgSeq, quote, segmentPurpose))) continue
      if (!(await this.send(target, segment, undefined, undefined, quote, segmentPurpose))) return false
    }
    return true
  }

  private async send(target: string, content: string, msgId: string | undefined, msgSeq: number | undefined, quote: string | undefined, purpose: SendPurpose): Promise<boolean> {
    try {
      const outcome = await this.deps.sendC2c(target, content, msgId, msgSeq, quote, purpose)
      return outcome.ok
    } catch (error) {
      this.deps.log.warn(`发 QQ 消息失败：${String(error)}`)
      return false
    }
  }
}
