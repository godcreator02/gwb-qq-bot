import { describe, expect, it } from 'vitest'
import { matchCommand, normalizeIncoming, splitForSend, tailExcerpt } from '../src/routing.js'

describe('normalizeIncoming', () => {
  it('剥掉群消息开头的 @ 占位', () => {
    expect(normalizeIncoming('<@!1234567890> 帮我看看这个仓的测试为什么挂')).toBe('帮我看看这个仓的测试为什么挂')
    expect(normalizeIncoming('<@1234567890>/状态')).toBe('/状态')
  })

  it('占位后没有内容时得到空串', () => {
    expect(normalizeIncoming('<@!1234567890>   ')).toBe('')
    expect(normalizeIncoming('')).toBe('')
  })

  it('正文里出现的 @ 与尖括号原样保留，换行统一', () => {
    expect(normalizeIncoming('查一下 <@!000> 这个标识')).toBe('查一下 <@!000> 这个标识')
    expect(normalizeIncoming('第一行\r\n第二行')).toBe('第一行\n第二行')
  })
})

describe('matchCommand', () => {
  it('整条精确匹配才算指令', () => {
    expect(matchCommand('/帮助')).toBe('help')
    expect(matchCommand('/状态')).toBe('status')
    expect(matchCommand('/新会话')).toBe('fresh-session')
  })

  it('其余文本一律不是指令（包括以 / 开头的任务文本）', () => {
    expect(matchCommand('/帮助一下')).toBeNull()
    expect(matchCommand('帮我把 /帮助 写进文档')).toBeNull()
    expect(matchCommand('')).toBeNull()
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
