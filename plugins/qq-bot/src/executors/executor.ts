/**
 * qq-bot 的执行端适配层：接口按 qq-bot 自己要的两件事定，每个执行端一份实现。
 * 实现在对应的执行端服务出现时登记、消失时撤掉；接口私有，不与别的应用统一。
 */
export interface Executor {
  /** 聊天绑定里存的执行端名 */
  id: string
  /** 回给人看的名字 */
  title: string
  /** 开一轮：session 为空就新建会话；交回会话号 */
  start(input: { workspace: string; session: string | null; prompt: string }): Promise<string>
  /** 问一次这一轮做完没有；reply 是最后的回答（可能只有末尾一段） */
  check(input: { workspace: string; session: string }): Promise<{ over: boolean; reply: string }>
}

export class ExecutorTable {
  private readonly executors = new Map<string, Executor>()

  /** 回撤掉它的函数，给 ctx.effect 用 */
  register(executor: Executor): () => void {
    this.executors.set(executor.id, executor)
    return () => {
      if (this.executors.get(executor.id) === executor) this.executors.delete(executor.id)
    }
  }

  has(id: string): boolean {
    return this.executors.has(id)
  }

  get(id: string): Executor {
    const executor = this.executors.get(id)
    if (executor === undefined) throw new Error(`没装执行端 ${id}（插件 gwb-${id}），装上之后再派`)
    return executor
  }

  ids(): string[] {
    return [...this.executors.keys()]
  }
}
