/**
 * 「一条消息分到哪」的全部讲解数据：画面（message-routing.tsx）只读这一份。
 * 五道检查照 routing.ts 里 routeMessage 的顺序排，前一道能下结论就不往下走；回给手机的话照 chat-rounds.ts 与 routing.ts 里的原文。
 * 例子里假设：主人私聊没绑定、用设置里的默认工作区（称呼「个人空间」）；用命令登记了任务组 /mmc（「混合型 MMC 样机」，交给 Claude Code）；
 * 有插件注册了直接命令 /血糖；/论文 既被命令登记过，又被一个插件注册了。
 */

/**
 * 分到哪之后的三种去向：派出（进队列）、当场回一句、不派出
 * @typedef {'task' | 'answer' | 'refuse'} Kind
 */

/** @type {Record<Kind, string>} */
export const kindLabels = { task: '进队列、派给 agent', answer: '当场回一句', refuse: '不派出' };

/**
 * 五道检查。outs 是这一道能直接给出的结论；第一段是第一个空白（半角、全角空格或换行）之前的那一段
 * @typedef {{ id: string, when: string, kind: Kind, label: string }} Outcome
 * @type {{ id: string, q: string, detail: string, outs: Outcome[] }[]}
 */
export const checks = [
  /* ref file="../plugins/qq-bot/src/dispatch/routing.ts" lines="48-48" hash="718ce8f3d59e" blob="4ba17a7cf705" */
  {
    id: 'slash',
    q: '整条消息以「/」开头吗？',
    detail: '不以斜杠开头的整条都是任务正文，正文中间出现命令也不算。',
    outs: [{ id: 'default-task', when: '不是', kind: 'task', label: '进默认组的队列' }],
  },
  /* ref file="../plugins/qq-bot/src/dispatch/routing.ts" lines="49-51" hash="9b968a0991d4" blob="4ba17a7cf705" */
  {
    id: 'reserved',
    q: '第一段是 /帮助 或 /状态 吗？',
    detail: '这两个保留命令后面不带别的文字。',
    outs: [
      { id: 'help', when: '/帮助', kind: 'answer', label: '回全部指令' },
      { id: 'status', when: '/状态', kind: 'answer', label: '补发或逐组报状态' },
      { id: 'reserved-usage', when: '后面还有字', kind: 'refuse', label: '回用法' },
    ],
  },
  /* ref file="../plugins/qq-bot/src/dispatch/routing.ts" lines="52-56" hash="b4a28f55b0ea" blob="4ba17a7cf705" */
  {
    id: 'fresh',
    q: '第一段是 /新会话 吗？',
    detail: '后面不写是默认组，写一个组名是那一组，多于一个词回用法。',
    outs: [
      { id: 'fresh-default', when: '后面没字', kind: 'answer', label: '默认组下一条开新会话' },
      { id: 'fresh-group', when: '一个组名', kind: 'answer', label: '那一组下一条开新会话' },
      { id: 'fresh-usage', when: '不止一个词', kind: 'refuse', label: '回用法' },
    ],
  },
  /* ref file="../plugins/qq-bot/src/dispatch/routing.ts" lines="57-60" hash="e44af8487631" blob="4ba17a7cf705" */
  /* ref file="../plugins/qq-bot/src/dispatch/chat-rounds.ts" lines="110-117" hash="80f91ccbf8f6" blob="b57d400e44e3" */
  {
    id: 'registered',
    q: '第一段和哪个注册过的命令完全相同？',
    detail: '不做前缀匹配、不设别名。命令登记的组与插件注册的项用了同一个命令，算重名。',
    outs: [
      { id: 'unknown', when: '一个都不同', kind: 'refuse', label: '回「没有指令」' },
      { id: 'conflict', when: '两处同名', kind: 'refuse', label: '回重名' },
      { id: 'direct', when: '直接命令', kind: 'answer', label: '插件当场回一句' },
    ],
  },
  /* ref file="../plugins/qq-bot/src/dispatch/routing.ts" lines="61-62" hash="369d2c447643" blob="4ba17a7cf705" */
  {
    id: 'body',
    q: '组命令后面有正文吗？',
    detail: '正文是第一段后面的部分，去掉首尾空白。',
    outs: [
      { id: 'group-usage', when: '没有', kind: 'refuse', label: '回用法' },
      { id: 'group-task', when: '有', kind: 'task', label: '进那一组的队列' },
    ],
  },
];

