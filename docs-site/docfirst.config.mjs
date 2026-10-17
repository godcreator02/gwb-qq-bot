/**
 * docfirst 配置：命令行和站读的是同一份。项目根是这个站目录，被引用的代码在仓根，引用写 `../src/…`。
 *
 * content 是各区的上一级目录。它下面的 `future/` 是未来区（路线、在途方案），不进核对；其余目录都是现状区，
 * 全部进 check。轨迹卡不在 content 里：放在站点根的 `trajectory/`，站点的卡集合（app/features/trajectory/mdx.ts）
 * 读同一个目录。
 *
 * outputs 把正本映射到生成物：仓根 README.md / AGENTS.md / CLAUDE.md 由 `content/docs/outputs/` 下的
 * 三份 mdx 生成，随包 SKILL.md 由 skills/ 下的两份生成。改正本后运行 `pnpm doc:render`，正本与生成物
 * 放进同一个提交，check 检查两者一致。要保留 frontmatter 字段的生成物（SKILL.md），目标写成对象：
 *   'content/docs/outputs/skills/x.mdx': [{ to: '../skills/x/SKILL.md', frontmatter: ['name', 'description'] }]
 *
 * fumadocsRoster 与 components 是组件名册：render 把生成正本里的组件换成这里给的机读文字。
 * fumadocsRoster 给 fumadocs 自带 Note、Files、Folder、File 的规则；站里生成正本用到的组件只有
 * RegistrationLife（qq-bot-plugin-api 正本里那段结论，规则在组件旁的 registration-life.ai.mjs）。
 * 术语表不在这里：它是站点根的 glossary.json（本站为空，术语页是手写页面，不用术语标注）。
 */
import { RegistrationLife as registrationLifeRule } from './content/docs/outputs/skills/qq-bot-plugin-api/registration-life.ai.mjs'

export default {
  content: 'content',
  outputs: {
    'content/docs/outputs/readme.mdx': ['../README.md'],
    'content/docs/outputs/agents.mdx': ['../AGENTS.md'],
    'content/docs/outputs/claude.mdx': ['../CLAUDE.md'],
    'content/docs/outputs/skills/qq-bot.mdx': [
      { to: '../plugins/qq-bot/skills/qq-bot/SKILL.md', frontmatter: ['name', 'description'] },
    ],
    'content/docs/outputs/skills/qq-bot-plugin-api.mdx': [
      { to: '../plugins/qq-bot/skills/qq-bot-plugin-api/SKILL.md', frontmatter: ['name', 'description'] },
    ],
  },
  fumadocsRoster: true,
  components: {
    Term: 'children',
    RegistrationLife: registrationLifeRule,
  },
  trajectory: 'trajectory',
}
