import { describe, expect, it } from 'vitest'
import { commandNameProblem, commandNameWeight, normalizeIncoming, routeMessage, splitFirstSegment, tailExcerpt, type CommandKind } from '../src/dispatch/routing.js'
import { splitForSend } from '../src/qq/reply-sender.js'

describe('normalizeIncoming', () => {
  it('统一换行、去首尾空白', () => {
    expect(normalizeIncoming('  帮我看看\r\n这个仓的测试为什么挂  ')).toBe('帮我看看\n这个仓的测试为什么挂')
  })

  it('只有空白时得到空串', () => {
    expect(normalizeIncoming('   ')).toBe('')
    expect(normalizeIncoming('')).toBe('')
  })

  it('正文里出现的 @ 与尖括号原样保留，换行统一', () => {
    expect(normalizeIncoming('查一下 <@!000> 这个标识')).toBe('查一下 <@!000> 这个标识')
    expect(normalizeIncoming('第一行\r\n第二行')).toBe('第一行\n第二行')
  })
})

describe('splitFirstSegment', () => {
  it('按第一个空白切：半角空格、全角空格、换行都算，正文去掉首尾空白', () => {
    expect(splitFirstSegment('/mmc 改参数')).toEqual({ head: '/mmc', rest: '改参数' })
    expect(splitFirstSegment('/mmc　改参数')).toEqual({ head: '/mmc', rest: '改参数' })
    expect(splitFirstSegment('/mmc\n第一行\n第二行')).toEqual({ head: '/mmc', rest: '第一行\n第二行' })
    expect(splitFirstSegment('/状态')).toEqual({ head: '/状态', rest: '' })
  })
})

describe('routeMessage：一条消息分到哪', () => {
  const kinds: Record<string, CommandKind> = { '/mmc': 'group', '/血糖': 'direct', '/重名': 'conflict' }
  const route = (text: string) => routeMessage(text, (command) => kinds[command] ?? null)

  it('不以斜杠开头的进默认组，哪怕正文里有命令', () => {
    expect(route('帮我看下今天的日志')).toEqual({ kind: 'task', group: '', prompt: '帮我看下今天的日志' })
    expect(route('帮我把 /帮助 写进文档')).toEqual({ kind: 'task', group: '', prompt: '帮我把 /帮助 写进文档' })
  })

  it('组命令加正文进那一组，正文是命令后面的部分；只发组命令回用法', () => {
    expect(route('/mmc 把 DSP 的采样频率改成 20k')).toEqual({ kind: 'task', group: 'mmc', prompt: '把 DSP 的采样频率改成 20k' })
    expect(route('/mmc')).toEqual({ kind: 'usage', text: '用法：/mmc <任务>，命令后面空一格写要做的事' })
  })

  it('保留命令：/帮助、/状态 后面带了别的文字回用法；/新会话 后面可选一个组名', () => {
    expect(route('/帮助')).toEqual({ kind: 'help' })
    expect(route('/状态')).toEqual({ kind: 'status' })
    expect(route('/帮助 一下')).toMatchObject({ kind: 'usage' })
    expect(route('/状态 mmc')).toMatchObject({ kind: 'usage' })
    expect(route('/新会话')).toEqual({ kind: 'fresh-session', group: null })
    expect(route('/新会话 mmc')).toEqual({ kind: 'fresh-session', group: 'mmc' })
    expect(route('/新会话 mmc sst')).toMatchObject({ kind: 'usage' })
  })

  it('第一段要和命令完全相同：不做前缀匹配，以斜杠开头却不是命令的回没有指令', () => {
    expect(route('/帮助一下')).toEqual({ kind: 'unknown-command', command: '/帮助一下' })
    expect(route('/mm 改参数')).toEqual({ kind: 'unknown-command', command: '/mm' })
    expect(route('/')).toEqual({ kind: 'unknown-command', command: '/' })
  })

  it('直接命令带上后面的正文（可以是空串）；重名的命令单独分出来', () => {
    expect(route('/血糖 最近一小时')).toEqual({ kind: 'direct', command: '/血糖', text: '最近一小时' })
    expect(route('/血糖')).toEqual({ kind: 'direct', command: '/血糖', text: '' })
    expect(route('/重名 正文')).toEqual({ kind: 'conflict', command: '/重名' })
  })
})

describe('命令名规则', () => {
  it('去掉斜杠后汉字等非 ASCII 字符算 2、其余算 1', () => {
    expect(commandNameWeight('mmc')).toBe(3)
    expect(commandNameWeight('论文')).toBe(4)
    expect(commandNameWeight('知识ab')).toBe(6)
  })

  it('合规的回 null：8 个汉字、16 个英文字符正好到上限', () => {
    expect(commandNameProblem('/mmc')).toBeNull()
    expect(commandNameProblem('/一二三四五六七八')).toBeNull()
    expect(commandNameProblem(`/${'a'.repeat(16)}`)).toBeNull()
  })

  it('保留字、超长、含空白、没有斜杠、只有斜杠都回原因', () => {
    expect(commandNameProblem('/帮助')).toContain('保留命令')
    expect(commandNameProblem('/状态')).toContain('保留命令')
    expect(commandNameProblem('/新会话')).toContain('保留命令')
    expect(commandNameProblem('/一二三四五六七八九')).toContain('太长')
    expect(commandNameProblem(`/${'a'.repeat(17)}`)).toContain('太长')
    expect(commandNameProblem('/a　b')).toContain('不能含空白')
    expect(commandNameProblem('mmc')).toContain('要以 / 开头')
    expect(commandNameProblem('/')).toContain('后面要有名字')
  })
})

describe('splitForSend', () => {
  it('短文本原样单段', () => {
    expect(splitForSend('做完了', 700)).toEqual(['做完了'])
  })

  it('按行累积，放不下出一段，多段加序号标记', () => {
    const line = 'a'.repeat(40)
    const segments = splitForSend(`${line}\n${line}\n${line}`, 100)
    expect(segments.length).toBe(2)
    expect(segments[0]).toBe(`(1/2) ${line}\n${line}`)
    expect(segments[1]).toBe(`(2/2) ${line}`)
  })

  it('单行超长按字符硬切', () => {
    const segments = splitForSend('x'.repeat(250), 100)
    expect(segments).toEqual(['(1/3) ' + 'x'.repeat(100), '(2/3) ' + 'x'.repeat(100), '(3/3) ' + 'x'.repeat(50)])
  })
})

describe('tailExcerpt', () => {
  it('不超长原样返回', () => {
    expect(tailExcerpt('短文本', 100)).toBe('短文本')
  })

  it('超长只留末尾并注明省略字数', () => {
    const excerpt = tailExcerpt('a'.repeat(300), 100)
    expect(excerpt).toBe(`……（前面省略 200 字）\n${'a'.repeat(100)}`)
  })
})
