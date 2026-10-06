import { describe, expect, it } from 'vitest'
import { loadBook, sourceId, workspaceKey, type Book, type SourceIdentity } from '../src/conversations.js'

const owner = { home: 'bot-a', appId: 'app-a' }
const origin: SourceIdentity = { ...owner, scene: 'group', target: 'group-a' }
const now = Date.parse('2026-10-06T02:00:00.000Z')
const sourceKey = sourceId(origin)

function current(): Book {
  return {
    version: 3,
    sources: [{ ...origin, id: sourceKey, generation: 1, lastSeen: new Date(now).toISOString(), lastSender: 'human', binding: { agent: 'zcode', kind: 'project', workspace: 'D:/project', projectRepo: 'owner/project', title: '项目', journalLibrary: '' } }],
    conversations: [{ agent: 'zcode', id: 'conversation', sourceId: sourceKey, generation: 1, workspace: 'D:/project', taskId: 'task', roundIndex: 1, latest: 'job' }],
    jobs: [{ agent: 'zcode', ticketHash: 'a'.repeat(64), dispatch: 'accepted', id: 'job', openid: 'human', sourceId: sourceKey, conversationId: 'conversation', taskId: 'task', workspace: 'D:/project', round: 1, route: { appId: owner.appId, scene: origin.scene, target: origin.target, trigger: { msgId: 'message', receivedAt: now, repliesSent: 1 } }, source: { ...origin, senderOpenid: 'human', senderIsBot: false, projectRepo: 'owner/project', title: '项目', journalLibrary: '' }, prompt: '做一件事', reportServer: 'gwb', state: 'pending', text: null, delivery: 'pending' }],
    seen: ['message-key'], notices: [{ id: 'notice', appId: owner.appId, target: 'human', text: '通知', state: 'delivered' }],
  }
}

describe('来源标识与工作区归一', () => {
  it('完整身份稳定编码，home/app/scene/target 任一变化都会隔离；分隔字符不会碰撞', () => {
    expect(sourceId({ target: origin.target, scene: origin.scene, appId: origin.appId, home: origin.home })).toBe(sourceKey)
    const keys = [origin, { ...origin, home: 'bot-b' }, { ...origin, appId: 'app-b' }, { ...origin, scene: 'c2c' as const }, { ...origin, target: 'group-b' }].map(sourceId)
    expect(new Set(keys).size).toBe(keys.length)
    expect(sourceId({ ...origin, home: 'a:b', appId: 'c' })).not.toBe(sourceId({ ...origin, home: 'a', appId: 'b:c' }))
  })
  it('Windows 大小写、分隔符、尾斜杠和 . / .. 归一，但不混淆不同根路径', () => {
    expect(workspaceKey('D:/Project/sub/../')).toBe(workspaceKey('d:\\project'))
    expect(workspaceKey('D:\\Project\\.\\')).toBe(workspaceKey('d:/project'))
    expect(workspaceKey('\\\\SERVER\\Share\\Project\\')).toBe(workspaceKey('//server/share/project'))
    expect(workspaceKey('D:/')).toBe('d:\\')
    expect(workspaceKey('D:')).not.toBe(workspaceKey('D:/'))
    expect(workspaceKey('')).toBe('')
  })
})

describe('旧账本隔离', () => {
  it.each([1, 2])('拒绝旧版本 %s，不复用回报凭证', (version) => {
    expect(() => loadBook({ ...current(), version }, owner)).toThrow('version')
  })
})

