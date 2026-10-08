/**
 * MessageRouting 在机读版里变成什么：跟画面读同一份数据（message-routing.data.mjs）。
 * 每种情况的标题与说明用讲解组件包的 casesText 生成，和画面上 CasePicker 显示的是同一段话；
 * 五道检查、每种情况发的消息、走过的检查与机器人回的话另写成段落。
 * 这个文件不 import React，docfirst.config.mjs 引它，命令行也能运行。
 */
import { casesText } from '@godcreator/docfirst-explainer/text';
import { cases, checks, kindLabels } from './message-routing.data.mjs';

export function MessageRouting(_node, { paragraph }) {
  const outcomes = checks.flatMap((c) => c.outs);
  const caseTexts = casesText(cases);
  return [
    ...checks.map((c, i) => {
      const outs = c.outs.map((o) => `${o.when} → ${o.label}（${kindLabels[o.kind]}）`).join('；');
      return paragraph(`检查 ${i + 1}：${c.q}${c.detail}${outs ? ` 结论：${outs}。` : ''}`);
    }),
    ...cases.flatMap((c, i) => {
      const path = c.path.map(([id, answer]) => `${checks.findIndex((k) => k.id === id) + 1}（${answer}）`).join(' → ');
      const result = outcomes.find((o) => o.id === c.result);
      return [
        paragraph(caseTexts[i]),
        paragraph(`发「${c.message}」：经过检查 ${path}，结果是 ${result.label}（${kindLabels[result.kind]}）。机器人回：${c.reply.replaceAll('\n', ' / ')}`),
      ];
    }),
  ];
}
