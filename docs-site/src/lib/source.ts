/**
 * 站的内容集合与 loader。集合用 fumadocs-mdx 的 macro 写在这里，三个区各一个 defineDocs
 * （自带 docs 与 meta，侧栏顺序由各目录的 meta.json 定）：
 *   docs        现状区，进 check；生成正本在 content/docs/outputs/ 下
 *   trajectory  轨迹卡，只增不改；frontmatter 由 cardSchema 认，正文里的关系边由 remarkTrajectoryLinks 标出
 *   future      未来区：还没发生的事
 *
 * 集合级 mdxOptions 会去掉 fumadocs 的全部默认插件，所以写了 mdxOptions 的集合都经 applyMdxPreset 把默认插件加回来。
 * 站上不出每页的机读版：机读文字只给 outputs 里的生成物，由 docfirst render 生成。
 * source 这个导出名是官方的搜索路由在用的，别改名。
 *
 * 在 content/ 下新建现状区目录时，这里加一个集合与 loader，src/app/docs/layout.tsx 的侧栏加一个根节点，
 * src/app/<目录>/ 下加路由。
 */
import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { applyMdxPreset } from 'fumadocs-mdx/config';
import { defineDocs } from 'fumadocs-mdx/macro';
import { cardSchema, docfirstMdxOptions, remarkTrajectoryLinks } from '@godcreator/docfirst-workflow/fumadocs';
import { docsRoute } from './shared';

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
    mdxOptions: applyMdxPreset(docfirstMdxOptions({ root: process.cwd() })),
  },
  meta: {
    schema: metaSchema,
  },
});

const trajectory = defineDocs({
  dir: 'content/trajectory',
  docs: {
    schema: cardSchema,
    mdxOptions: applyMdxPreset({
      remarkPlugins: (v) => [...v, [remarkTrajectoryLinks, { hrefBase: '/trajectory' }]],
    }),
  },
});

const future = defineDocs({
  dir: 'content/future',
});

export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

export const sourceTrajectory = loader({
  baseUrl: '/trajectory',
  source: trajectory.toFumadocsSource(),
});

export const sourceFuture = loader({
  baseUrl: '/future',
  source: future.toFumadocsSource(),
});
