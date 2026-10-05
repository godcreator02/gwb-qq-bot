/** openid ↔ ZCode 会话的桥接：白名单校验、指令处理、派任务、轮询结果、按被动窗口选路回发 */

import { isRecord, type IncomingMessage, type MessageScene, type QqLog } from './qq-protocol.js'
import type { SendOutcome } from './qq-rest.js'
import { matchCommand, normalizeIncoming, splitForSend, tailExcerpt } from './routing.js'
import { chooseReplyRoute, type ReplyTrigger } from './reply-window.js'

/** 命令总线的回执：ok 之外字段都可能没有，用哪项判哪项 */
type GwbResult = { ok: boolean; data?: unknown; error?: string }

function describeFailure(outcome: GwbResult): string {
  return typeof outcome.error === 'string' ? outcome.error : JSON.stringify(outcome.data)
}

export interface BridgeDeps {
  runCommand(name: string, args: Record<string, unknown>): Promise<GwbResult>
  defaultWorkspace(): string
  allowedOpenids(): string[]
  sendC2c(openid: string, content: string, msgId: string | undefined, msgSeq: number | undefined): Promise<SendOutcome>
  sendGroup(groupOpenid: string, content: string, msgId: string | undefined, msgSeq: number | undefined): Promise<SendOutcome>
  /** 周期回调，返回取消函数；由 index.ts 接 cordis 的 setInterval，插件卸载时自动清 */
  every(intervalMs: number, callback: () => void): () => void
  log: QqLog
}

/** 轮询间隔与回复尺寸：一轮 ZCode 任务几分钟起步，60 秒一查足够；QQ 消息按 700 字一段发 */
const POLL_INTERVAL_MS = 60_000
const SEND_SEGMENT_CHARS = 700
const RESULT_TAIL_CHARS = 1200

const HELP_TEXT = [
  'QQ → ZCode 通道：',
  '· 直接发任务文本＝派给 ZCode（同一会话接着聊，上下文保留）',
  '· /状态 查当前进度；做完的结果没送达时，发它取回',
  '· /新会话 下一条消息起换新的 ZCode 会话',
  '· /帮助 看这段说明',
  'ZCode 桌面端要开着；任务会真的在这台电脑上执行。',
].join('\n')

interface UserSession {
  openid: string
  workspace: string
  taskId: string | null
  roundIndex: number
  roundRunning: boolean
  /** 这一轮触发消息的回复依据（被动窗口按它算）与回复地址 */
  trigger: ReplyTrigger | null
  dispatchScene: MessageScene
  dispatchTarget: string
  /** 最新一轮的结果文本；没送达时等 /状态 取回 */
  lastResult: string | null
  resultDelivered: boolean
  stopPolling: (() => void) | null
}

export class ZcodeBridge {
  private readonly sessions = new Map<string, UserSession>()
  private readonly recentRejected: { openid: string; scene: string; at: string; excerpt: string }[] = []

  constructor(private readonly deps: BridgeDeps) {}

  async handleIncoming(message: IncomingMessage): Promise<void> {
    if (!this.deps.allowedOpenids().includes(message.senderOpenid)) {
      this.recentRejected.push({
        openid: message.senderOpenid,
        scene: message.scene,
        at: new Date().toISOString(),
        excerpt: message.content.slice(0, 40),
      })
      if (this.recentRejected.length > 10) this.recentRejected.shift()
      this.deps.log.info(`拒绝白名单外的 ${message.scene} 消息，openid=${message.senderOpenid}`)
      return
    }
    const text = normalizeIncoming(message.content)
    if (text === '') return
    const session = this.sessionFor(message.senderOpenid)
    const command = matchCommand(text)
    if (command === null) {
      await this.dispatchTask(session, message, text)
      return
    }
    if (command === 'help') {
      await this.replyToNewMessage(session, message, HELP_TEXT)
      return
    }
    if (command === 'status') {
      await this.handleStatusCommand(session, message)
      return
    }
    await this.handleFreshSessionCommand(session, message)
  }

  report(): {
    sessions: { openid: string; taskId: string | null; workspace: string; roundRunning: boolean; roundIndex: number; resultDelivered: boolean }[]
    recentRejected: { openid: string; scene: string; at: string; excerpt: string }[]
  } {
    return {
      sessions: [...this.sessions.values()].map((session) => ({
        openid: session.openid,
        taskId: session.taskId,
        workspace: session.workspace,
        roundRunning: session.roundRunning,
        roundIndex: session.roundIndex,
        resultDelivered: session.resultDelivered,
      })),
      recentRejected: [...this.recentRejected],
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) session.stopPolling?.()
    this.sessions.clear()
  }

