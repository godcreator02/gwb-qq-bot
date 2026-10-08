/**
 * docfirst 配置：命令行和站读的是同一份。项目根是这个站目录，被引用的代码在仓根，引用写 `../src/…`。
 *
 * content 是各区的上一级目录。它下面只有两个名字是固定的：`trajectory/` 是轨迹卡目录，
 * `future/` 是未来区（路线、在途方案 `future/spec/`、别的仓投来的反馈 `future/inbox/`）。
 * 其余目录都是现状区，全部进 check；本站预置的现状区是 `content/docs/`。
 *
 * outputs 把正本映射到生成物：仓根 README.md / AGENTS.md / CLAUDE.md 由 `content/docs/outputs/` 下的
 * 三份 mdx 生成。改正本后运行 `pnpm doc:render`，正本与生成物放进同一个提交，check 检查两者一致。
 * 要保留 frontmatter 字段的生成物（比如 SKILL.md），目标写成对象：
 *   'content/docs/outputs/skills/x.mdx': [{ to: '../skills/x/SKILL.md', frontmatter: ['name', 'description'] }]
 *
 * components 是组件名册，fumadocsRoster 给 fumadocs 自带文件树 Files / Folder / File 与 Note 的机读规则，
 * 站里自己加的组件在它后面追加。
 */
import { fumadocsRoster } from '@godcreator/docfirst-workflow/fumadocs/roster'
import { MessageRouting as messageRoutingRule } from './src/components/message-routing/message-routing.ai.mjs'
import { SeamMap as seamMapRule } from './src/components/seam-map/seam-map.ai.mjs'

export default {
  content: 'content',
  outputs: {
    'content/docs/outputs/readme.mdx': ['../README.md'],
    'content/docs/outputs/agents.mdx': ['../AGENTS.md'],
    'content/docs/outputs/claude.mdx': ['../CLAUDE.md'],
    'content/docs/outputs/skills/qq-bot.mdx': [
      { to: '../plugins/qq-bot/skills/qq-bot/SKILL.md', frontmatter: ['name', 'description'] },
    ],
  },
  components: {
    ...fumadocsRoster,
    SeamMap: seamMapRule,
    MessageRouting: messageRoutingRule,
  },
}