describe('v3 持久化边界', () => {
  it('未配置 AppID 的新安装可加载空账本；已有 v1/v2 数据仍拒绝猜身份', () => {
    const unconfigured = { ...owner, appId: '' }
    const empty = loadBook(undefined, unconfigured)
    expect(empty).toEqual(loadBook(undefined, owner))
    expect(loadBook(empty, unconfigured)).toEqual(empty)
    expect(() => loadBook(current(), unconfigured)).toThrow('identity.appId')
    expect(() => loadBook({ version: 1, sessions: [], jobs: [], seen: [], notices: [] }, unconfigured)).toThrow('version')
  })
  it('仅 undefined 表示新存储；每次返回独立空对象', () => {
    const first = loadBook(undefined, owner)
    first.seen.push('mutated')
    expect(loadBook(undefined, owner).seen).toEqual([])
    expect(() => loadBook(null, owner)).toThrow('格式不正确')
    expect(() => loadBook({}, owner)).toThrow('格式不正确')
    expect(() => loadBook({ ...current(), version: 4 }, owner)).toThrow('格式不正确')
  })
  it('读回所有层并返回新对象；当前机器人变化不篡改历史身份', () => {
    const raw = current()
    const book = loadBook(raw, { home: 'other-home', appId: 'other-app' })
    expect(book).toEqual(raw)
    book.jobs[0]!.route.target = 'changed-in-memory'
    book.sources[0]!.binding!.journalLibrary = 'other-library'
    expect(raw.jobs[0]!.route.target).toBe('group-a')
    expect(raw.sources[0]!.binding!.journalLibrary).toBe('')
  })
  it.each(['sources', 'conversations', 'jobs', 'seen', 'notices'] as const)('拒绝缺少 %s 数组的记录', (key) => {
    const raw = current() as unknown as Record<string, unknown>
    delete raw[key]
    expect(() => loadBook(raw, owner)).toThrow('格式不正确')
  })
  it.each([
    ['来源哈希不匹配', (raw: Book) => { raw.sources[0]!.target = 'another-group' }],
    ['非法消息场景', (raw: Book) => { (raw.jobs[0]!.route as unknown as Record<string, unknown>).scene = 'guild' }],
    ['触发时间无效', (raw: Book) => { raw.jobs[0]!.route.trigger.receivedAt = Number.NaN }],
    ['机器人字段不为 boolean', (raw: Book) => { (raw.jobs[0]!.source as unknown as Record<string, unknown>).senderIsBot = 'false' }],
    ['任务场景与来源不一致', (raw: Book) => { raw.jobs[0]!.route.scene = 'c2c' }],
    ['任务发送人不匹配', (raw: Book) => { raw.jobs[0]!.openid = 'stranger' }],
    ['未知任务状态', (raw: Book) => { (raw.jobs[0] as unknown as Record<string, unknown>).state = 'done' }],
    ['回报状态缺少正文', (raw: Book) => { raw.jobs[0]!.state = 'completed' }],
    ['重复任务 ID', (raw: Book) => { raw.jobs.push(structuredClone(raw.jobs[0]!)) }],
    ['重复来源 ID', (raw: Book) => { raw.sources.push(structuredClone(raw.sources[0]!)) }],
    ['重复会话 ID', (raw: Book) => { raw.conversations.push(structuredClone(raw.conversations[0]!)) }],
    ['不存在的来源引用', (raw: Book) => { raw.sources = [] }],
    ['不存在的会话引用', (raw: Book) => { raw.jobs[0]!.conversationId = 'missing' }],
    ['不存在的最新任务引用', (raw: Book) => { raw.conversations[0]!.latest = 'missing' }],
    ['会话工作区不一致', (raw: Book) => { raw.jobs[0]!.workspace = 'D:/elsewhere' }],
    ['任务轮次超过会话', (raw: Book) => { raw.jobs[0]!.round = 2 }],
    ['会话代数超过来源', (raw: Book) => { raw.conversations[0]!.generation = 2 }],
    ['项目绑定缺少仓库', (raw: Book) => { raw.sources[0]!.binding!.projectRepo = null }],
  ])('拒绝%s', (_name, mutate) => {
    const raw = current()
    mutate(raw)
    expect(() => loadBook(raw, owner)).toThrow('格式不正确')
  })
})