  private sessionFor(openid: string): UserSession {
    const existing = this.sessions.get(openid)
    if (existing !== undefined) return existing
    const created: UserSession = {
      openid,
      workspace: '',
      taskId: null,
      roundIndex: 0,
      roundRunning: false,
      trigger: null,
      dispatchScene: 'c2c',
      dispatchTarget: '',
      lastResult: null,
      resultDelivered: true,
      stopPolling: null,
    }
    this.sessions.set(openid, created)
    return created
  }

  private async handleStatusCommand(session: UserSession, message: IncomingMessage): Promise<void> {
    if (session.roundRunning) {
      await this.replyToNewMessage(session, message, `ZCode 会话 ${session.taskId ?? ''} 第 ${session.roundIndex} 轮还在跑，做完会再回你`)
      return
    }
    if (session.lastResult !== null && !session.resultDelivered) {
      // 上一轮结果没送达（被动窗口过期被留了下来）：借这条消息的窗口补发
      const trigger: ReplyTrigger = { msgId: message.msgId, receivedAt: Date.now(), repliesSent: 0 }
      const delivered = await this.deliverSegments(session.lastResult, message.scene, message.replyTarget, trigger)
      if (delivered) session.resultDelivered = true
      return
    }
    if (session.lastResult !== null) {
      await this.replyToNewMessage(session, message, `上一轮结果（重看）：\n${tailExcerpt(session.lastResult, 600)}`)
      return
    }
    await this.replyToNewMessage(session, message, session.taskId === null ? '还没有 ZCode 会话；直接发任务文本就开始一个' : `当前 ZCode 会话 ${session.taskId}（第 ${session.roundIndex} 轮已做完）`)
  }

  private async handleFreshSessionCommand(session: UserSession, message: IncomingMessage): Promise<void> {
    if (session.roundRunning) {
      await this.replyToNewMessage(session, message, '这一轮还在跑，做完再换会话')
      return
    }
    if (session.taskId !== null) {
      const archived = await this.deps.runCommand('zcode.archive', { workspace: session.workspace, task: session.taskId })
      if (!archived.ok) this.deps.log.warn(`归档旧会话失败（继续换新）：${describeFailure(archived)}`)
    }
    session.taskId = null
    session.roundIndex = 0
    session.lastResult = null
    session.resultDelivered = true
    await this.replyToNewMessage(session, message, '旧会话已收起；下一条消息起用新的 ZCode 会话')
  }

  private async dispatchTask(session: UserSession, message: IncomingMessage, text: string): Promise<void> {
    const workspace = this.deps.defaultWorkspace()
    if (workspace === '') {
      await this.replyToNewMessage(session, message, '还没配置默认工作区：到工作台设置的 qq-bot 分区填 default-workspace（ZCode 干活的目录），再发一次')
      return
    }
    const outcome =
      session.taskId === null
        ? await this.deps.runCommand('zcode.create', { workspace, prompt: text })
        : await this.deps.runCommand('zcode.send', { workspace, task: session.taskId, prompt: text })
    if (!outcome.ok) {
      const failure = describeFailure(outcome)
      const hint = failure.includes('没有这条命令') ? '（这个 home 没装 gwb-zcode 插件）' : ''
      await this.replyToNewMessage(session, message, `派任务失败：${failure}${hint}`)
      return
    }
    const taskId = isRecord(outcome.data) && typeof outcome.data['taskId'] === 'string' ? outcome.data['taskId'] : null
    if (taskId === null) {
      await this.replyToNewMessage(session, message, `zcode 命令回执里没有 taskId：${JSON.stringify(outcome.data)}`)
      return
    }
    session.taskId = taskId
    session.workspace = workspace
    session.roundIndex += 1
    session.roundRunning = true
    session.lastResult = null
    session.resultDelivered = false
    session.trigger = { msgId: message.msgId, receivedAt: Date.now(), repliesSent: 0 }
    session.dispatchScene = message.scene
    session.dispatchTarget = message.replyTarget
    this.deps.log.info(`openid=${session.openid} 的任务派给 ZCode 会话 ${taskId} 第 ${session.roundIndex} 轮`)
    await this.replyViaTrigger(session, `收到，已派给 ZCode 会话 ${taskId} 第 ${session.roundIndex} 轮；做完回你`)
    this.startPolling(session)
  }

  private startPolling(session: UserSession): void {
    session.stopPolling?.()
    const stop = this.deps.every(POLL_INTERVAL_MS, () => {
      void this.pollOnce(session)
    })
    session.stopPolling = stop
  }

