/** 入站文本的归一与指令识别、长文本的末尾摘录——全是纯函数，测试在 tests/routing.test.ts（出站分段在 qq/reply-sender.ts） */

export const COMMAND_HELP = '/帮助'
export const COMMAND_STATUS = '/状态'
export const COMMAND_FRESH_SESSION = '/新会话'

export type BotCommand = 'help' | 'status' | 'fresh-session'

const COMMAND_NAMES: Record<BotCommand, string> = {
  help: COMMAND_HELP,
  status: COMMAND_STATUS,
  'fresh-session': COMMAND_FRESH_SESSION,
}

/** 归一入站文本：统一换行、去首尾空白 */
export function normalizeIncoming(content: string): string {
  return content.replace(/\r\n/g, '\n').trim()
}

/**
 * 指令必须整条精确匹配；其余文本（哪怕以 / 开头，如「/帮助一下」）一律当任务内容转给 ZCode。
 * 不做前缀匹配、不加别名，避免把用户真正想发给 ZCode 的文本截走
 */
export function matchCommand(text: string): BotCommand | null {
  for (const [name, literal] of Object.entries(COMMAND_NAMES) as [BotCommand, string][]) {
    if (text === literal) return name
  }
  return null
}

/** 只留末尾 maxChars 个字符，前面被省掉的部分注明字数；收尾的总结在末尾，看它最有用 */
export function tailExcerpt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const omitted = text.length - maxChars
  return `……（前面省略 ${omitted} 字）\n${text.slice(text.length - maxChars)}`
}
