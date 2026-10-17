import defaultMdxComponents from '@fumadocs/base-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import { siteLinkComponent, siteMdxComponents } from '@godcreator/god-docsite/react'
import { featureRuntime } from '../features/runtime.generated.ts'
import { RegistrationLife } from '../../content/docs/outputs/skills/qq-bot-plugin-api/registration-life'

/** MDX 页面与评论正文不用 import 就能写的组件：fumadocs 默认的、平台的、各功能 feature.tsx 导出的；链接 a 换成站内链接，各功能导出的链接种类先认。
 * RegistrationLife 用在生成正本 qq-bot-plugin-api.mdx 里：正本带 import 会让 render 拒绝生成，所以组件挂在这里，网页上不 import 就能写 */
export const mdxComponents = {
  ...defaultMdxComponents,
  ...siteMdxComponents,
  ...featureRuntime.mdxComponents,
  RegistrationLife,
  a: siteLinkComponent(featureRuntime.linkKinds),
} satisfies MDXComponents

declare global {
  type MDXProvidedComponents = typeof mdxComponents
}
