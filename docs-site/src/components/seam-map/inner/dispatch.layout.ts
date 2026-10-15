/**
 * 派任务内部接缝图（dispatch.data.mjs）的坐标与图标。chat-rounds.ts 在中间一列；左边是注册表、分发与命令名、参数校验，
 * 右边是 claude-agent 与会话选择；装配在最上，连接与收发、聊天表在最下。
 */
import { Blocks, Bot, Boxes, Database, ListChecks, Route, Send, Timer, Workflow } from 'lucide-react';
import { cap } from '@godcreator/docfirst-explainer';
import type { SeamLayout } from '@godcreator/docfirst-explainer';

export const dispatchLayout: SeamLayout = {
  view: { w: 1240, h: 620 },
  caps: {
    'a-svc': cap(54, 48, 332),
    'a-rnd': cap(444, 48, 352),

    'reg-reg': cap(54, 178, 332),
    'reg-look': cap(54, 236, 332),
    'rt-route': cap(54, 358, 332),
    'rt-name': cap(54, 416, 332),
    'args-check': cap(54, 538, 332),

    'cr-cmd': cap(444, 178, 352),
    'cr-wait': cap(444, 236, 352),
    'cr-in': cap(444, 294, 352),
    'cr-round': cap(444, 352, 352),
    'cr-deliver': cap(444, 410, 352),

    'x-start': cap(854, 178, 352),
    'x-wait': cap(854, 236, 352),
    'gs-choose': cap(854, 358, 352),

    'q-in': cap(444, 538, 172),
    'q-reply': cap(626, 538, 170),
    st: cap(854, 538, 352),
  },
  groups: {
    wiring: { x: 40, y: 20, w: 770, h: 88 },
    exec: { x: 840, y: 150, w: 380, h: 148 },
    reg: { x: 40, y: 150, w: 360, h: 148 },
    rt: { x: 40, y: 330, w: 360, h: 148 },
    args: { x: 40, y: 510, w: 360, h: 90 },
    cr: { x: 430, y: 150, w: 380, h: 322 },
    gs: { x: 840, y: 330, w: 380, h: 90 },
    qq: { x: 430, y: 510, w: 380, h: 88 },
    store: { x: 840, y: 510, w: 380, h: 88 },
  },
  // 接线（1）只画到 chat-rounds.ts 框的上沿；收发（8）与聊天表（9）从框的下沿与右沿画出，几个方块固定高亮时都会亮
  seamPaths: {
    '1': { d: 'M620,96 V178', badge: [620, 137] },
    '2': { d: 'M444,318 H415 V382 H386', badge: [415, 350] },
    '3': { d: 'M444,202 H415 V260 H386', badge: [415, 231] },
    '4': { d: 'M220,96 V178', badge: [220, 137] },
    '5': { d: 'M54,202 H22 V562 H54 M22,440 H54', badge: [22, 320] },
    '6': { d: 'M796,385 H854', badge: [825, 385] },
    '7': { d: 'M796,366 H830 V202 H854 M796,260 H854', badge: [830, 320] },
    '8': { d: 'M530,458 V538 M711,458 V538', badge: [530, 498] },
    '9': { d: 'M796,434 H1030 V538', badge: [1030, 480] },
  },
  entries: {},
  moduleIcons: {
    wiring: Boxes,
    exec: Bot,
    reg: Blocks,
    rt: Route,
    args: ListChecks,
    cr: Workflow,
    gs: Timer,
    qq: Send,
    store: Database,
  },
  entryIcons: {},
};
