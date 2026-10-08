'use client';
/**
 * 接缝图。不带属性画全局图（入口页用）；带 module 属性画那一块内部的接缝图（模块页用）。
 * 画法在讲解组件包的 SeamDiagram；每张图的内容在 *.data.mjs，坐标在 *.layout.ts；机读版由 seam-map.ai.mjs 读同一份内容生成。
 */
import { SeamDiagram } from '@godcreator/docfirst-explainer';
import type { SeamLayout } from '@godcreator/docfirst-explainer';
import type { SeamGraph } from '@godcreator/docfirst-explainer/seam-graph';
import { systemGraph } from './seam-map.data.mjs';
import { systemLayout } from './system.layout';
import { qqGraph } from './inner/qq.data.mjs';
import { qqLayout } from './inner/qq.layout';
import { notifyGraph } from './inner/notify.data.mjs';
import { notifyLayout } from './inner/notify.layout';
import { dispatchGraph } from './inner/dispatch.data.mjs';
import { dispatchLayout } from './inner/dispatch.layout';

const INNER: Record<string, { graph: SeamGraph; layout: SeamLayout }> = {
  qq: { graph: qqGraph, layout: qqLayout },
  notify: { graph: notifyGraph, layout: notifyLayout },
  dispatch: { graph: dispatchGraph, layout: dispatchLayout },
};

export function SeamMap({ module: moduleId }: { module?: string }) {
  if (moduleId === undefined) return <SeamDiagram graph={systemGraph} layout={systemLayout} />;
  const inner = INNER[moduleId];
  if (inner === undefined) throw new Error(`SeamMap 没有「${moduleId}」的内部图，有的是：${Object.keys(INNER).join('、')}`);
  return <SeamDiagram graph={inner.graph} layout={inner.layout} />;
}