  private async pollOnce(session: UserSession): Promise<void> {
    if (session.taskId === null || !session.roundRunning) return
    const outcome = await this.deps.runCommand('zcode.status', {
      workspace: session.workspace,
      task: session.taskId,
      waitSeconds: 0,
      replyTailChars: 2000,
    })
    if (!outcome.ok) {
      // 一次查不到不算完（ZCode 窗口关了之类），下一轮再查；用户发 /状态 也能看到还在跑
      this.deps.log.warn(`查会话 ${session.taskId} 失败：${describeFailure(outcome)}`)
      return
    }
    const data = isRecord(outcome.data) ? outcome.data : {}
    if (data['roundIsOver'] !== true) return
    session.stopPolling?.()
    session.stopPolling = null
    session.roundRunning = false
    session.lastResult = this.composeResult(data)
    const delivered = await this.deliverSegments(session.lastResult, session.dispatchScene, session.dispatchTarget, session.trigger)
    if (delivered) session.resultDelivered = true
    else this.deps.log.info(`会话 ${session.taskId} 的结果没送达（被动窗口过期），等用户发 /状态 取回`)
  }

  /** 轮询查到做完后，把回答末尾整理成一条要发回 QQ 的文本 */
  private composeResult(data: Record<string, unknown>): string {
    const replies = Array.isArray(data['replies']) ? data['replies'].filter((reply): reply is string => typeof reply === 'string') : []
    const pendingPermissions = Array.isArray(data['pendingPermissions']) ? data['pendingPermissions'] : []
    const status = typeof data['status'] === 'string' ? data['status'] : ''
    if (pendingPermissions.length > 0) return 'ZCode 停在等人确认，去电脑上的 ZCode 界面处理；处理完发 /状态 看结果'
    const lastReply = replies.length > 0 ? (replies[replies.length - 1] as string) : '(ZCode 没写回答)'
    const heading = status === 'completed' || status === 'idle' ? '' : `ZCode 报这轮状态是 ${status}。\n`
    return `${heading}${tailExcerpt(lastReply, RESULT_TAIL_CHARS)}${describeFileChanges(data['fileChanges'])}`
  }

  /** 分段逐条发送；只要有一条送达就算送达。返回是否全部送达（含主动兜底） */
  private async deliverSegments(text: string, scene: MessageScene, target: string, trigger: ReplyTrigger | null): Promise<boolean> {
    const segments = splitForSend(text, SEND_SEGMENT_CHARS)
    let allSent = true
    for (const segment of segments) {
      const route = chooseReplyRoute(scene, trigger, Date.now())
      if (route.kind === 'passive' && trigger !== null) {
        const outcome = await this.send(scene, target, segment, route.msgId, route.msgSeq)
        trigger.repliesSent += 1
        if (outcome.ok) continue
        // 被动失败多半是窗口已过：单聊降级为主动再试这一段，群聊到此为止
        if (scene === 'c2c') {
          const active = await this.send(scene, target, segment, undefined, undefined)
          if (active.ok) continue
        }
        allSent = false
        break
      }
      if (route.kind === 'active' && scene === 'c2c') {
        const outcome = await this.send(scene, target, segment, undefined, undefined)
        if (outcome.ok) continue
        allSent = false
        break
      }
      // 群聊的 none：主动配额每月每群只有约 4 条，不拿来发结果，留着等 /状态
      allSent = false
      break
    }
    return allSent
  }

  private send(scene: MessageScene, target: string, content: string, msgId: string | undefined, msgSeq: number | undefined): Promise<SendOutcome> {
    return scene === 'c2c' ? this.deps.sendC2c(target, content, msgId, msgSeq) : this.deps.sendGroup(target, content, msgId, msgSeq)
  }

  /** 指令与派任务回执的回复：永远以当前这条消息开一个新的被动窗口 */
  private async replyToNewMessage(session: UserSession, message: IncomingMessage, text: string): Promise<void> {
    await this.deliverSegments(text, message.scene, message.replyTarget, { msgId: message.msgId, receivedAt: Date.now(), repliesSent: 0 })
  }

  /** 派任务成功的回执走这一轮的 trigger，与结果推送共用被动次数 */
  private async replyViaTrigger(session: UserSession, text: string): Promise<void> {
    await this.deliverSegments(text, session.dispatchScene, session.dispatchTarget, session.trigger)
  }
}

/** fileChanges 的形状 gwb-zcode 也没定死（unknown），能读出个摘要就读，读不出就不提 */
function describeFileChanges(fileChanges: unknown): string {
  if (Array.isArray(fileChanges) && fileChanges.length > 0) return `\n（改了 ${fileChanges.length} 个文件，明细在 ZCode 界面看）`
  if (isRecord(fileChanges) && Object.keys(fileChanges).length > 0) return `\n（文件改动明细在 ZCode 界面看）`
  return ''
}
