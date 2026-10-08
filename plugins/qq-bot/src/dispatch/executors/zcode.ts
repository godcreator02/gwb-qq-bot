import type { GwbZcodeApi } from '@godcreator/gwb-zcode'
import type { Executor } from './executor.js'

/** 回答里混着工具调用记录，一条能有几万字；收尾的话在末尾，只取这么多 */
const REPLY_TAIL_CHARS = 600

/** qq-bot 已经让 ZCode 打开过的工作区，记在聊天表里，只增不减 */
export interface ZcodeOpenedWorkspaces {
  has(workspace: string): boolean
  remember(workspace: string): Promise<void>
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)

/**
 * ZCode 侧栏的「项目」只列在 ZCode 里打开过的工作区，派到没打开过的工作区的会话在侧栏里看不见。
 * 每个工作区只在第一次派过去时 open 一次（会把窗口切过去），之后不再切；人后来在 ZCode 里移除了这个项目，不探测、不重开
 */
async function openWorkspaceInZcodeOnce(zcode: GwbZcodeApi, opened: ZcodeOpenedWorkspaces, workspace: string): Promise<void> {
  if (opened.has(workspace)) return
  try {
    await zcode.open({ workspace })
  } catch (error) {
    throw new Error(`让 ZCode 打开工作区 ${workspace} 失败，这一轮没有发出：${errorText(error)}`, { cause: error })
  }
  await opened.remember(workspace)
}

export function zcodeExecutor(zcode: GwbZcodeApi, opened: ZcodeOpenedWorkspaces): Executor {
  return {
    id: 'zcode',
    title: 'ZCode',
    async start({ workspace, session, prompt }) {
      await openWorkspaceInZcodeOnce(zcode, opened, workspace)
      const sent = session === null ? await zcode.create({ workspace, prompt }) : await zcode.send({ workspace, task: session, prompt })
      return sent.taskId
    },
    async check({ workspace, session }) {
      const round = await zcode.status({ workspace, task: session, replyTailChars: REPLY_TAIL_CHARS })
      return { over: round.roundIsOver, reply: round.replies.at(-1) ?? '' }
    },
  }
}
