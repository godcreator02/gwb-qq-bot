import type { GwbZcodeApi } from '@godcreator/gwb-zcode'
import type { Executor } from './executor.js'

/** 回答里混着工具调用记录，一条能有几万字；收尾的话在末尾，只取这么多 */
const REPLY_TAIL_CHARS = 600

export function zcodeExecutor(zcode: GwbZcodeApi): Executor {
  return {
    id: 'zcode',
    title: 'ZCode',
    async start({ workspace, session, prompt }) {
      const sent = session === null ? await zcode.create({ workspace, prompt }) : await zcode.send({ workspace, task: session, prompt })
      return sent.taskId
    },
    async check({ workspace, session }) {
      const round = await zcode.status({ workspace, task: session, replyTailChars: REPLY_TAIL_CHARS })
      return { over: round.roundIsOver, reply: round.replies.at(-1) ?? '' }
    },
  }
}
