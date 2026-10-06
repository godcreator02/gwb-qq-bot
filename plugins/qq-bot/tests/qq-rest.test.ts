import { afterEach, describe, expect, it, vi } from 'vitest'
import { QqRestClient } from '../src/qq-rest.js'

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
  it('群聊 Markdown 避免平台自动白色 @ 前缀，私聊保留文本；均携带被动回复字段', async () => {
    const requests: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      return Response.json(url.endsWith('/app/getAppAccessToken')
        ? { access_token: 'test-token', expires_in: '7200' }
        : { id: 'reply-id' })
    }))
    const rest = new QqRestClient(() => 'test-app', () => 'test-secret', () => false, log)
    await rest.sendGroup('test-group', { content: 'hello', msgId: 'incoming', msgSeq: 2 })
    await rest.sendC2c('test-user', { content: 'hello', msgId: 'incoming', msgSeq: 3 })
    expect(requests[0]?.url).toBe('https://api.bot.qq.com/app/getAppAccessToken')
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({ appId: 'test-app', clientSecret: 'test-secret' })
    expect(requests[1]?.url).toBe('https://api.bot.qq.com/v2/groups/test-group/messages')
    expect(requests[2]?.url).toBe('https://api.bot.qq.com/v2/users/test-user/messages')
    expect(requests[1]?.init.headers).toMatchObject({ Authorization: 'QQBot test-token' })
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual({ msg_type: 2, markdown: { content: 'hello' }, msg_id: 'incoming', msg_seq: 2 })
    expect(JSON.parse(String(requests[2]?.init.body))).toEqual({ msg_type: 0, content: 'hello', msg_id: 'incoming', msg_seq: 3 })
  })

  it.each(['err_code', 'code'])('保留官方 %s 错误码', async (field) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/app/getAppAccessToken')
      ? { access_token: 'test-token', expires_in: 7200 }
      : { [field]: 40034005, message: 'expired' }, { status: url.endsWith('/app/getAppAccessToken') ? 200 : 400 })))
    const rest = new QqRestClient(() => 'app', () => 'secret', () => false, log)
    expect(await rest.sendGroup('group', { content: 'hi', msgId: 'old', msgSeq: 1 }))
      .toMatchObject({ ok: false, code: 40034005, status: 400 })
  })

  it('HTTP 200 里业务 err_code 非零也判失败', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/app/getAppAccessToken')
      ? { access_token: 'test-token', expires_in: 7200 }
      : { err_code: 40034005, message: 'expired' })))
    const rest = new QqRestClient(() => 'app', () => 'secret', () => false, log)
    expect(await rest.sendGroup('group', { content: 'hi' })).toMatchObject({ ok: false, code: 40034005 })
  })
})
