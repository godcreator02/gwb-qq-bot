/** 入站文本的归一与分发、命令名规则、长文本的末尾摘录——全是纯函数，测试在 tests/routing.test.ts（出站分段在 qq/reply-sender.ts） */
import { DEFAULT_GROUP_KEY } from '../storage/chat-table.js'

export const COMMAND_HELP = '/帮助'
export const COMMAND_STATUS = '/状态'
export const COMMAND_FRESH_SESSION = '/新会话'
export const RESERVED_COMMANDS: readonly string[] = [COMMAND_HELP, COMMAND_STATUS, COMMAND_FRESH_SESSION]

/** QQ 管理端指令名的上限：8 个汉字或 16 个英文字符 */
const COMMAND_NAME_MAX_WEIGHT = 16

/** 不以斜杠开头的消息都进默认组；以斜杠开头的消息第一段要和这些命令之一完全相同 */
export type CommandKind = 'group' | 'direct' | 'conflict'

export type RoutedMessage =
  | { kind: 'help' }
  | { kind: 'status' }
  /** group 是 `/新会话` 后面写的组名，没写是 null */
  | { kind: 'fresh-session'; group: string | null }
  /** 用法不对，text 是要回的用法说明 */
  | { kind: 'usage'; text: string }
  | { kind: 'unknown-command'; command: string }
  /** 同一个命令同时有两个来源（命令登记的组与插件注册的组），派不出去 */
  | { kind: 'conflict'; command: string }
  /** group 是组名，默认组是 DEFAULT_GROUP_KEY */
  | { kind: 'task'; group: string; prompt: string }
  | { kind: 'direct'; command: string; text: string }

/** 归一入站文本：统一换行、去首尾空白 */
export function normalizeIncoming(content: string): string {
  return content.replace(/\r\n/g, '\n').trim()
}

/** 按第一个空白（含全角空格与换行）切成第一段与其余的正文，正文去掉首尾空白 */
export function splitFirstSegment(text: string): { head: string; rest: string } {
  const space = /\s/u.exec(text)
  if (space === null) return { head: text, rest: '' }
  return { head: text.slice(0, space.index), rest: text.slice(space.index).trim() }
}

export const groupNameOf = (command: string): string => command.slice(1)

/**
 * 一条归一后的消息分到哪：第一段和某个命令完全相同才算命令，不做前缀匹配、不设别名；以斜杠开头却不是命令的不派出。
 * kindOf 回第一段是哪种已注册的命令，不是命令回 null
 */
export function routeMessage(text: string, kindOf: (command: string) => CommandKind | null): RoutedMessage {
  if (!text.startsWith('/')) return { kind: 'task', group: DEFAULT_GROUP_KEY, prompt: text }
  const { head, rest } = splitFirstSegment(text)
  if (head === COMMAND_HELP) return rest === '' ? { kind: 'help' } : { kind: 'usage', text: `${COMMAND_HELP} 后面不带别的文字，只发 ${COMMAND_HELP}` }
  if (head === COMMAND_STATUS) return rest === '' ? { kind: 'status' } : { kind: 'usage', text: `${COMMAND_STATUS} 后面不带别的文字，只发 ${COMMAND_STATUS}` }
  if (head === COMMAND_FRESH_SESSION) {
    if (rest === '') return { kind: 'fresh-session', group: null }
    if (/\s/u.test(rest)) return { kind: 'usage', text: `用法：${COMMAND_FRESH_SESSION} 或 ${COMMAND_FRESH_SESSION} <组名>，组名只有一个` }
    return { kind: 'fresh-session', group: rest }
  }
  const kind = kindOf(head)
  if (kind === null) return { kind: 'unknown-command', command: head }
  if (kind === 'conflict') return { kind: 'conflict', command: head }
  if (kind === 'direct') return { kind: 'direct', command: head, text: rest }
  if (rest === '') return { kind: 'usage', text: `用法：${head} <任务>，命令后面空一格写要做的事` }
  return { kind: 'task', group: groupNameOf(head), prompt: rest }
}

/** 去掉斜杠后的加权长度：非 ASCII 字符（汉字等）算 2，其余算 1 */
export function commandNameWeight(name: string): number {
  let weight = 0
  for (const character of name) weight += character.codePointAt(0)! > 0x7f ? 2 : 1
  return weight
}

/** 命令名不合规则时回原因，合规回 null。不管重名，重名由注册处查 */
export function commandNameProblem(command: string): string | null {
  if (!command.startsWith('/')) return `命令 ${command} 要以 / 开头`
  if (/\s/u.test(command)) return `命令 ${command} 不能含空白`
  if (RESERVED_COMMANDS.includes(command)) return `${command} 是保留命令（${RESERVED_COMMANDS.join('、')}），不能注册`
  const weight = commandNameWeight(groupNameOf(command))
  if (weight === 0) return '命令 / 后面要有名字'
  if (weight > COMMAND_NAME_MAX_WEIGHT) return `命令 ${command} 太长：去掉斜杠后汉字算 2、其余算 1，最多 ${COMMAND_NAME_MAX_WEIGHT}，这个是 ${weight}`
  return null
}

/** 只留末尾 maxChars 个字符，前面被省掉的部分注明字数；收尾的总结在末尾，看它最有用 */
export function tailExcerpt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const omitted = text.length - maxChars
  return `……（前面省略 ${omitted} 字）\n${text.slice(text.length - maxChars)}`
}
