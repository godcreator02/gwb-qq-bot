import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PluginCommandRegistry } from '../src/dispatch/command-registry.js'

const WORKSPACE = process.cwd()
const MMC = { command: '/mmc', title: '混合型 MMC 样机', workspace: WORKSPACE }
const BLOOD = { command: '/血糖', description: '查最近的血糖', handle: async () => '5.6' }
const fromCollab = { plugin: '@godcreator/gwb-collab', storedGroupCommands: [] }

describe('registerTaskGroup', () => {
  it('注册后能查到；交回的函数撤掉注册，同一个命令能再注册', () => {
    const registry = new PluginCommandRegistry()
    const unregister = registry.registerTaskGroup({ ...MMC, instructions: '先读 skill collab', idleHours: 2 }, fromCollab)
    expect(registry.group('/mmc')).toEqual({ definition: { ...MMC, instructions: '先读 skill collab', idleHours: 2 }, plugin: '@godcreator/gwb-collab' })
    expect(registry.holderOf('/mmc')).toBe('插件 @godcreator/gwb-collab 注册的任务组')
    unregister()
    expect(registry.group('/mmc')).toBeUndefined()
    expect(registry.allGroups()).toEqual([])
    expect(() => registry.registerTaskGroup(MMC, fromCollab)).not.toThrow()
  })

  it('撤掉旧的注册不会撤掉之后同名的新注册', () => {
    const registry = new PluginCommandRegistry()
    const unregisterOld = registry.registerTaskGroup(MMC, fromCollab)
    unregisterOld()
    registry.registerTaskGroup({ ...MMC, title: '新的' }, fromCollab)
    unregisterOld()
    expect(registry.group('/mmc')?.definition.title).toBe('新的')
  })

  it('命令名不合规则、重名、工作区不对、不认识的键（含已经删掉的 agent）都抛异常', () => {
    const registry = new PluginCommandRegistry()
    registry.registerTaskGroup(MMC, fromCollab)
    registry.registerCommand(BLOOD, { plugin: undefined, storedGroupCommands: [] })
    expect(() => registry.registerTaskGroup({ ...MMC, command: '/帮助' }, fromCollab)).toThrow('保留命令')
    expect(() => registry.registerTaskGroup(MMC, fromCollab)).toThrow('命令 /mmc 已经被插件 @godcreator/gwb-collab 注册的任务组占用')
    expect(() => registry.registerTaskGroup({ ...MMC, command: '/血糖' }, fromCollab)).toThrow('插件注册的直接命令')
    expect(() => registry.registerTaskGroup({ ...MMC, command: '/论文' }, { plugin: undefined, storedGroupCommands: ['/论文'] })).toThrow('命令登记的任务组')
    expect(() => registry.registerTaskGroup({ ...MMC, command: '/一二三四五六七八九' }, fromCollab)).toThrow('太长')
    expect(() => registry.registerTaskGroup({ ...MMC, command: '/m m' }, fromCollab)).toThrow('不能含空白')
    expect(() => registry.registerTaskGroup({ ...MMC, command: '/x', workspace: 'relative' }, fromCollab)).toThrow('绝对路径')
    expect(() => registry.registerTaskGroup({ ...MMC, command: '/x', workspace: path.join(WORKSPACE, 'no-such-dir') }, fromCollab)).toThrow('已存在目录')
    expect(() => registry.registerTaskGroup({ ...MMC, command: '/x', agent: 'codex' as never }, fromCollab)).toThrow('不认识参数 agent')
    expect(() => registry.registerTaskGroup({ ...MMC, command: '/x', idleHours: -1 }, fromCollab)).toThrow('idleHours 要是正数')
    expect(() => registry.registerTaskGroup({ ...MMC, command: '/x', collab: true } as never, fromCollab)).toThrow('不认识参数 collab')
  })
})

describe('registerCommand', () => {
  it('注册后能查到，撤掉后查不到；插件名取不到就不写', () => {
    const registry = new PluginCommandRegistry()
    const unregister = registry.registerCommand(BLOOD, { plugin: undefined, storedGroupCommands: [] })
    expect(registry.directCommand('/血糖')?.definition.description).toBe('查最近的血糖')
    expect(registry.holderOf('/血糖')).toBe('插件注册的直接命令')
    unregister()
    expect(registry.directCommand('/血糖')).toBeUndefined()
    expect(registry.holderOf('/血糖')).toBeNull()
  })

  it('保留字、重名、超长、含空白、handle 不是函数都抛异常', () => {
    const registry = new PluginCommandRegistry()
    registry.registerTaskGroup(MMC, fromCollab)
    expect(() => registry.registerCommand({ ...BLOOD, command: '/状态' }, fromCollab)).toThrow('保留命令')
    expect(() => registry.registerCommand({ ...BLOOD, command: '/mmc' }, fromCollab)).toThrow('已经被插件 @godcreator/gwb-collab 注册的任务组占用')
    expect(() => registry.registerCommand({ ...BLOOD, command: `/${'a'.repeat(17)}` }, fromCollab)).toThrow('太长')
    expect(() => registry.registerCommand({ ...BLOOD, command: '/血\n糖' }, fromCollab)).toThrow('不能含空白')
    expect(() => registry.registerCommand({ ...BLOOD, handle: '5.6' } as never, fromCollab)).toThrow('handle 要是函数')
  })
})
