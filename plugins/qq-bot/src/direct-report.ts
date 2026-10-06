import { createHash, randomBytes } from 'node:crypto'
import { isRecord } from './qq-protocol.js'

export type ReportState = 'completed' | 'failed' | 'needs_input'
export interface DirectReport { ticket: string; state: ReportState; text: string }
export const ticketHash = (ticket: string): string => createHash('sha256').update(ticket).digest('hex')
export const issueTicket = (): string => randomBytes(32).toString('hex')

export function parseReport(raw: unknown): DirectReport {
  if (!isRecord(raw) || Object.keys(raw).some((key) => !['ticket', 'state', 'text'].includes(key)) ||
    typeof raw.ticket !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.ticket) ||
    !['completed', 'failed', 'needs_input'].includes(String(raw.state)) ||
    typeof raw.text !== 'string' || raw.text.trim() === '' || raw.text.length > 16000) throw new Error('回报参数应为 {ticket,state:completed|failed|needs_input,text:1~16000字符}')
  if (raw.text.includes(raw.ticket)) throw new Error('回报正文不能包含回报凭证')
  return { ticket: raw.ticket, state: raw.state as ReportState, text: raw.text }
}

export function reportInstruction(ticket: string, server: string): string {
  return `\n\n[QQ 本轮回报约定]\n${JSON.stringify({ server, command: 'qq-bot.report', ticket })}\n最终答复前，经上面指定的 MCP 服务调用 run，command 为 qq-bot.report，args 为 {ticket,state,text}。state 只能是 completed、failed 或 needs_input；text 为真实结果摘要，最多16000字符。需要人补充信息时回 needs_input，不假称完成。回执 recorded:true 才表示 QQ 已保存，delivery 是独立送达状态。调用超时或未确认时，用同一 ticket、state、text 重试回报，不重做任务、不换票、不修改结果。凭证仅用于本轮回报，不写入结果正文、QQ、笔记或仓库。禁止调用 zcode.report 或让其他机器人转交结果。`
}
