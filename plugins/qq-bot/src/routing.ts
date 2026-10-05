/** 入站文本的归一与指令识别、出站长文本的分段与末尾摘录——全是纯函数，测试在 tests/routing.test.ts */

export const COMMAND_HELP = '/帮助'
export const COMMAND_STATUS = '/状态'
export const COMMAND_FRESH_SESSION = '/新会话'

export type BotCommand = 'help' | 'status' | 'fresh-session'

const COMMAND_NAMES: Record<BotCommand, string> = {
  help: COMMAND_HELP,
  status: COMMAND_STATUS,
  'fresh-session': COMMAND_FRESH_SESSION,
}

/** 群 @ 消息里 @ 机器人的占位（<@!数字> 或 <@数字>），出现在开头，派任务前剥掉 */
const MENTION_PLACEHOLDER = /^\s*(?:<@!?\d+>\s*)+/

/**
 * 归一入站文本：剥 @ 占位、去首尾空白、统一换行。
 * 只剥占位格式，文本里手打的 @ 原样保留——那是任务内容的一部分
 */
export function normalizeIncoming(content: string): string {
  return content.replace(MENTION_PLACEHOLDER, '').replace(/\r\n/g, '\n').trim()
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

/** 只留末尾 maxChars 个字符，前面被省掉的部分注明字数；收尾的总结在末尾，看它最有用 */
export function tailExcerpt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const omitted = text.length - maxChars
  return `……（前面省略 ${omitted} 字）\n${text.slice(text.length - maxChars)}`
}
