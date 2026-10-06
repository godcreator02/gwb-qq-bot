/** QQ 投递侧：结果与回执按被动回复窗口的规则发回 QQ；群聊过窗不硬推，单聊主动兜底一次。 */
import type { Job, Route } from './conversations.js'
import type { SendOutcome } from './qq-rest.js'
import { chooseReplyRoute } from './reply-window.js'
import { splitForSend, tailExcerpt } from './routing.js'

export interface QqChannelDeps {
  home: string
  appId(): string
  sendC2c(openid: string, content: string, msgId: string | undefined, msgSeq: number | undefined): Promise<SendOutcome>
  sendGroup(groupOpenid: string, content: string, msgId: string | undefined, msgSeq: number | undefined): Promise<SendOutcome>
}
/** 投递要改任务账本上的回复次数与送达状态，经账本会话的串行队列与落盘完成。 */
export interface ChannelLedger {
  serial<T>(run: () => Promise<T>): Promise<T>
  save(): Promise<void>
}
const BOT_REPLY_PREFIX = '【机器人回执】'
export { BOT_REPLY_PREFIX }

export class QqChannel {
  constructor(private readonly deps: QqChannelDeps, private readonly ledger: ChannelLedger) {}

  send(route: Route, text: string, msgId: string | undefined, msgSeq: number | undefined): Promise<SendOutcome> {
    if (route.appId !== this.deps.appId()) return Promise.resolve({ ok: false, status: 0, message: '机器人身份已变化' })
    return route.scene === 'c2c' ? this.deps.sendC2c(route.target, text, msgId, msgSeq) : this.deps.sendGroup(route.target, `${BOT_REPLY_PREFIX}\n${text}`, msgId, msgSeq)
  }

  async reply(text: string, route: Route): Promise<boolean> {
    if (route.appId !== this.deps.appId()) return false
    for (const segment of splitForSend(text, 700)) {
      const chosen = chooseReplyRoute(route.scene, route.trigger, Date.now())
      if (chosen.kind === 'none') return false
      if (chosen.kind === 'passive') {
        route.trigger.repliesSent++; await this.ledger.save()
        if ((await this.send(route, segment, chosen.msgId, chosen.msgSeq)).ok) continue
        if (route.scene === 'group') return false
      }
      if (!(await this.send(route, segment, undefined, undefined)).ok) return false
    }
    return true
  }

  /** 投递一份已落盘的结果：先占用任务（pending → sending），发完记 delivered / undelivered。 */
  async deliver(job: Job, heading: string): Promise<void> {
    const claimed = await this.ledger.serial(async () => {
      if (job.delivery !== 'pending' || job.text === null || job.source.home !== this.deps.home || job.route.appId !== this.deps.appId()) return false
      job.delivery = 'sending'; await this.ledger.save(); return true
    })
    if (!claimed) return
    let delivered = true
    try {
      for (const segment of splitForSend(heading + tailExcerpt(job.text ?? '', 600), 700)) {
        const chosen = await this.ledger.serial(async () => {
          const route = chooseReplyRoute(job.route.scene, job.route.trigger, Date.now())
          if (route.kind === 'passive') { job.route.trigger.repliesSent++; await this.ledger.save() }
          return route
        })
        if (chosen.kind === 'none') { delivered = false; break }
        if (chosen.kind === 'passive' && (await this.send(job.route, segment, chosen.msgId, chosen.msgSeq)).ok) continue
        if (job.route.scene === 'group' || !(await this.send(job.route, segment, undefined, undefined)).ok) { delivered = false; break }
      }
    } catch { delivered = false }
    await this.ledger.serial(async () => { job.delivery = delivered ? 'delivered' : 'undelivered'; await this.ledger.save() })
  }
}
