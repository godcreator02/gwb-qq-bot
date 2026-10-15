/**
 * 连上一个机器人以后，把三块接起来：入站私聊先过 qq/ 的白名单，再交给 dispatch/ 派任务；notify 交给 notify/。
 * 通知与派任务互不 import，只在这里汇合
 */
import type { GwbClaudeAgentApi } from '@godcreator/gwb-claude-agent'
import { ChatRounds } from './dispatch/chat-rounds.js'
import type { PluginCommandRegistry } from './dispatch/command-registry.js'
import { OwnerNotifier } from './notify/owner-notifier.js'
import { AllowedSenderGate } from './qq/incoming-gate.js'
import type { MessageLog, RawSendC2c } from './qq/message-log.js'
import type { IncomingMessage, QqLog } from './qq/qq-protocol.js'
import { ReplySender } from './qq/reply-sender.js'
import type { Chat, ChatTable, StoredTaskGroup } from './storage/chat-table.js'

export interface RoundsDeps {
  table: ChatTable
  /** 此刻装着的 claude-agent 服务，没装是 null */
  agent(): GwbClaudeAgentApi | null
  /** 插件注册的任务组与直接命令，放在服务上，换机器人重连时不丢 */
  registry: PluginCommandRegistry
  allowedOpenids(): string[]
  ownerOpenid(): string
  defaultWorkspace(): string
  /** 设置 idle-hours 的原值 */
  idleHours(): unknown
  sendC2c: RawSendC2c
  /** 这个机器人的消息记录：入站经白名单与派任务记，出站经它包过的发消息函数记 */
  messages: MessageLog
  log: QqLog
}

export class Rounds {
  readonly recentRejected: { openid: string; at: string; excerpt: string }[]
  private readonly gate: AllowedSenderGate
  private readonly chatRounds: ChatRounds
  private readonly notifier: OwnerNotifier
  private readonly messages: MessageLog
  private closing = false

  constructor(deps: RoundsDeps) {
    this.messages = deps.messages
    this.gate = new AllowedSenderGate({ allowedOpenids: deps.allowedOpenids, messages: deps.messages, log: deps.log })
    this.recentRejected = this.gate.recentRejected
    const sendC2c = deps.messages.recordingSend(deps.sendC2c)
    const replies = new ReplySender({ table: deps.table, sendC2c, log: deps.log })
    this.chatRounds = new ChatRounds({
      table: deps.table, agent: deps.agent, registry: deps.registry,
      ownerOpenid: deps.ownerOpenid, defaultWorkspace: deps.defaultWorkspace, idleHours: deps.idleHours, replies, messages: deps.messages, log: deps.log,
    })
    this.notifier = new OwnerNotifier({ table: deps.table, allowedOpenids: deps.allowedOpenids, ownerOpenid: deps.ownerOpenid, sendC2c, log: deps.log })
  }

  async handleIncoming(message: IncomingMessage): Promise<void> {
    if (this.closing) return
    if (!this.gate.admit(message)) return
    await this.chatRounds.handleAdmitted(message)
  }

  /** 连上以后、claude-agent 重新装上以后各调一次：在做的轮次接着等它结束 */
  resumeWaiting(): void {
    if (!this.closing) this.chatRounds.resumeWaiting()
  }

  bind(raw: unknown): Promise<Chat> {
    return this.chatRounds.bind(raw)
  }

  unbind(raw: unknown): Promise<Chat> {
    return this.chatRounds.unbind(raw)
  }

  addGroup(raw: unknown): Promise<StoredTaskGroup> {
    return this.chatRounds.addGroup(raw)
  }

  removeGroup(raw: unknown): Promise<StoredTaskGroup> {
    return this.chatRounds.removeGroup(raw)
  }

  listGroups(): ReturnType<ChatRounds['listGroups']> {
    return this.chatRounds.listGroups()
  }

  storedGroupCommands(): string[] {
    return this.chatRounds.storedGroupCommands()
  }

  conflictingCommands(): string[] {
    return this.chatRounds.conflictingCommands()
  }

  panelCandidates(): ReturnType<ChatRounds['panelCandidates']> {
    return this.chatRounds.panelCandidates()
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
    await this.messages.settle()
  }
}
