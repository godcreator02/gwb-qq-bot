/**
 * SeamMap 在机读版里变成什么：跟画面读同一份内容，交给讲解组件包的 seamGraphText 写成一段段文字，每段包成一个段落。
 * 带 module 属性时写的是那一块的内部图。这个文件不 import React，docfirst.config.mjs 引它，命令行也能运行。
 */
import { seamGraphText } from '@godcreator/docfirst-explainer/seam-graph';
import { systemGraph } from './seam-map.data.mjs';
import { qqGraph } from './inner/qq.data.mjs';
import { notifyGraph } from './inner/notify.data.mjs';
import { dispatchGraph } from './inner/dispatch.data.mjs';

const INNER = { qq: qqGraph, notify: notifyGraph, dispatch: dispatchGraph };

export function SeamMap(node, { paragraph, attr }) {
  const moduleId = attr(node, 'module');
  if (moduleId === undefined) return seamGraphText(systemGraph).map((text) => paragraph(text));
  const graph = INNER[moduleId];
  if (graph === undefined) throw new Error(`SeamMap 没有「${moduleId}」的内部图，有的是：${Object.keys(INNER).join('、')}`);
  return seamGraphText(graph).map((text) => paragraph(text));
}