/**
 * 几种典型情况：message 是手机上发的那条，path 是依次经过的检查与每一道的回答，result 是落在哪个结论上，
 * reply 是机器人回的话（… 表示省略的部分）
 * @type {{ id: string, label: string, message: string, path: [string, string][], result: string, reply: string, text: string }[]}
 */
/* ref file="../plugins/qq-bot/src/dispatch/chat-rounds.ts" lines="167-183" hash="7f3c999f20d6" blob="b57d400e44e3" */
/* ref file="../plugins/qq-bot/src/dispatch/chat-rounds.ts" lines="280-283" hash="9a1d9ac5281c" blob="b57d400e44e3" */
/* ref file="../plugins/qq-bot/src/dispatch/chat-rounds.ts" lines="119-121" hash="bc908f85b40a" blob="b57d400e44e3" */
/* ref file="../plugins/qq-bot/src/dispatch/chat-rounds.ts" lines="434-434" hash="a257d34f29d3" blob="b57d400e44e3" */
/* ref file="../plugins/qq-bot/src/dispatch/routing.ts" lines="50-54" hash="ccfeea48248d" blob="4ba17a7cf705" */
/* ref file="../plugins/qq-bot/src/dispatch/routing.ts" lines="61-61" hash="5e8ed20c9310" blob="4ba17a7cf705" */
export const cases = [
  {
    id: 'plain',
    label: '直接发文字',
    message: '帮我看下今天的日志',
    path: [['slash', '不是']],
    result: 'default-task',
    reply: '【默认】已接收，交给 ZCode 在「个人空间」里做，做完回你。\n会话 a1b2 · 第 3 轮',
    text: '不以「/」开头，第一道就分完：进默认组的队列。默认组没有在做的一轮就马上派出，回执开头写组名，第二行是会话号末 4 位和这个会话的第几轮。',
  },
  {
    id: 'group',
    label: '组命令加任务',
    message: '/mmc 把 DSP 的采样频率改成 20k',
    path: [['slash', '是'], ['reserved', '不是'], ['fresh', '不是'], ['registered', '任务组 /mmc'], ['body', '有']],
    result: 'group-task',
    reply: '【mmc】已接收，交给 Claude Code 在「混合型 MMC 样机」里做，做完回你。\n会话 9f3c · 第 1 轮',
    text: '第一段 /mmc 是一个任务组的命令，后面的「把 DSP 的采样频率改成 20k」是任务正文，进 mmc 组自己的队列。mmc 组和默认组各排各的，可以同时在做。',
  },
  {
    id: 'group-empty',
    label: '只发组命令',
    message: '/mmc',
    path: [['slash', '是'], ['reserved', '不是'], ['fresh', '不是'], ['registered', '任务组 /mmc'], ['body', '没有']],
    result: 'group-usage',
    reply: '用法：/mmc <任务>，命令后面空一格写要做的事',
    text: '组命令后面没有正文，没有可派的任务：回一句用法，不进队列。',
  },
  {
    id: 'no-space',
    label: '命令后面没空格',
    message: '/mmc把采样频率改成20k',
    path: [['slash', '是'], ['reserved', '不是'], ['fresh', '不是'], ['registered', '一个都不同']],
    result: 'unknown',
    reply: '没有指令 /mmc把采样频率改成20k，这条没有派出。\n（后面附上 /帮助 的全部内容）',
    text: '第一段是到第一个空白为止的整段，这里整条都是第一段，和 /mmc 不完全相同。不做前缀匹配，所以回「没有指令」，不会猜成 /mmc。',
  },
  {
    id: 'typo',
    label: '拼错的命令',
    message: '/mcc 把采样频率改成 20k',
    path: [['slash', '是'], ['reserved', '不是'], ['fresh', '不是'], ['registered', '一个都不同']],
    result: 'unknown',
    reply: '没有指令 /mcc，这条没有派出。\n（后面附上 /帮助 的全部内容）',
    text: '以「/」开头却不是任何命令，回「没有指令」并附上帮助，不当成任务派到默认组：拼错的命令该当场报出来。代价是真想发以「/」开头的任务文本要换个写法。',
  },
  {
    id: 'fresh',
    label: '/新会话',
    message: '/新会话',
    path: [['slash', '是'], ['reserved', '不是'], ['fresh', '后面没字']],
    result: 'fresh-default',
    reply: '【默认】下一条起用新会话；在做的这一轮照常回报。',
    text: '清掉默认组记着的会话，下一条任务开新会话；在做的那一轮不受影响。',
  },
  {
    id: 'fresh-group',
    label: '/新会话 组名',
    message: '/新会话 mmc',
    path: [['slash', '是'], ['reserved', '不是'], ['fresh', '一个组名']],
    result: 'fresh-group',
    reply: '【mmc】下一条起用新会话；在做的这一轮照常回报。',
    text: '组名是命令去掉斜杠。只清 mmc 组的会话，别的组照常接着用。写了不存在的组名，回一句并列出可用的组名。',
  },
  {
    id: 'status',
    label: '/状态',
    message: '/状态',
    path: [['slash', '是'], ['reserved', '/状态']],
    result: 'status',
    reply: '【默认】空闲\n【mmc】还在做第 1 轮。最新的回答末尾：\n……',
    text: '有没送达的结果就只补发它们；没有就逐组报：空闲，或在做第几轮、排队几条。在做的组顺带问一次执行端，做完了却没回报的就收尾发回最后的回答。',
  },
  {
    id: 'help',
    label: '/帮助',
    message: '/帮助',
    path: [['slash', '是'], ['reserved', '/帮助']],
    result: 'help',
    reply: 'QQ → 本机 agent。直接发的文字进默认组（「个人空间」，交给 ZCode）；……\n保留指令：……\n任务组（发「命令 任务」）：\n/mmc — 混合型 MMC 样机\n直接命令：\n/血糖 — 查最近的血糖',
    text: '内容按此刻注册的现算：保留命令、全部任务组、全部直接命令。插件卸掉了，它注册的命令下一次就不在列表里。',
  },
  {
    id: 'help-extra',
    label: '/帮助 带了字',
    message: '/帮助 一下',
    path: [['slash', '是'], ['reserved', '后面还有字']],
    result: 'reserved-usage',
    reply: '/帮助 后面不带别的文字，只发 /帮助',
    text: '保留命令后面带了别的文字，回用法。',
  },
  {
    id: 'direct',
    label: '直接命令',
    message: '/血糖',
    path: [['slash', '是'], ['reserved', '不是'], ['fresh', '不是'], ['registered', '直接命令 /血糖']],
    result: 'direct',
    reply: '（插件的处理函数交回的那句话）',
    text: '处理函数拿到命令后面的正文（这里是空串）和发消息的人的 openid，交回一段文字，按被动回复发回。不排队、不开会话、不派给 agent；处理函数抛错就回「指令 /血糖 出错：原话」。',
  },
  {
    id: 'conflict',
    label: '重名',
    message: '/论文 整理第三章',
    path: [['slash', '是'], ['reserved', '不是'], ['fresh', '不是'], ['registered', '两处同名']],
    result: 'conflict',
    reply: '指令 /论文 同时是命令登记的任务组和插件 … 注册的任务组，派不出去：请在 GWB 用 qq-bot.group.remove 删掉命令登记的那个。',
    text: '登记和注册时都查重名，正常不会同名；只有插件在聊天表读回之前就注册了同一个命令时才会这样。派到它的消息回重名、不派出，连上时日志也记一行。',
  },
];
