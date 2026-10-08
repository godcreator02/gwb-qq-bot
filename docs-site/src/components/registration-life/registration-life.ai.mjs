/**
 * RegistrationLife 在机读版里变成什么：跟画面读同一份数据（registration-life.data.mjs）。
 * 每一步的标题与说明用讲解组件包的 stepsText 生成，和画面下方的说明是同一段话；三块画面的状态另写成一段。
 * 这个文件不 import React，docfirst.config.mjs 引它，命令行也能运行。
 */
import { stepsText } from '@godcreator/docfirst-explainer/text';
import { scopeLabels, steps } from './registration-life.data.mjs';

function sidesOf(step) {
  const plugin = `协作站：${scopeLabels[step.plugin.scope]}${step.plugin.call === null ? '' : `，调用 ${step.plugin.call}`}`;
  const service = step.service === null
    ? '没有 gwbQqBot'
    : `gwbQqBot 服务对象 #${step.service.instance}，注册表：${step.service.registry.map((r) => `${r.command}（协作站第 ${r.copy} 份）`).join('、') || '空'}`;
  const phone = step.phone === null ? '' : `；手机发「${step.phone.send}」，回「${step.phone.reply}」`;
  return `${plugin}；${service}${phone}。`;
}

export function RegistrationLife(_node, { paragraph }) {
  const texts = stepsText(steps);
  return steps.flatMap((step, i) => [paragraph(texts[i]), paragraph(sidesOf(step))]);
}
