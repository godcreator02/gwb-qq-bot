/**
 * 入口页的全局接缝图：插件里的三块（连接与收发、通知、派任务）、它们共用的聊天表、把它们接起来的装配，以及框外的人和系统。
 * 坐标在 system.layout.ts；改了这里同步改布局与入口页「接缝」一节的逐条讲解。
 */
import { defineSeamGraph } from '@godcreator/docfirst-explainer/seam-graph';

/** @type {import('@godcreator/docfirst-explainer/seam-graph').SeamModule[]} */
const modules = [
  {
    id: 'agent',
    name: '执行任务的 agent',
    pkg: '在执行端里',
    role: null,
    outside: true,
    blurb: 'ZCode 或 Claude Code 里收到任务的 agent。任务说明末尾写着本轮编号和 home 名，做完自己经 gwb MCP 入口调 qq-bot.report 交回结果。',
    caps: [{ id: 'agent-report', name: '交回本轮结果', ident: 'qq-bot.report' }],
  },
  {
    id: 'ds',
    name: '下游插件',
    pkg: '协作站、gitea-issues 等',
    role: null,
    outside: true,
    blurb: '别的 gwb 插件 inject 服务 gwbQqBot：给主人发通知（协作站巡检、gitea-issues），注册自己的任务组或直接命令。依赖只朝它们 → qq-bot 一个方向，qq-bot 不认识它们。',
    caps: [
      { id: 'ds-register', name: '注册任务组与直接命令', ident: 'registerTaskGroup · registerCommand' },
      { id: 'ds-notify', name: '主动私聊主人', ident: 'notify' },
    ],
  },
  {
    id: 'root',
    name: '装配',
    pkg: 'src/index.ts · src/rounds.ts',
    role: 'slate',
    outside: false,
    blurb: 'index.ts 是服务 gwbQqBot 的提供方：定义设置、注册 qq-bot.* 命令、建出网关与 REST、登记执行端，插件注册表也放在这里，没连上 QQ 也能注册。连上机器人以后由 rounds.ts 把三块接起来：入站私聊先过白名单再交给派任务，notify 交给通知。三块互不 import，只在这里汇合。',
    caps: [
      { id: 'service', name: '服务、命令与设置', ident: 'index.ts · GwbQqBot' },
      { id: 'rounds', name: '连上以后把三块接起来', ident: 'rounds.ts · Rounds' },
    ],
  },
  {
    id: 'dispatch',
    name: '派任务',
    pkg: 'src/dispatch/',
    role: 'violet',
    outside: false,
    blurb: '私聊里的一条消息按斜杠命令分到任务组或直接命令；每个私聊的每个组各有会话与队列，一组一次一轮：入队、派给执行端、收回报、懒检查、发回结果、接着开下一轮。执行端适配层是本插件私有的。',
    caps: [
      { id: 'registry', name: '插件注册的组与直接命令', ident: 'PluginCommandRegistry' },
      { id: 'routing', name: '一条消息分到哪', ident: 'routing.ts · routeMessage' },
      { id: 'chat-rounds', name: '任务组、会话、队列与一轮', ident: 'chat-rounds.ts · ChatRounds' },
      { id: 'executors', name: '执行端适配层', ident: 'executors/ · Executor' },
    ],
  },
  {
    id: 'exec',
    name: '执行端',
    pkg: '两个插件',
    role: null,
    outside: true,
    blurb: 'gwb-zcode 与 gwb-claudecode 各提供一个 cordis 服务。qq-bot 可选 inject：装着哪个，哪份适配实现才登记，卸掉自动撤掉。',
    caps: [
      { id: 'zc', name: 'ZCode', ident: 'gwbZcode' },
      { id: 'cc', name: 'Claude Code', ident: 'gwbClaudecode' },
    ],
  },
  {
    id: 'notify',
    name: '通知',
    pkg: 'src/notify/',
    role: 'emerald',
    outside: false,
    blurb: '主动私聊主人：按通知 id 去重，发不出去不重发。主人是设置 owner-openid，要在白名单里。',
    caps: [{ id: 'notifier', name: '主人通知', ident: 'OwnerNotifier' }],
  },
  {
    id: 'storage',
    name: '聊天表',
    pkg: 'src/storage/',
    role: 'amber',
    outside: false,
    blurb: '每个私聊一行，行里按任务组各记一份会话与队列；另记命令登记的任务组、通知去重、近期消息 id 与被动回复用掉的次数。三块共用，所有改表的操作经同一条串行队列。',
    caps: [{ id: 'chat-table', name: '聊天表', ident: 'ChatTable' }],
  },
  {
    id: 'gwb',
    name: 'gwb 数据',
    pkg: 'gwbData',
    role: null,
    outside: true,
    blurb: '工作台的数据服务：聊天表按 AppID 整份存成一份文档，换机器人就是另一份。',
    caps: [{ id: 'gwb-data', name: '一份文档', ident: 'chats-<AppID>' }],
  },
  {
    id: 'qq',
    name: '连接与收发',
    pkg: 'src/qq/',
    role: 'blue',
    outside: false,
    blurb: '和 QQ 开放平台打交道的全部：网关长连接、access token、白名单与按消息 id 去重、按被动回复窗口选路、引用原消息、长回复分段。不认识任务组，也不知道通知的存在。',
    caps: [
      { id: 'gate', name: '白名单与去重', ident: 'incoming-gate.ts' },
      { id: 'reply', name: '回复：被动或主动', ident: 'reply-sender.ts · reply-window.ts' },
      { id: 'gateway', name: '网关长连接', ident: 'qq-gateway.ts · QqGateway' },
      { id: 'rest', name: 'REST 与 access token', ident: 'qq-rest.ts · QqRestClient' },
    ],
  },
  {
    id: 'qqc',
    name: 'QQ 开放平台',
    pkg: '腾讯',
    role: null,
    outside: true,
    blurb: '官方机器人接口：WebSocket 网关推事件，REST 发消息。被动回复单聊 60 分钟、每条消息 4 次，过了只能发主动消息；指令面板只能在管理端手动配置。',
    caps: [
      { id: 'qqc-gw', name: '推私聊事件', ident: 'C2C_MESSAGE_CREATE' },
      { id: 'qqc-api', name: '收消息', ident: '/v2/users/{openid}/messages' },
    ],
  },
];

