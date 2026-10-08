/** 单聊指令面板里放哪些命令、按什么顺序；官方的上限由 qq/command-panel.ts 的 planPanelItems 套 */
import type { PanelCandidate } from '../qq/command-panel.js'
import { COMMAND_FRESH_SESSION, COMMAND_HELP, COMMAND_STATUS } from './routing.js'

const RESERVED_PANEL_ENTRIES: readonly PanelCandidate[] = [
  { command: COMMAND_FRESH_SESSION, description: '下一条起开新会话，可跟组名' },
  { command: COMMAND_STATUS, description: '补发结果，或看各组在做什么' },
  { command: COMMAND_HELP, description: '列出全部指令' },
]

/** 任务组（命令登记的在前，称呼作说明）→ 直接命令（它的说明）→ 保留命令；默认组没有命令，不进面板 */
export function commandPanelCandidates(
  taskGroups: { command: string; title: string }[],
  directCommands: { command: string; description: string }[],
): PanelCandidate[] {
  return [
    ...taskGroups.map(({ command, title }) => ({ command, description: title })),
    ...directCommands.map(({ command, description }) => ({ command, description })),
    ...RESERVED_PANEL_ENTRIES,
  ]
}
