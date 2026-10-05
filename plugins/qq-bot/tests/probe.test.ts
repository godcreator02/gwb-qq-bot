import { describe, expect, it } from 'vitest'
import { countProbeContent, DEFAULT_PROBE_CHARS, lengthProbeContent, parseProbeArgs } from '../src/probe.js'

describe('parseProbeArgs', () => {
  it('缺省值：sends 6，chars 是 680/700 相邻的梯度', () => {
    expect(parseProbeArgs({ experiment: 'count' })).toEqual({ experiment: 'count', sends: 6, chars: DEFAULT_PROBE_CHARS })
    expect(DEFAULT_PROBE_CHARS).toContain(680)
    expect(DEFAULT_PROBE_CHARS).toContain(700)
  })

  it('experiment 只收 count 或 length', () => {
    expect(() => parseProbeArgs({ experiment: 'x' })).toThrow('count 或 length')
    expect(() => parseProbeArgs({})).toThrow()
  })

  it('不认识的参数直接报错', () => {
    expect(() => parseProbeArgs({ experiment: 'count', foo: 1 })).toThrow('不认识参数 foo')
  })

  it('sends 与 chars 的范围校验', () => {
    expect(() => parseProbeArgs({ experiment: 'count', sends: 0 })).toThrow('sends')
    expect(() => parseProbeArgs({ experiment: 'count', sends: 11 })).toThrow('sends')
    expect(() => parseProbeArgs({ experiment: 'length', chars: [100, 0] })).toThrow('chars')
    expect(() => parseProbeArgs({ experiment: 'length', chars: [5001] })).toThrow('chars')
    expect(parseProbeArgs({ experiment: 'length', chars: [100, 200] }).chars).toEqual([100, 200])
  })
})

describe('实验消息内容', () => {
  it('count 消息带序号与 msg_seq', () => {
    expect(countProbeContent(1, 6, 3)).toContain('msg_seq=3')
    expect(countProbeContent(1, 6, 3)).toContain('1/6')
  })

  it('length 消息按字符数补足到目标长度', () => {
    expect(lengthProbeContent(100).length).toBe(100)
    expect(lengthProbeContent(600).length).toBe(600)
    expect(lengthProbeContent(5)).toBe('L5：测测')
  })
})
