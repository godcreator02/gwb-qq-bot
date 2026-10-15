import { afterEach, describe, expect, it, vi } from 'vitest'
import { QqApiError, QqRestClient } from '../src/qq/qq-rest.js'

afterEach(() => vi.unstubAllGlobals())

describe('QQ 官方 REST 请求', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  it('重连后旧鉴权请求晚返回，不覆盖新凭据的 token 缓存', async () => {
    let finishOld!: (response: Response) => void
    let secret = 'old'
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      if (String(init.body).includes('old')) return new Promise<Response>(resolve => { finishOld = resolve })
      return Response.json({ access_token: 'new-token', expires_in: 7200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const rest = new QqRestClient(() => 'app', () => secret, () => false, log)
    const old = rest.getAccessToken()
    rest.resetAuth(); secret = 'new'
    expect(await rest.getAccessToken()).toBe('new-token')
    finishOld(Response.json({ access_token: 'old-token', expires_in: 7200 }))
    await old
    expect(await rest.getAccessToken()).toBe('new-token')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('私聊发原生 markdown，携带被动回复字段', async () => {
    const requests: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      return Response.json(url.endsWith('/app/getAppAccessToken')
        ? { access_token: 'test-token', expires_in: '7200' }
        : { id: 'reply-id' })
    }))
    const rest = new QqRestClient(() => 'test-app', () => 'test-secret', () => false, log)
    await rest.sendC2c('test-user', { content: 'hello', msgId: 'incoming', msgSeq: 3 })
    expect(requests[0]?.url).toBe('https://api.bot.qq.com/app/getAppAccessToken')
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({ appId: 'test-app', clientSecret: 'test-secret' })
    expect(requests[1]?.url).toBe('https://api.bot.qq.com/v2/users/test-user/messages')
    expect(requests[1]?.init.headers).toMatchObject({ Authorization: 'QQBot test-token' })
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual({ msg_type: 2, markdown: { content: 'hello' }, msg_id: 'incoming', msg_seq: 3 })
  })

  it.each(['err_code', 'code'])('保留官方 %s 错误码', async (field) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/app/getAppAccessToken')
      ? { access_token: 'test-token', expires_in: 7200 }
      : { [field]: 40034005, message: 'expired' }, { status: url.endsWith('/app/getAppAccessToken') ? 200 : 400 })))
    const rest = new QqRestClient(() => 'app', () => 'secret', () => false, log)
    expect(await rest.sendC2c('user', { content: 'hi', msgId: 'old', msgSeq: 1 }))
      .toMatchObject({ ok: false, code: 40034005, status: 400 })
  })

  it('指令面板接口：请求路径与请求体照官方文档，回执在入口校验形状', async () => {
    const requests: { url: string; method: string; body: unknown }[] = []
    const replies: Record<string, unknown> = {
      'GET /v2/panels?scope=c2c&limit=50': { records: [{ panel_id: 'p1', scope: 'c2c', target_type: 'specific', panel: { items: [{ name: '/mmc', desc: '样机', type: 'command', only_admin: false, link: '' }], remark: 'gwb-qq-bot 自动同步', version: 1 }, version: 1 }], next_cursor: '', is_end: true },
      'POST /v2/panels': { panel_id: 'p2' },
      'GET /v2/panels/p1': { panel_id: 'p1', scope: 'c2c', target_type: 'specific', panel: {}, user_openids: ['u1'] },
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 'test-token', expires_in: 7200 })
      const key = `${init.method} ${url.replace('https://api.bot.qq.com', '')}`
      requests.push({ url: key, method: String(init.method), body: init.body === undefined ? undefined : JSON.parse(String(init.body)) })
      return Response.json(replies[key] ?? {})
    }))
    const rest = new QqRestClient(() => 'app', () => 'secret', () => false, log)
    const panel = { items: [{ name: '/mmc', desc: '样机', type: 'command' }], remark: 'gwb-qq-bot 自动同步' }
    expect(await rest.listC2cPanels('')).toEqual({ records: [{ panelId: 'p1', targetType: 'specific', remark: 'gwb-qq-bot 自动同步', items: [{ name: '/mmc', desc: '样机', type: 'command' }] }], nextCursor: '', isEnd: true })
    expect(await rest.createC2cPanel(panel, ['u1'])).toBe('p2')
    await rest.updatePanel('p1', panel)
    expect(await rest.panelOpenids('p1')).toEqual(['u1'])
    await rest.changePanelTargets('p1', 'del', ['u1'])
    await rest.deletePanel('p1')
    expect(requests.map(({ url, body }) => [url, body])).toEqual([
      ['GET /v2/panels?scope=c2c&limit=50', undefined],
      ['POST /v2/panels', { scope: 'c2c', target_type: 'specific', user_openids: ['u1'], panel }],
      ['PUT /v2/panels/p1', { panel }],
      ['GET /v2/panels/p1', undefined],
      ['PUT /v2/panels/p1/target', { op: 'del', user_openids: ['u1'] }],
      ['DELETE /v2/panels/p1', undefined],
    ])
  })

  it('指令面板接口失败抛 QqApiError，带官方错误码；回执形状不对报错', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 'test-token', expires_in: 7200 })
      if (url.includes('/v2/panels?')) return Response.json({ records: 'oops' })
      return Response.json({ code: 40030009, message: '指令面板操作进行中' }, { status: 400 })
    }))
    const rest = new QqRestClient(() => 'app', () => 'secret', () => false, log)
    await expect(rest.updatePanel('p1', { items: [], remark: '' })).rejects.toMatchObject({ code: 40030009, message: 'PUT /v2/panels/p1 失败：HTTP 400 40030009 指令面板操作进行中' })
    await expect(rest.updatePanel('p1', { items: [], remark: '' })).rejects.toBeInstanceOf(QqApiError)
    await expect(rest.listC2cPanels('')).rejects.toThrow('GET /v2/panels?scope=c2c&limit=50 回执形状不对：{"records":"oops"}')
  })

  it('没有面板时官方只回 {"is_end":true}（实测）：按空列表读；records 不是数组、is_end 不是布尔值照旧报错带原文', async () => {
    const pages = [{ is_end: true }, { records: {}, is_end: true }, { records: [] }]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/app/getAppAccessToken')
      ? Response.json({ access_token: 'test-token', expires_in: 7200 })
      : Response.json(pages.shift())))
    const rest = new QqRestClient(() => 'app', () => 'secret', () => false, log)
    expect(await rest.listC2cPanels('')).toEqual({ records: [], nextCursor: '', isEnd: true })
    await expect(rest.listC2cPanels('')).rejects.toThrow('回执形状不对：{"records":{},"is_end":true}')
    await expect(rest.listC2cPanels('')).rejects.toThrow('回执形状不对：{"records":[]}')
  })

  it('指令面板回执形状不对时报错带上回执原文，超过 500 字截短', async () => {
    const replies: Record<string, unknown> = {
      'GET /v2/panels?scope=c2c&limit=50': { data: [], long: 'x'.repeat(600) },
      'POST /v2/panels': { id: 'p2' },
      'GET /v2/panels/p1': { user_openids: 'u1' },
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 'test-token', expires_in: 7200 })
      return Response.json(replies[`${init.method} ${url.replace('https://api.bot.qq.com', '')}`])
    }))
    const rest = new QqRestClient(() => 'app', () => 'secret', () => false, log)
    const listError = await rest.listC2cPanels('').then(() => null, (error: unknown) => error as Error)
    expect(listError?.message).toMatch(/^GET \/v2\/panels\?scope=c2c&limit=50 回执形状不对：\{"data":\[\],"long":"x+……（共 621 字，后面省略）$/)
    expect(listError?.message.split('：')[1]?.indexOf('……')).toBe(500)
    await expect(rest.createC2cPanel({ items: [], remark: '' }, ['u1'])).rejects.toThrow('POST /v2/panels 回执缺 panel_id：{"id":"p2"}')
    await expect(rest.panelOpenids('p1')).rejects.toThrow('GET /v2/panels/p1 回执的 user_openids 形状不对：{"user_openids":"u1"}')
  })

  it('HTTP 200 里业务 err_code 非零也判失败', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/app/getAppAccessToken')
      ? { access_token: 'test-token', expires_in: 7200 }
      : { err_code: 40034005, message: 'expired' })))
    const rest = new QqRestClient(() => 'app', () => 'secret', () => false, log)
    expect(await rest.sendC2c('user', { content: 'hi' })).toMatchObject({ ok: false, code: 40034005 })
  })
})
