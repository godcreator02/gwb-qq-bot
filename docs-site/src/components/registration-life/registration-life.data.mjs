/**
 * 「注册跟着两边的启停走」的全部讲解数据：画面（registration-life.tsx）读这一份；生成物里只写结论，在 registration-life.ai.mjs。
 * 例子是协作站给一个项目注册任务组 /mmc；协作站用 ctx.inject(['gwbQqBot'], …) 可有可无地接服务，注册写在那个作用域的 effect 里。
 */

/**
 * 每一步三块画面：协作站这一侧（依赖 gwbQqBot 的作用域此刻怎样、这一步调了什么）、qq-bot 的服务对象与它上面的注册表、手机上的私聊。
 * scope：waiting 等服务出现、active 回调已运行、gone 已撤掉；service 为 null 表示此刻没有 gwbQqBot；
 * registry 每项是注册表里的一条，copy 标出是协作站的第几份注册；phone 为 null 表示这一步手机上没有动静
 * @typedef {{ scope: 'waiting' | 'active' | 'gone', call: string | null }} PluginSide
 * @typedef {{ instance: number, registry: { command: string, copy: number }[] } | null} ServiceSide
 * @typedef {{ send: string, reply: string, tone: 'good' | 'warn' } | null} PhoneSide
 * @type {{ title: string, text: string, plugin: PluginSide, service: ServiceSide, phone: PhoneSide }[]}
 */
/* ref file="../plugins/qq-bot/src/api.ts" lines="1-4" hash="7a652ae12fa1" blob="57a540937d16" */
/* ref file="../plugins/qq-bot/src/index.ts" lines="52-52" hash="dc80592374cb" blob="81cfa322bfe9" */
/* ref file="../plugins/qq-bot/tests/command-registry.test.ts" lines="22-29" hash="b6246f684acf" blob="d9eafac0905c" */
/* ref file="../plugins/qq-bot/tests/rounds.test.ts" lines="306-315" hash="3a4c4ce33761" blob="b09fd4ef827c" */
export const steps = [
  {
    title: '协作站先启动',
    text: 'qq-bot 没装或还没启动，没有 gwbQqBot。inject 的回调先不运行，协作站其余功能照常。',
    plugin: { scope: 'waiting', call: "ctx.inject(['gwbQqBot'], 回调)" },
    service: null,
    phone: null,
  },
  {
    title: 'qq-bot 启动，注册',
    text: '服务对象出现，回调运行，在 effect 里注册 /mmc，拿回撤掉注册的函数。注册表放在服务对象上，QQ 还没连上也能注册；命令名不合规则或重名当场抛异常。',
    plugin: { scope: 'active', call: "registerTaskGroup({ command: '/mmc', … })" },
    service: { instance: 1, registry: [{ command: '/mmc', copy: 1 }] },
    phone: null,
  },
  {
    title: '手机上派任务',
    text: '消息的第一段 /mmc 在注册表里找到这个组，进这一组的队列、派给 agent。之后怎么走和命令登记的组完全一样。',
    plugin: { scope: 'active', call: null },
    service: { instance: 1, registry: [{ command: '/mmc', copy: 1 }] },
    phone: { send: '/mmc 跑一次仿真', reply: '已接收，派给 agent', tone: 'good' },
  },
  {
    title: 'qq-bot 重载',
    text: '旧的服务对象停掉，注册表跟着没了。依赖 gwbQqBot 的作用域被撤掉，effect 的清理函数运行，调用撤掉函数。',
    plugin: { scope: 'gone', call: '撤掉函数()' },
    service: null,
    phone: null,
  },
  {
    title: '新的服务对象出现',
    text: '新服务对象的注册表是空的。回调再运行一次，重新注册 /mmc。协作站不用写「qq-bot 回来了要重新注册」的代码。',
    plugin: { scope: 'active', call: "registerTaskGroup({ command: '/mmc', … })" },
    service: { instance: 2, registry: [{ command: '/mmc', copy: 1 }] },
    phone: null,
  },
  {
    title: '协作站自己重载',
    text: '旧作用域撤掉、新作用域注册第 2 份。旧的撤掉函数就算在新注册之后才被调用，也只撤它自己那一份：撤之前比对注册表里的还是不是它。',
    plugin: { scope: 'active', call: "registerTaskGroup({ command: '/mmc', … })" },
    service: { instance: 2, registry: [{ command: '/mmc', copy: 2 }] },
    phone: null,
  },
  {
    title: '协作站卸载',
    text: '作用域撤掉，注册跟着撤掉。手机上再发 /mmc，回「没有指令 /mmc」，不派出。',
    plugin: { scope: 'gone', call: '撤掉函数()' },
    service: { instance: 2, registry: [] },
    phone: { send: '/mmc 再跑一次', reply: '没有指令 /mmc，这条没有派出。', tone: 'warn' },
  },
];

/** 作用域三种状态在画面上的写法 */
export const scopeLabels = { waiting: '等 gwbQqBot 出现', active: '回调已运行', gone: '作用域已撤掉' };
