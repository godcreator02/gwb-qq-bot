/**
 * 通知内部接缝图（notify.data.mjs）的坐标与图标。调用方、装配、文件从上往下一列；设置在文件右边，聊天表与发消息的函数在下面。
 */
import { Blocks, Boxes, Database, Megaphone, Send, Settings } from 'lucide-react';
import { cap } from '@godcreator/docfirst-explainer';
import type { SeamLayout } from '@godcreator/docfirst-explainer';

export const notifyLayout: SeamLayout = {
  view: { w: 1000, h: 548 },
  caps: {
    down: cap(54, 48, 260),
    agent: cap(324, 48, 262),
    svc: cap(54, 178, 532),
    notifier: cap(54, 318, 532),
    cfg: cap(654, 318, 292),
    send: cap(54, 468, 232),
    table: cap(334, 468, 252),
  },
  groups: {
    callers: { x: 40, y: 20, w: 560, h: 88 },
    wiring: { x: 40, y: 150, w: 560, h: 88 },
    owner: { x: 40, y: 290, w: 560, h: 90 },
    cfg: { x: 640, y: 290, w: 320, h: 88 },
    qq: { x: 40, y: 440, w: 260, h: 88 },
    store: { x: 320, y: 440, w: 280, h: 88 },
  },
  seamPaths: {
    '1': { d: 'M184,96 V178 M455,96 V178', badge: [184, 137] },
    '2': { d: 'M320,226 V318', badge: [320, 262] },
    '3': { d: 'M586,342 H654', badge: [620, 342] },
    '4': { d: 'M460,366 V468', badge: [460, 417] },
    '5': { d: 'M184,366 V468', badge: [184, 417] },
  },
  entries: {},
  moduleIcons: {
    callers: Blocks,
    wiring: Boxes,
    owner: Megaphone,
    cfg: Settings,
    qq: Send,
    store: Database,
  },
  entryIcons: {},
};
