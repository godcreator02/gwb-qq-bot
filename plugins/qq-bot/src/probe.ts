/** qq-bot.probe 的参数校验与实验消息生成（纯函数，测试在 tests/probe.test.ts） */

export interface ProbeArgs {
  experiment: 'count' | 'length'
  /** count 实验连发几条被动回复 */
  sends: number
  /** length 实验逐档发送的字符数 */
  chars: number[]
}

/** length 实验的缺省梯度：680 与 700 一档之差用来分辨限制按字节（中文 UTF-8 每字 3 字节，2048 字节 ≈ 682 字）还是按字符 */
export const DEFAULT_PROBE_CHARS = [600, 680, 700, 1000, 1500, 2000, 2500]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseProbeArgs(raw: unknown): ProbeArgs {
  if (!isRecord(raw)) throw new Error('qq-bot.probe 的参数要是对象，含 experiment（count 或 length）')
  const unknownKeys = Object.keys(raw).filter((key) => !['experiment', 'sends', 'chars'].includes(key))
  if (unknownKeys.length > 0) throw new Error(`qq-bot.probe 不认识参数 ${unknownKeys.join('、')}，只收 experiment、sends、chars`)
  const experiment = raw['experiment']
  if (experiment !== 'count' && experiment !== 'length') {
    throw new Error(`qq-bot.probe 的 experiment 只收 count 或 length，收到 ${JSON.stringify(experiment)}`)
  }
  const sends = raw['sends'] ?? 6
  if (typeof sends !== 'number' || !Number.isInteger(sends) || sends < 1 || sends > 10) {
    throw new Error(`qq-bot.probe 的 sends 要是 1 到 10 的整数（count 实验连发几条），收到 ${JSON.stringify(raw['sends'])}`)
  }
  const rawChars = raw['chars'] ?? DEFAULT_PROBE_CHARS
  if (
    !Array.isArray(rawChars) ||
    rawChars.length < 1 ||
    rawChars.length > 10 ||
    rawChars.some((value) => typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5000)
  ) {
    throw new Error(`qq-bot.probe 的 chars 要是 1 到 10 个、每个 1 到 5000 的整数（length 实验逐档的字符数），收到 ${JSON.stringify(raw['chars'])}`)
  }
  const chars: number[] = rawChars.filter((value): value is number => typeof value === 'number')
  return { experiment, sends, chars }
}

export function countProbeContent(index: number, total: number, msgSeq: number): string {
  return `probe-count 第 ${index}/${total} 条（msg_seq=${msgSeq}）：实测被动回复次数上限，收到本条说明第 ${msgSeq} 次被动仍可用`
}

export function lengthProbeContent(chars: number): string {
  const label = `L${chars}：`
  return label + '测'.repeat(Math.max(1, chars - label.length))
}
