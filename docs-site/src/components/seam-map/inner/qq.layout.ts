/**
 * 连接与收发内部接缝图（qq.data.mjs）的坐标与图标。目录外的调用方在最上一行，各自对着它调的那个文件；
 * 中间两行是目录里的文件，协议与选路在它们的使用者下面，指令面板在选路下面；QQ 开放平台与聊天表在最下。
 */
import { Cable, Cloud, Database, FileCode, Filter, Globe, Megaphone, Radio, Route, Send, Server, SquareSlash, Workflow } from 'lucide-react';
import { cap } from '@godcreator/docfirst-explainer';
import type { SeamLayout } from '@godcreator/docfirst-explainer';

export const qqLayout: SeamLayout = {
  view: { w: 1240, h: 670 },
  caps: {
    'w-index': cap(54, 48, 232),
    'n-owner': cap(334, 48, 232),
    'd-chat': cap(614, 48, 232),
    'w-rounds': cap(894, 48, 312),

    'gw-dedup': cap(54, 188, 232),
    'gw-loop': cap(54, 246, 232),
    'rest-send': cap(334, 188, 232),
    'rest-token': cap(334, 246, 232),
    'rest-gw': cap(334, 304, 232),
    'snd-reply': cap(614, 188, 120),
    'snd-split': cap(744, 188, 102),
    'gate-admit': cap(894, 188, 312),
    'gate-intake': cap(894, 246, 312),

    'proto-parse': cap(54, 358, 142),
    'proto-intents': cap(54, 416, 142),
    'win-route': cap(614, 358, 232),
    'panel-sync': cap(614, 468, 232),
    'panel-plan': cap(614, 526, 232),

    'q-ws': cap(150, 588, 200),
    'q-api': cap(370, 588, 196),
    's-table': cap(894, 588, 312),
  },
  groups: {
    entry: { x: 40, y: 20, w: 260, h: 88 },
    noti: { x: 320, y: 20, w: 260, h: 88 },
    disp: { x: 600, y: 20, w: 260, h: 88 },
    rnd: { x: 880, y: 20, w: 340, h: 88 },
    gw: { x: 40, y: 160, w: 260, h: 148 },
    rest: { x: 320, y: 160, w: 260, h: 206 },
    sender: { x: 600, y: 160, w: 260, h: 90 },
    gate: { x: 880, y: 160, w: 340, h: 148 },
    proto: { x: 40, y: 330, w: 170, h: 148 },
    window: { x: 600, y: 330, w: 260, h: 90 },
    panel: { x: 600, y: 440, w: 260, h: 148 },
    qqc: { x: 136, y: 560, w: 444, h: 88 },
    store: { x: 880, y: 560, w: 340, h: 88 },
  },
  // 记表（12）只画收下那一段；发回复那一端固定高亮时照样亮
  seamPaths: {
    '1': { d: 'M250,294 V588', badge: [250, 450] },
    '2': { d: 'M286,270 H334 M310,270 V328 H334', badge: [310, 299] },
    '3': { d: 'M125,294 V358', badge: [125, 322] },
    '4': { d: 'M170,188 V96', badge: [170, 140] },
    '5': { d: 'M1050,96 V188', badge: [1050, 140] },
    '6': { d: 'M780,96 V130 H870 V270 H894', badge: [870, 200] },
    '7': { d: 'M674,96 V188', badge: [674, 140] },
    '8': { d: 'M674,236 V358', badge: [674, 300] },
    '9': { d: 'M614,212 H566', badge: [590, 212] },
    '10': { d: 'M450,96 V188', badge: [450, 140] },
    '11': { d: 'M450,352 V588', badge: [450, 470] },
    '12': { d: 'M1050,294 V588', badge: [1050, 450] },
    '13': { d: 'M286,72 H310 V130 H590 V430 H730 V468', badge: [380, 130] },
    '14': { d: 'M614,492 H545 V588', badge: [545, 545] },
  },
  entries: {},
  moduleIcons: {
    entry: Server,
    noti: Megaphone,
    disp: Workflow,
    rnd: Cable,
    gw: Radio,
    rest: Globe,
    sender: Send,
    window: Route,
    panel: SquareSlash,
    gate: Filter,
    proto: FileCode,
    qqc: Cloud,
    store: Database,
  },
  entryIcons: {},
};
