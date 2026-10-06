/** REST 侧：access token 的取用与刷新、发送消息、查网关地址。凭据与沙箱开关经函数每次现读，改设置后重连即生效 */

import { isRecord, type QqLog } from './qq-protocol.js'

/** 换 access token 的端点不分沙箱与正式环境 */
const TOKEN_URL = 'https://api.bot.qq.com/app/getAppAccessToken'
const SANDBOX_API_BASE = 'https://sandbox.api.sgroup.qq.com'
const PRODUCTION_API_BASE = 'https://api.bot.qq.com'

/** 提前这么多毫秒刷新，避免拿着临期 token 发请求 */
const TOKEN_REFRESH_LEAD_MS = 120_000

export interface SendMessageBody {
  content: string
  /** 被动回复带 msgId 与递增的 msgSeq；主动消息不带 */
  msgId?: string
  msgSeq?: number
  /** 引用的消息 id：QQ 里显示成引用那条消息 */
  quote?: string
}

export type SendOutcome = { ok: true; id: string } | { ok: false; status: number; code?: number; message: string }

export class QqRestClient {
  private token: string | null = null
  private tokenExpiresAt = 0
  private tokenFetch: Promise<string> | null = null
  private tokenEpoch = 0

  constructor(
    private readonly appId: () => string,
    private readonly appSecret: () => string,
    private readonly sandbox: () => boolean,
    private readonly log: QqLog,
  ) {}

  private apiBase(): string {
    return this.sandbox() ? SANDBOX_API_BASE : PRODUCTION_API_BASE
  }

  /** 显式重连时重新读取凭据；旧请求即使晚返回也不能覆盖新缓存。 */
  resetAuth(): void {
    this.tokenEpoch++
    this.token = null
    this.tokenExpiresAt = 0
    this.tokenFetch = null
  }

  async getAccessToken(): Promise<string> {
    if (this.token !== null && this.tokenExpiresAt > Date.now() + TOKEN_REFRESH_LEAD_MS) return this.token
    if (this.tokenFetch === null) {
      const pending = this.fetchAccessToken(this.tokenEpoch).finally(() => {
        if (this.tokenFetch === pending) this.tokenFetch = null
      })
      this.tokenFetch = pending
    }
    return this.tokenFetch
  }

  private async fetchAccessToken(epoch: number): Promise<string> {
    const appId = this.appId()
    const appSecret = this.appSecret()
    if (appId === '' || appSecret === '') throw new Error('QQ 机器人的 app-id 或 app-secret 没配置，拿不到 access token')
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, clientSecret: appSecret }),
    })
    const body: unknown = await response.json().catch(() => null)
    const token = isRecord(body) && typeof body['access_token'] === 'string' ? body['access_token'] : null
    // 官方回的 expires_in 是数字字符串（如 "5787"），两种都收
    const rawExpiresIn = isRecord(body) ? body['expires_in'] : null
    const expiresIn =
      typeof rawExpiresIn === 'number'
        ? rawExpiresIn
        : typeof rawExpiresIn === 'string' && rawExpiresIn !== '' && Number.isFinite(Number(rawExpiresIn))
          ? Number(rawExpiresIn)
          : null
    // 回执里带 access_token，不能整个进日志
    if (!response.ok || token === null || expiresIn === null) {
      throw new Error(`拿 access token 失败：HTTP ${response.status}，回执缺 access_token 或 expires_in（code=${String(isRecord(body) ? body['code'] : null)}）`)
    }
    if (epoch === this.tokenEpoch) {
      this.token = token
      this.tokenExpiresAt = Date.now() + expiresIn * 1000
    }
    return token
  }

  async fetchGatewayUrl(): Promise<string> {
    const body = await this.getJson('/gateway')
    const url = isRecord(body) && typeof body['url'] === 'string' ? body['url'] : null
    if (url === null) throw new Error(`/gateway 回执形状不对：${JSON.stringify(body)}`)
    return url
  }

  async sendC2c(openid: string, body: SendMessageBody): Promise<SendOutcome> {
    return this.postSend(`/v2/users/${openid}/messages`, body)
  }

  async fetchGroupSelfId(groupOpenid: string): Promise<string> {
    const body = await this.getJson(`/v2/groups/${encodeURIComponent(groupOpenid)}/bot_state`)
    if (!isRecord(body) || typeof body['member_openid'] !== 'string' || body['member_openid'] === '') throw new Error('bot_state 回执缺 member_openid')
    return body['member_openid']
  }

  async sendGroup(groupOpenid: string, body: SendMessageBody): Promise<SendOutcome> {
    // QQ 的纯文本被动回复会自动加白色 @发送者；Markdown 仅显示实际正文。
    return this.postSend(`/v2/groups/${groupOpenid}/messages`, body, true)
  }

  private async postSend(path: string, body: SendMessageBody, markdown = false): Promise<SendOutcome> {
    const response = await this.request('POST', path, {
      ...(markdown ? { msg_type: 2, markdown: { content: body.content } } : { msg_type: 0, content: body.content }),
      msg_id: body.msgId,
      msg_seq: body.msgSeq,
      // 引用的消息取不到时照常发正文、只是不带引用：结果本身比引用要紧
      ...(body.quote === undefined ? {} : { message_reference: { message_id: body.quote, ignore_get_message_error: true } }),
    })
    if (!response.ok) {
      this.log.warn(`POST ${path} 失败：HTTP ${response.status} ${response.code ?? ''} ${response.message}`)
      return { ok: false, status: response.status, code: response.code, message: response.message }
    }
    const id = isRecord(response.body) ? response.body['id'] : undefined
    if (typeof id !== 'string') throw new Error(`${path} 回执缺 id`)
    return { ok: true, id }
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await this.request('GET', path, undefined)
    if (!response.ok) throw new Error(`GET ${path} 失败：HTTP ${response.status} ${response.message}`)
    return response.body
  }

  private async request(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
  ): Promise<{ ok: boolean; status: number; code?: number; message: string; body: unknown }> {
    const token = await this.getAccessToken()
    const raw = await fetch(this.apiBase() + path, {
      method,
      headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const parsed: unknown = await raw.json().catch(() => null)
    const message = isRecord(parsed) && typeof parsed['message'] === 'string' ? parsed['message'] : JSON.stringify(parsed)
    // 通用 API 使用 err_code；部分现网接口和鉴权接口仍返回 code。
    const code = isRecord(parsed)
      ? typeof parsed['err_code'] === 'number' ? parsed['err_code'] : typeof parsed['code'] === 'number' ? parsed['code'] : undefined
      : undefined
    return { ok: raw.ok && (code === undefined || code === 0), status: raw.status, code, message, body: parsed }
  }
}
