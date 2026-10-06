/**
 * 服务 ctx.gwbQqBot：经 QQ 机器人主动私聊这台机器的主人。要用就 inject `gwbQqBot`（可有可无时用 ctx.inject）。
 * 主人是设置 owner-openid，必须也在 allowed-openids 里；没配好时直接报错。
 */
export interface GwbQqBotApi {
  /**
   * 发一条主动私聊。同一个 id 只发一次：再调回 duplicate，内容不同直接报错；发不出去（频控、主人关了主动消息）回 delivered: false，不重发。
   * text 1–600 字
   */
  notify(id: string, text: string): Promise<{ delivered: boolean; duplicate: boolean }>
}
