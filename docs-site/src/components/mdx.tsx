/**
 * 名册里给人看的那一半：docfirst.config.mjs 里声明机读规则表，这里给 React 表。
 * 表的类型由 registry.ts 的名单限定：少一个编译不过，多一个也编译不过。
 * 机读规则表里的组件是否都在这里，由 scripts/verify-roster.mjs 核对。
 * 先放 fumadocs 的默认表，再把 pre 换成 @godcreator/docfirst-workflow/fumadocs 里会画状态点的 DocfirstPre。
 */
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { File, Files, Folder } from 'fumadocs-ui/components/files';
import type { MDXComponents } from 'mdx/types';
import type { ReactNode } from 'react';
import { DocfirstPre } from '@godcreator/docfirst-workflow/fumadocs/pre';
import { MessageRouting } from './message-routing/message-routing';
import { RegistrationLife } from './registration-life/registration-life';
import { SeamMap } from './seam-map/seam-map';
import type { ComponentName } from './registry';

export function Note({ children }: { children?: ReactNode }) {
  return <div className="note">{children}</div>;
}

const table: Record<ComponentName, MDXComponents[string]> = {
  Note,
  Files,
  Folder,
  File,
  SeamMap,
  MessageRouting,
  RegistrationLife,
};

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    ...components,
    ...table,
    pre: DocfirstPre,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
