/**
 * 插件经 gwbQqBot 注册的任务组与直接命令。放在服务上、不放在连上以后才有的对象上：没配 AppID 时插件照样能注册。
 * 命令登记的组存在聊天表里，这里不存，查重名时由调用方把它们的命令传进来
 */
import type { DirectCommandDefinition, TaskGroupDefinition } from '../api.js'
import { onlyKeys, optionalText, requireExistingDirectory, requireText } from './command-args.js'
import { commandNameProblem } from './routing.js'

export interface PluginTaskGroup {
  definition: TaskGroupDefinition
  /** 注册它的插件包名，取不到是 undefined */
  plugin: string | undefined
}

export interface PluginDirectCommand {
  definition: DirectCommandDefinition
  plugin: string | undefined
}

export interface RegistrationContext {
  plugin: string | undefined
  /** 此刻聊天表里命令登记的组的命令；QQ 还没连上时是空的，连上后的重名在派任务时报出 */
  storedGroupCommands: string[]
}

const TASK_GROUP_KEYS = ['command', 'title', 'workspace', 'instructions', 'idleHours']

function requireCommandName(raw: Record<string, unknown>): string {
  const command = requireText(raw, 'command', '斜杠命令，如 /mmc')
  const problem = commandNameProblem(command)
  if (problem !== null) throw new Error(problem)
  return command
}

/** 校验一个任务组的定义；不查 claude-agent 装没装、不查重名 */
export function parseTaskGroupDefinition(raw: unknown, where: string): TaskGroupDefinition {
  const args = onlyKeys(raw, where, TASK_GROUP_KEYS)
  const command = requireCommandName(args)
  const title = requireText(args, 'title', '回执里叫这个组的名字')
  const workspace = requireExistingDirectory(args, 'workspace')
  const definition: TaskGroupDefinition = { command, title, workspace }
  const instructions = optionalText(args, 'instructions', '附在任务说明里的要求')
  if (instructions !== undefined) definition.instructions = instructions
  const idleHours = args['idleHours']
  if (idleHours !== undefined) {
    if (typeof idleHours !== 'number' || !Number.isFinite(idleHours) || idleHours <= 0) throw new Error(`idleHours 要是正数（小时），收到 ${JSON.stringify(idleHours)}`)
    definition.idleHours = idleHours
  }
  return definition
}

function parseDirectCommandDefinition(raw: unknown): DirectCommandDefinition {
  const args = onlyKeys(raw, 'registerCommand', ['command', 'description', 'handle'])
  const command = requireCommandName(args)
  const description = requireText(args, 'description', '/帮助 里列出的一句说明')
  const handle = args['handle']
  if (typeof handle !== 'function') throw new Error('registerCommand 的 handle 要是函数，交回要回复的文字')
  return { command, description, handle: handle as DirectCommandDefinition['handle'] }
}

export class PluginCommandRegistry {
  private readonly groups = new Map<string, PluginTaskGroup>()
  private readonly directCommands = new Map<string, PluginDirectCommand>()
  private readonly changeListeners = new Set<() => void>()

  registerTaskGroup(raw: unknown, context: RegistrationContext): () => void {
    const entry: PluginTaskGroup = { definition: parseTaskGroupDefinition(raw, 'registerTaskGroup'), plugin: context.plugin }
    const command = entry.definition.command
    this.requireFree(command, context.storedGroupCommands)
    this.groups.set(command, entry)
    this.notifyChanged()
    return () => { if (this.groups.get(command) === entry) { this.groups.delete(command); this.notifyChanged() } }
  }

  registerCommand(raw: unknown, context: RegistrationContext): () => void {
    const entry: PluginDirectCommand = { definition: parseDirectCommandDefinition(raw), plugin: context.plugin }
    const command = entry.definition.command
    this.requireFree(command, context.storedGroupCommands)
    this.directCommands.set(command, entry)
    this.notifyChanged()
    return () => { if (this.directCommands.get(command) === entry) { this.directCommands.delete(command); this.notifyChanged() } }
  }

  /** 注册或撤掉一项后调 listener；回取消订阅的函数 */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }

  private notifyChanged(): void {
    for (const listener of this.changeListeners) listener()
  }

  /** 命令已经被占用就报错，写明被谁占着；保留命令在 commandNameProblem 里已经拒过 */
  requireFree(command: string, storedGroupCommands: string[]): void {
    const holder = this.holderOf(command) ?? (storedGroupCommands.includes(command) ? '命令登记的任务组（qq-bot.group.add）' : null)
    if (holder !== null) throw new Error(`命令 ${command} 已经被${holder}占用，换一个名字`)
  }

  /** 插件注册的哪一项占着这个命令，没有回 null */
  holderOf(command: string): string | null {
    const group = this.groups.get(command)
    if (group !== undefined) return `${pluginLabel(group.plugin)}注册的任务组`
    const direct = this.directCommands.get(command)
    if (direct !== undefined) return `${pluginLabel(direct.plugin)}注册的直接命令`
    return null
  }

  group(command: string): PluginTaskGroup | undefined {
    return this.groups.get(command)
  }

  directCommand(command: string): PluginDirectCommand | undefined {
    return this.directCommands.get(command)
  }

  allGroups(): PluginTaskGroup[] {
    return [...this.groups.values()]
  }

  allDirectCommands(): PluginDirectCommand[] {
    return [...this.directCommands.values()]
  }
}

const pluginLabel = (plugin: string | undefined): string => plugin === undefined ? '插件' : `插件 ${plugin} `
