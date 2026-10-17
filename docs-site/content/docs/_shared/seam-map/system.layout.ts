/**
 * 全局接缝图（seam-map.data.mjs）的坐标与图标。按依赖方向从上往下：下游插件 → 装配 → 派任务、claude-agent、通知、聊天表 →
 * 连接与收发、gwb 数据 → QQ 开放平台；手机上的人从左下进 QQ 开放平台。
 */
import { Blocks, Bot, Boxes, Cable, Cloud, Database, HardDrive, Megaphone, Smartphone, Workflow } from 'lucide-react';
import { cap } from '@godcreator/explainer/site';
import type { SeamLayout } from '@godcreator/explainer/site';

export const systemLayout: SeamLayout = {
  view: { w: 1240, h: 830 },
  caps: {
    'ds-register': cap(54, 48, 250),
    'ds-notify': cap(314, 48, 132),

    service: cap(54, 178, 220),
    rounds: cap(284, 178, 922),

    registry: cap(54, 318, 230),
    routing: cap(304, 318, 282),
    'chat-rounds': cap(54, 376, 532),
    'ca-start': cap(634, 318, 172),
    'ca-wait': cap(634, 376, 172),
    notifier: cap(854, 318, 172),
    'chat-table': cap(1074, 318, 132),

    gate: cap(54, 528, 220),
    reply: cap(284, 528, 236),
    gateway: cap(530, 528, 240),
    rest: cap(780, 528, 246),
    'gwb-data': cap(1074, 528, 132),
    msglog: cap(54, 586, 466),
    'gwb-msgfiles': cap(1074, 586, 132),

    'qqc-gw': cap(530, 748, 240),
    'qqc-api': cap(780, 748, 246),
  },
  groups: {
    ds: { x: 40, y: 20, w: 420, h: 88 },
    root: { x: 40, y: 150, w: 1180, h: 88 },
    dispatch: { x: 40, y: 290, w: 560, h: 150 },
    exec: { x: 620, y: 290, w: 200, h: 150 },
    notify: { x: 840, y: 290, w: 200, h: 90 },
    storage: { x: 1060, y: 290, w: 160, h: 90 },
    qq: { x: 40, y: 500, w: 1000, h: 154 },
    gwb: { x: 1060, y: 500, w: 160, h: 146 },
    qqc: { x: 516, y: 720, w: 524, h: 88 },
  },
  // 共用聊天表（10）只画通知那一段，派任务与连接与收发两端固定高亮时照样亮
  seamPaths: {
    '1': { d: 'M650,748 V576', badge: [650, 662] },
    '2': { d: 'M830,226 V480 H650 V528', badge: [830, 262] },
    '3': { d: 'M294,226 V376 M940,226 V318', badge: [294, 262] },
    '4': { d: 'M164,424 V528 M330,424 V528', badge: [164, 470] },
    '5': { d: 'M903,576 V748', badge: [903, 662] },
    '6': { d: 'M586,400 H634 M610,400 V342 H634', badge: [610, 371] },
    '7': { d: 'M179,96 V178 M380,96 V130 H179', badge: [280, 130] },
    '8': { d: 'M164,226 V318', badge: [164, 262] },
    '9': { d: 'M940,366 V528', badge: [940, 470] },
    '10': { d: 'M1026,342 H1074', badge: [1050, 342] },
    '11': { d: 'M1140,366 V528', badge: [1140, 447] },
    '12': { d: 'M520,610 H1074', badge: [780, 610] },
  },
  entries: {
    person: { box: { x: 300, y: 730, w: 170, h: 36 }, arrow: [470, 748, 516, 748] },
  },
  moduleIcons: {
    ds: Blocks,
    root: Boxes,
    dispatch: Workflow,
    exec: Bot,
    notify: Megaphone,
    storage: Database,
    gwb: HardDrive,
    qq: Cable,
    qqc: Cloud,
  },
  entryIcons: {
    person: Smartphone,
  },
};
