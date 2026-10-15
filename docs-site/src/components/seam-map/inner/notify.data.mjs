/**
 * 通知 src/notify/ 的内部接缝图：模块页 <SeamMap module="notify" /> 画的就是它。
 * 目录里只有一个文件；灰色实线框是谁调它、它读哪些设置、记在哪、经谁发出去。坐标在 notify.layout.ts。
 */
import { defineSeamGraph } from '@godcreator/docfirst-explainer/seam-graph';

export const notifyGraph = defineSeamGraph({
  id: 'notify',
  title: '通知内部的文件与接缝',
  intro:
    '通知内部接缝图：虚线框是 src/notify/ 下唯一的文件，方块是它对外给的方法；灰色实线框是调用方、装配、设置、聊天表与发消息的函数。这个目录不 import 派任务，只 import 连接与收发的类型。',
  frameLabel: '文件',
  modules: [
    {
      id: 'callers',
      name: '调用方',
      pkg: '插件与 agent',
      role: null,
      outside: true,
      blurb: '别的插件 inject 服务 gwbQqBot 调 notify（协作站巡检、gitea-issues）；agent 经 gwb MCP 入口调命令 qq-bot.notify，参数原样转过去。',
      caps: [
        { id: 'down', name: '别的插件', ident: 'ctx.gwbQqBot.notify' },
        { id: 'agent', name: 'agent', ident: 'qq-bot.notify（经 MCP）' },
      ],
    },
    {
      id: 'wiring',
      name: '装配',
      pkg: 'src/index.ts · src/rounds.ts',
      role: null,
      outside: true,
      blurb: '服务方法与命令都转给接线，接线转给通知；QQ 没连上时直接报错。',
      caps: [{ id: 'svc', name: '服务方法与命令转过来', ident: 'GwbQqBot.notify → Rounds.notify' }],
    },
    {
      id: 'owner',
      name: '主人通知',
      pkg: 'owner-notifier.ts',
      role: 'emerald',
      outside: false,
      blurb: '同一个 id 只发一次：先在聊天表里记下 id 与正文、存盘，再发；发出去了才把这条标成已送达。发不出去不重发。',
      caps: [{ id: 'notifier', name: '按 id 去重，发一次', ident: 'OwnerNotifier.notify(id, text)' }],
    },
    {
      id: 'cfg',
      name: '设置',
      pkg: 'gwbSettings',
      role: null,
      outside: true,
      blurb: '两项设置都经装配传进来的函数每次现读。',
      caps: [{ id: 'cfg', name: '主人与白名单', ident: 'owner-openid · allowed-openids' }],
    },
    {
      id: 'qq',
      name: '连接与收发',
      pkg: 'src/qq/',
      role: null,
      outside: true,
      blurb: '发消息的函数由装配传进来，就是 QqRestClient.sendC2c；不带 msg_id 就是主动消息。',
      caps: [{ id: 'send', name: '发私聊', ident: 'QqRestClient.sendC2c' }],
    },
    {
      id: 'store',
      name: '聊天表',
      pkg: 'src/storage/',
      role: null,
      outside: true,
      blurb: '通知的去重记录和私聊行存在同一份表里，经同一条串行队列改。',
      caps: [{ id: 'table', name: '通知去重记录', ident: 'book.notices' }],
    },
  ],
  entries: [],
  seams: [
    /* ref file="../plugins/qq-bot/src/api.ts" lines="6-10" hash="4304cdac273d" blob="c44b0ca39f56" */
    {
      n: 1,
      name: '调用',
      a: ['down', 'agent'],
      b: ['svc'],
      iface: 'notify(id, text) → { delivered, duplicate }；qq-bot.notify { id, text }',
      convention: false,
      via: 'code',
      text: '服务方法与命令是同一个契约：正文 1–5000 字，id 由调用方定，同一件事用同一个 id。命令只收 id、text 两个键。',
    },
    /* ref file="../plugins/qq-bot/src/rounds.ts" lines="100-102" hash="24080ace3971" blob="80fe8dc6f49c" */
    {
      n: 2,
      name: '转给通知',
      a: ['svc'],
      b: ['notifier'],
      iface: 'Rounds.notify(id, text) → OwnerNotifier.notify(id, text)',
      convention: false,
      via: 'code',
      text: '接线在连上机器人时建出通知，把聊天表、读设置的函数和发消息的函数传进去。',
    },
    /* ref file="../plugins/qq-bot/src/notify/owner-notifier.ts" lines="22-24" hash="fc71e218182e" blob="b847b35d1ef2" */
    {
      n: 3,
      name: '读设置',
      a: ['notifier'],
      b: ['cfg'],
      iface: 'ownerOpenid() · allowedOpenids()',
      convention: false,
      via: 'code',
      text: '主人没配、或主人不在白名单里，直接报错，不发。',
    },
    /* ref file="../plugins/qq-bot/src/notify/owner-notifier.ts" lines="25-35" hash="9da67b6be9cf" blob="b847b35d1ef2" */
    {
      n: 4,
      name: '去重',
      a: ['notifier'],
      b: ['table'],
      iface: 'table.serial：book.notices 里找 id，没有就记 { id, text, delivered: false }',
      convention: false,
      via: 'code',
      text: '同一个 id、同一段正文回 duplicate 和当初是否送达；同一个 id 换了正文直接报错。',
    },
    /* ref file="../plugins/qq-bot/src/notify/owner-notifier.ts" lines="36-38" hash="9b566aa5a7b3" blob="4da401bd59b4" */
    {
      n: 5,
      name: '发出去',
      a: ['notifier'],
      b: ['send'],
      iface: "sendC2c(owner, text, undefined, undefined, undefined, { kind: 'notice', notice: id, segment })",
      convention: false,
      via: 'code',
      text: '主动消息，不引用任何消息。最后一个参数是给消息记录的用途：种类 notice 与通知 id。发送抛错只记一行警告，回 delivered: false。',
    },
  ],
});
