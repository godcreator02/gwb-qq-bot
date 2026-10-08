/**
 * 名册的名单，站这一侧的正本。mdx.tsx 用它的类型要求 React 表一个不多一个不少；
 * scripts/verify-roster.mjs 核对 docfirst.config.mjs 里的机读规则表都在这份名单里。
 *
 * 组件写进页面前先登记在这里，否则站渲染报 Expected component；用在生成正本里的组件
 * 还要在 docfirst.config.mjs 的 components 里写机读规则，否则 render 报「名册外组件」。
 *
 * Files / Folder / File 是 fumadocs 自己的文件树：目录树引用注入的就是它们，
 * 它们与 Note 的机读规则在 @godcreator/docfirst-workflow/fumadocs/roster 的 fumadocsRoster 里。
 * registry.ts 只有可擦除的类型，Node 直接运行。
 */
export const componentNames = ['Note', 'Files', 'Folder', 'File', 'SeamMap', 'MessageRouting', 'RegistrationLife'] as const
export type ComponentName = (typeof componentNames)[number]
