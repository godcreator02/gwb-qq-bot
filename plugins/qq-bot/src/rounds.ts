/**
 * 连上一个机器人以后，把三块接起来：入站私聊先过 qq/ 的白名单，再交给 dispatch/ 派任务；notify 交给 notify/。
 * 通知与派任务互不 import，只在这里汇合
 */
import { ChatRounds } from './dispatch/chat-rounds.js'
import type { ExecutorTable } from './dispatch/executors/executor.js'
import { OwnerNotifier } from './notify/owner-notifier.js'
import { AllowedSenderGate } from './qq/incoming-gate.js'
import type { IncomingMessage, QqLog } from './qq/qq-protocol.js'
import { ReplySender, type SendC2c } from './qq/reply-sender.js'
import type { Chat, ChatTable } from './storage/chat-table.js'

export interface RoundsDeps {
  /** gwb home 名，写进提示词，agent 按它选连回哪个 MCP 服务 */
  home: string
  table: ChatTable
  executors: ExecutorTable
  allowedOpenids(): string[]
  ownerOpenid(): string
  defaultWorkspace(): string
  sendC2c: SendC2c
  log: QqLog
}

export class Rounds {
  readonly recentRejected: { openid: string; at: string; excerpt: string }[]
  private readonly gate: AllowedSenderGate
  private readonly chatRounds: ChatRounds
  private readonly notifier: OwnerNotifier
  private closing = false

  constructor(deps: RoundsDeps) {
    this.gate = new AllowedSenderGate({ allowedOpenids: deps.allowedOpenids, log: deps.log })
    this.recentRejected = this.gate.recentRejected
    const replies = new ReplySender({ table: deps.table, sendC2c: deps.sendC2c, log: deps.log })
    this.chatRounds = new ChatRounds({ home: deps.home, table: deps.table, executors: deps.executors, ownerOpenid: deps.ownerOpenid, defaultWorkspace: deps.defaultWorkspace, replies, log: deps.log })
    this.notifier = new OwnerNotifier({ table: deps.table, allowedOpenids: deps.allowedOpenids, ownerOpenid: deps.ownerOpenid, sendC2c: deps.sendC2c, log: deps.log })
  }

  async handleIncoming(message: IncomingMessage): Promise<void> {
    if (this.closing) return
    if (!this.gate.admit(message)) return
    await this.chatRounds.handleAdmitted(message)
  }

  report(raw: unknown): Promise<{ recorded: true; duplicate: boolean }> {
    return this.chatRounds.report(raw)
  }

  bind(raw: unknown): Promise<Chat> {
    return this.chatRounds.bind(raw)
  }

  unbind(raw: unknown): Promise<Chat> {
    return this.chatRounds.unbind(raw)
  }

  summary(): ReturnType<ChatRounds['summary']> {
    return this.chatRounds.summary()
  }

  notify(id: string, text: string): Promise<{ delivered: boolean; duplicate: boolean }> {
    return this.notifier.notify(id, text)
  }

  async dispose(): Promise<void> {
    this.closing = true
    await this.chatRounds.dispose()
  }
}
