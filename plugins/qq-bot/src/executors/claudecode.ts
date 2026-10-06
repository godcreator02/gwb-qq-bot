import type { GwbClaudecodeApi } from '@godcreator/gwb-claudecode'
import type { Executor } from './executor.js'

export function claudecodeExecutor(claudecode: GwbClaudecodeApi): Executor {
  return {
    id: 'claudecode',
    title: 'Claude Code',
    async start({ workspace, session, prompt }) {
      const started = session === null ? await claudecode.create({ workspace, prompt }) : await claudecode.send({ workspace, sessionId: session, prompt })
      return started.sessionId
    },
    async check({ workspace, session }) {
      const latest = await claudecode.status({ workspace, sessionId: session })
      return { over: latest.status !== 'running', reply: latest.text }
    },
  }
}