const seams = [
  /* ref file="../plugins/qq-bot/src/qq/qq-protocol.ts" lines="19-24" hash="705a04f44a90" blob="6a6bf8eff594" */
  {
    n: 1,
    name: 'QQ 推私聊',
    a: ['qqc-gw'],
    b: ['gateway'],
    iface: 'WebSocket 网关：Identify 订阅 GROUP_AND_C2C_EVENT（1 << 25），收 C2C_MESSAGE_CREATE',
    convention: false,
    via: 'code',
    text: '插件保持一条出站长连接：心跳、断线按 1 秒起翻倍退避重连，能 Resume 的接着收。单聊事件和群事件在同一位里，群事件到了只记事件类型；同一条消息重推按消息 id 与序号去重。',
  },
  /* ref file="../plugins/qq-bot/src/rounds.ts" lines="48-52" hash="80acb3401eab" blob="c2b4c0d08570" */
  {
    n: 2,
    name: '入站与白名单',
    a: ['gateway', 'gate'],
    b: ['rounds'],
    iface: 'GatewayEvents.onMessage(IncomingMessage) → Rounds.handleIncoming → AllowedSenderGate.admit',
    convention: false,
    via: 'code',
    text: '网关把解析好的私聊消息交给装配；装配先用连接与收发里的白名单过一道，名单外的静默拒绝、只记日志和最近被拒的 openid，通过的才交给派任务。连接与收发自己不 import 派任务。',
  },
  /* ref file="../plugins/qq-bot/src/rounds.ts" lines="37-46" hash="98236e2c2f37" blob="c2b4c0d08570" */
  {
    n: 3,
    name: '交给派任务与通知',
    a: ['rounds'],
    b: ['chat-rounds', 'notifier'],
    iface: 'ChatRounds.handleAdmitted · report · bind · addGroup … ；OwnerNotifier.notify',
    convention: false,
    via: 'code',
    text: '装配连上机器人时建出派任务与通知两块，把聊天表、执行端表、插件注册表和读设置的函数传进去；命令与服务方法都经它转过去。两块互不 import。',
  },
  /* ref file="../plugins/qq-bot/src/qq/incoming-gate.ts" lines="22-34" hash="117d111a6ff6" blob="ed832dd08797" */
  /* ref file="../plugins/qq-bot/src/qq/reply-sender.ts" lines="49-53" hash="ce564994ca14" blob="3e1dda368b15" */
  {
    n: 4,
    name: '派任务用收发',
    a: ['chat-rounds'],
    b: ['gate', 'reply'],
    iface: 'intakeFirstDelivery(table, message, onFirstDelivery) · ReplySender.reply(target, trigger, text, quote?)',
    convention: false,
    via: 'code',
    text: '派任务收下一条消息时经连接与收发记下这个私聊、按消息 id 去重；回执、结果、用法说明都经它发出，由它按回复窗口选被动或主动、分段、带上引用。派任务只决定说什么、引用哪条。',
  },
  {
    n: 5,
    name: '发消息',
    a: ['rest'],
    b: ['qqc-api'],
    iface: 'POST /v2/users/{openid}/messages：msg_type 0；被动回复带 msg_id、msg_seq；message_reference 引用原消息',
    convention: false,
    via: 'code',
    text: '回执、结果、通知都从这里出去，一律纯文本。窗口与次数是平台的硬限制，插件只做选择；业务错误同时认 err_code 与 code。',
  },
  /* ref file="../plugins/qq-bot/src/dispatch/executors/executor.ts" lines="8-17" hash="1322be235ac9" blob="2914407123d2" */
  {
    n: 6,
    name: '派给执行端',
    a: ['executors'],
    b: ['zc', 'cc'],
    iface: 'inject gwbZcode：create / send / status；inject gwbClaudecode：create / send / status',
    convention: false,
    via: 'code',
    text: '适配层把 qq-bot 自己要的两件事（start 开一轮、check 问做完没有）翻译成各执行端服务原样的方法。某个执行端插件改了服务方法，只动这里对应的那份实现。',
  },
  {
    n: 7,
    name: '回报',
    a: ['agent-report'],
    b: ['service'],
    iface: 'qq-bot.report { round, text }（经 gwb MCP 入口调命令）',
    convention: false,
    via: 'code',
    text: 'agent 做完自己调。命令由装配注册、转给派任务：本轮编号只用来对上是哪一轮，不当凭证；回执先交回，发回 QQ 在后台做。',
  },
  /* ref file="../plugins/qq-bot/src/api.ts" lines="5-23" hash="d0251555e9ca" blob="aa8532784480" */
  {
    n: 8,
    name: '下游插件',
    a: ['ds-register', 'ds-notify'],
    b: ['service'],
    iface: 'inject gwbQqBot：notify(id, text) · registerTaskGroup(definition) · registerCommand(definition)',
    convention: false,
    via: 'code',
    text: '服务 gwbQqBot 的三个方法就是给别的插件的全部接口。两个注册方法交回撤掉注册的函数，调用方包在 ctx.effect 里，插件卸载或重载时自动撤掉；参数不合规则当场抛异常。',
  },
  /* ref file="../plugins/qq-bot/src/dispatch/command-registry.ts" lines="68-82" hash="98be07ab119c" blob="eb57224d1c72" */
  {
    n: 9,
    name: '注册表在服务上',
    a: ['service'],
    b: ['registry'],
    iface: 'PluginCommandRegistry.registerTaskGroup / registerCommand(definition, { plugin, storedGroupCommands })',
    convention: false,
    via: 'code',
    text: '插件注册的组与直接命令存在服务对象上，不在连上以后才有的对象上：没配 AppID 时照样能注册，换机器人重连也不丢。注册方的插件包名从调用方的上下文里取。',
  },
  /* ref file="../plugins/qq-bot/src/qq/reply-sender.ts" lines="7-8" hash="b5bee59e08d3" blob="3e1dda368b15" */
  {
    n: 10,
    name: '通知发主动消息',
    a: ['notifier'],
    b: ['rest'],
    iface: 'SendC2c(owner, text)：不带 msg_id、不引用',
    convention: false,
    via: 'code',
    text: '通知只 import 连接与收发的类型；真正发消息的函数由装配传进来，就是 QqRestClient.sendC2c。通知不经回复窗口，一律是主动消息。',
  },
  /* ref file="../plugins/qq-bot/src/storage/chat-table.ts" lines="253-279" hash="22ba087acb83" blob="962753da084a" */
  {
    n: 11,
    name: '共用聊天表',
    a: ['chat-rounds', 'notifier', 'gate', 'reply'],
    b: ['chat-table'],
    iface: 'ChatTable.serial(run) · save() · book',
    convention: false,
    via: 'code',
    text: '派任务读写私聊行与命令登记的组，通知读写去重记录，连接与收发记近期消息 id 和被动回复用掉的次数。所有改表的操作经同一条串行队列；调执行端、发 QQ 消息在队列外面做，一个组慢不会卡住别的组。',
  },
  /* ref file="../plugins/qq-bot/src/index.ts" lines="103-103" hash="3f4db5b01f24" blob="3a0b4b162ed1" */
  {
    n: 12,
    name: '存盘',
    a: ['chat-table'],
    b: ['gwb-data'],
    iface: "gwbData.readDoc / writeDoc('chats-<AppID>')",
    convention: false,
    via: 'disk',
    text: '整份表按 AppID 存成一份文档，记录里不写 home 与 AppID。读回时形状不对直接报错，读到第 1、2 版先迁成第 3 版。',
  },
];

export const systemGraph = defineSeamGraph({
  id: 'system',
  title: 'qq-bot 的三块、聊天表、装配与接缝',
  intro:
    '全局接缝图：虚线框是插件里的模块（目录），框里的方块是它对外给的能力，跨模块的线带编号就是接缝；实线是代码调用，虚线是存盘；灰色实线框是插件之外的人和系统。',
  frameLabel: '模块',
  modules,
  entries: [{ id: 'person', name: '手机上的人', to: 'qqc-gw' }],
  seams,
});
