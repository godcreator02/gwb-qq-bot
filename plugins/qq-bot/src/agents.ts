/** QQ 对话自己的接口；原生软件操作由对应插件完成。 */
import { isRecord } from './qq-protocol.js'

export type CommandResult = { ok: boolean; data?: unknown; error?: string }
export type RunCommand = (name: string, args: Record<string, unknown>) => Promise<CommandResult>
export interface AgentAdapter {
  id: string
  title: string
  submit(input: { workspace: string; sessionRef: string | null; prompt: string }): Promise<{ sessionRef: string }>
  inspect(input: { workspace: string; sessionRef: string }): Promise<string>
}

export function zcodeAdapter(run: RunCommand): AgentAdapter {
  return {
    id: 'zcode', title: 'ZCode',
    async submit({ workspace, sessionRef, prompt }) {
      const result = await run(sessionRef === null ? 'zcode.create' : 'zcode.send', {
        workspace, prompt, ...(sessionRef === null ? {} : { task: sessionRef }),
      })
      if (!result.ok || !isRecord(result.data) || typeof result.data.taskId !== 'string' || result.data.taskId.trim() === '' || (sessionRef !== null && result.data.taskId !== sessionRef)) {
        throw new Error('ZCode 未确认本次派单；请核对原生会话，不要重发任务')
      }
      return { sessionRef: result.data.taskId }
    },
    async inspect({ workspace, sessionRef }) {
      const result = await run('zcode.status', { workspace, task: sessionRef, waitSeconds: 0, replyTailChars: 600 })
      if (!result.ok || !isRecord(result.data)) throw new Error('ZCode 状态暂不可用')
      const replies = Array.isArray(result.data.replies) ? result.data.replies.filter((text): text is string => typeof text === 'string') : []
      return `${String(result.data.status ?? '未知')}\n${replies.at(-1) ?? ''}`
    },
  }
}

export function claudecodeAdapter(run: RunCommand): AgentAdapter {
  return {
    id: 'claudecode', title: 'Claude Code',
    async submit({ workspace, sessionRef, prompt }) {
      const result = await run(sessionRef === null ? 'claudecode.create' : 'claudecode.send', {
        workspace, prompt, ...(sessionRef === null ? {} : { sessionId: sessionRef }),
      })
      if (!result.ok || !isRecord(result.data) || typeof result.data.sessionId !== 'string' || result.data.sessionId.trim() === '' || (sessionRef !== null && result.data.sessionId !== sessionRef)) throw new Error('Claude Code 未确认本次派单')
      return { sessionRef: result.data.sessionId }
    },
    async inspect({ workspace, sessionRef }) {
      const result = await run('claudecode.status', { workspace, sessionId: sessionRef })
      if (!result.ok || !isRecord(result.data)) throw new Error('Claude Code 状态暂不可用')
      return `${String(result.data.status ?? '未知')}\n${typeof result.data.text === 'string' ? result.data.text : ''}`
    },
  }
}
