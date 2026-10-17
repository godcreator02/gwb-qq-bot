/**
 * 「一条消息分到哪」的全部讲解数据（message-routing.data.mjs）的形状：画面只读这一份，类型从这里来。
 * 五道检查照 routing.ts 里 routeMessage 的顺序排，前一道能下结论就不往下走；回给手机的话照 chat-rounds.ts 与 routing.ts 里的原文。
 */
export type Kind = 'task' | 'answer' | 'refuse';
export type Outcome = { id: string; when: string; kind: Kind; label: string };

export const kindLabels: Record<Kind, string>;
export const checks: { id: string; q: string; detail: string; outs: Outcome[] }[];
export const cases: {
  id: string;
  label: string;
  message: string;
  path: [string, string][];
  result: string;
  reply: string;
  text: string;
}[];
