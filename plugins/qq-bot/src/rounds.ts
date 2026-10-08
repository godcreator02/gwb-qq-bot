/**
 * 连上一个机器人以后，把三块接起来：入站私聊先过 qq/ 的白名单，再交给 dispatch/ 派任务；notify 交给 notify/。
 * 通知与派任务互不 import，只在这里汇合
 */
import { ChatRounds } from './dispatch/chat-rounds.js'
import type { PluginCommandRegistry } from './dispatch/command-registry.js'
import type { ExecutorTable } from './dispatch/executors/executor.js'
import { OwnerNotifier } from './notify/owner-notifier.js'
import { AllowedSenderGate } from './qq/incoming-gate.js'
import type { IncomingMessage, QqLog } from './qq/qq-protocol.js'
import { ReplySender, type SendC2c } from './qq/reply-sender.js'
import type { Chat, ChatTable, StoredTaskGroup } from './storage/chat-table.js'

export interface RoundsDeps {
  /** gwb home 名，写进提示词，agent 按它选连回哪个 MCP 服务 */
  home: string
  table: ChatTable
  executors: ExecutorTable
  /** 插件注册的任务组与直接命令，放在服务上，换机器人重连时不丢 */
  registry: PluginCommandRegistry
  allowedOpenids(): string[]
  ownerOpenid(): string
  defaultWorkspace(): string
  /** 设置 idle-hours 的原值 */
  idleHours(): unknown
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
    this.chatRounds = new ChatRounds({
      home: deps.home, table: deps.table, executors: deps.executors, registry: deps.registry,
      ownerOpenid: deps.ownerOpenid, defaultWorkspace: deps.defaultWorkspace, idleHours: deps.idleHours, replies, log: deps.log,
    })
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
  }
}
