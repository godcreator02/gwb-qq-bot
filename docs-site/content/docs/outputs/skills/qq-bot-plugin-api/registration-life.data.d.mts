/**
 * 「注册跟着两边的启停走」的全部讲解数据（registration-life.data.mjs）的形状：画面读这一份，类型从这里来；
 * 生成物里只写结论，在 registration-life.ai.mjs。
 */
export type PluginSide = { scope: 'waiting' | 'active' | 'gone'; call: string | null };
export type ServiceSide = { instance: number; registry: { command: string; copy: number }[] } | null;
export type PhoneSide = { send: string; reply: string; tone: 'good' | 'warn' } | null;

export const steps: { title: string; text: string; plugin: PluginSide; service: ServiceSide; phone: PhoneSide }[];
export const scopeLabels: { waiting: string; active: string; gone: string };
