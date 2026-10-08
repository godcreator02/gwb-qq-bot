/**
 * 派任务 src/dispatch/ 的内部接缝图：模块页 <SeamMap module="dispatch" /> 画的就是它。
 * 框是目录里的文件（执行端适配层是一个子目录），方块是文件对外给的东西；灰色实线框是装配、执行端插件、连接与收发和聊天表。
 * 坐标在 dispatch.layout.ts。
 */
import { defineSeamGraph } from '@godcreator/docfirst-explainer/seam-graph';

export const dispatchGraph = defineSeamGraph({
  id: 'dispatch',
  title: '派任务内部的文件与接缝',
  intro:
    '派任务内部接缝图：虚线框是 src/dispatch/ 下的文件，框里的方块是它对外给的函数与类，灰色实线框是目录外的装配、执行端插件、连接与收发和聊天表。chat-rounds.ts 在中间，别的文件都是它用的纯函数、注册表与适配实现。',
  frameLabel: '文件',
  modules: [
    {
      id: 'wiring',
      name: '装配',
      pkg: 'src/index.ts · src/rounds.ts',
      role: null,
      outside: true,
      blurb: 'index.ts 持有插件注册表与执行端表，服务的两个注册方法直接进注册表；命令与入站私聊经 rounds.ts 转给 chat-rounds.ts。读设置（default-workspace、owner-openid、idle-hours）的函数也从这里传进来。',
      caps: [
        { id: 'a-svc', name: '服务方法', ident: 'GwbQqBot（index.ts）' },
        { id: 'a-rnd', name: '接线：入站与命令', ident: 'Rounds（rounds.ts）' },
      ],
    },
    {
      id: 'exec',
      name: '执行端插件',
      pkg: '可选 inject',
      role: null,
      outside: true,
      blurb: 'gwb-zcode 与 gwb-claudecode 的 cordis 服务。装着哪个，index.ts 才登记对应的那份适配实现，卸掉自动撤掉。',
      caps: [
        { id: 'x-zc', name: 'ZCode', ident: 'gwbZcode' },
        { id: 'x-cc', name: 'Claude Code', ident: 'gwbClaudecode' },
      ],
    },
    {
      id: 'reg',
      name: '插件注册表',
      pkg: 'command-registry.ts',
      role: 'cyan',
      outside: false,
      blurb: '插件经服务注册的任务组与直接命令，按命令名存在服务对象上。注册时校验定义、查重名，交回撤掉注册的函数；撤掉旧注册不会撤掉之后同名的新注册。',
      caps: [
        { id: 'reg-reg', name: '注册任务组与直接命令', ident: 'registerTaskGroup · registerCommand' },
        { id: 'reg-look', name: '谁占着这个命令', ident: 'holderOf · group · directCommand · requireFree' },
      ],
    },
    {
      id: 'rt',
      name: '分发与命令名',
      pkg: 'routing.ts',
      role: 'violet',
      outside: false,
      blurb: '纯函数：一条消息按第一个空白之前的那一段分到哪；命令名规则（斜杠开头、不含空白、保留命令、加权长度不超过 16）；长回答只留末尾。',
      caps: [
        { id: 'rt-route', name: '一条消息分到哪', ident: 'routeMessage · splitFirstSegment' },
        { id: 'rt-name', name: '命令名规则', ident: 'commandNameProblem · RESERVED_COMMANDS' },
      ],
    },
    {
      id: 'args',
      name: '参数校验',
      pkg: 'command-args.ts',
      role: 'slate',
      outside: false,
      blurb: '命令与注册方法的参数在系统边界上校验：只收列出的键、必填文字不能为空、工作区要是已存在目录的绝对路径。不符合就报错，不替调用方改。',
      caps: [{ id: 'args-check', name: '只收列出的键、必填不空', ident: 'onlyKeys · requireText · requireExistingDirectory' }],
    },
    {
      id: 'cr',
      name: '任务组、会话与一轮',
      pkg: 'chat-rounds.ts',
      role: 'blue',
      outside: false,
      blurb: '每个私聊的每个组各有会话与队列，一组一次一轮：消息入队、开一轮派给执行端、收回报或懒检查收尾、发回结果、接着开下一轮。改聊天表都在串行队列里做；调执行端、发 QQ 消息、执行直接命令都在队列外面做。',
      caps: [
        { id: 'cr-cmd', name: '命令：绑定、登记组、列组、状态', ident: 'bind · unbind · addGroup · removeGroup · listGroups · summary' },
        { id: 'cr-report', name: '回报：按本轮编号收尾', ident: 'report({ round, text })' },
        { id: 'cr-in', name: '入站：分发、入队或当场回', ident: 'handleAdmitted · answer' },
        { id: 'cr-round', name: '一轮：派出、收尾、懒检查', ident: 'takeNextRound · startNext · closeRound · advance' },
        { id: 'cr-deliver', name: '保留命令、直接命令与投递', ident: 'status · freshSession · runDirectCommand · deliver' },
      ],
    },
    {
      id: 'ex',
      name: '执行端适配层',
      pkg: 'executors/',
      role: 'emerald',
      outside: false,
      blurb: '接口按 qq-bot 自己要的两件事定：start 开一轮、交回会话号；check 问一次做完没有、交回最后的回答。每个执行端一份实现，私有，不与别的应用统一。',
      caps: [
        { id: 'ex-zc', name: 'ZCode 那份', ident: 'zcode.ts' },
        { id: 'ex-cc', name: 'Claude Code 那份', ident: 'claudecode.ts' },
        { id: 'ex-table', name: '执行端表', ident: 'ExecutorTable · Executor · EXECUTOR_IDS' },
      ],
    },
    {
      id: 'gs',
      name: '会话选择',
      pkg: 'group-session.ts',
      role: 'amber',
      outside: false,
      blurb: '纯函数：下一轮接着用这一组的会话，还是开新会话（没有会话、执行端或工作区变了、空闲超时）；空闲时长组自己给了用组的，没给用设置 idle-hours，设置不是正数回原因。',
      caps: [{ id: 'gs-choose', name: '下一轮用哪个会话、空闲多久', ident: 'chooseSession · resolveIdleHours' }],
    },
    {
      id: 'qq',
      name: '连接与收发',
      pkg: 'src/qq/',
      role: null,
      outside: true,
      blurb: '收下消息时建私聊行、按消息 id 去重；发回执与结果时按回复窗口选被动或主动、分段、带上引用。',
      caps: [
        { id: 'q-in', name: '收下与去重', ident: 'intakeFirstDelivery' },
        { id: 'q-reply', name: '发回复', ident: 'ReplySender.reply' },
      ],
    },
    {
      id: 'store',
      name: '聊天表',
      pkg: 'src/storage/',
      role: null,
      outside: true,
      blurb: '私聊行里按组名记会话、在做的一轮、队列、上一轮的结果与上一条任务的时间；另记命令登记的任务组，以及已经让 ZCode 打开过的工作区。',
      caps: [{ id: 'st', name: '每个私聊每组一份状态', ident: 'ChatTable.serial · groupState · findRound' }],
    },
  ],
  entries: [],
  seams: [
    /* ref file="../plugins/qq-bot/src/rounds.ts" lines="54-82" hash="5fb463488257" blob="80fe8dc6f49c" */
    {
      n: 1,
      name: '接线转进来',
      a: ['a-rnd'],
      b: ['cr-cmd', 'cr-report', 'cr-in'],
      iface: 'handleAdmitted(message) · report · bind · unbind · addGroup · removeGroup · listGroups · summary',
      convention: false,
      via: 'code',
      text: '入站私聊过了白名单才进来；命令 qq-bot.bind、group.*、report、status 都经接线转到这里。QQ 没连上时没有接线，命令直接报错。',
    },
    /* ref file="../plugins/qq-bot/src/dispatch/chat-rounds.ts" lines="150-165" hash="c7939d66a45d" blob="b57d400e44e3" */
    {
      n: 2,
      name: '分发',
      a: ['cr-in'],
      b: ['rt-route'],
      iface: 'routeMessage(text, kindOf) → RoutedMessage',
      convention: false,
      via: 'code',
      text: '分发规则全在 routing.ts，它只问一个问题：这一段是哪种已注册的命令（kindOf）。分到任务的，在收下消息的同一步里进那一组的队列；其余的当场回一句。',
    },
    /* ref file="../plugins/qq-bot/src/dispatch/chat-rounds.ts" lines="110-117" hash="80f91ccbf8f6" blob="b57d400e44e3" */
    {
      n: 3,
      name: '查命令',
      a: ['cr-in', 'cr-cmd'],
      b: ['reg-look'],
      iface: 'holderOf(command) · group(command) · directCommand(command) · requireFree(command, storedGroupCommands)',
      convention: false,
      via: 'code',
      text: '命令登记的组在聊天表里，插件注册的项在注册表里；两边都有同一个命令就是重名，派到它的消息回重名、不派出。登记新组时查两边。',
    },
    /* ref file="../plugins/qq-bot/src/dispatch/command-registry.ts" lines="69-85" hash="a91aa77baae8" blob="d23387c0f04a" */
    {
      n: 4,
      name: '插件注册',
      a: ['a-svc'],
      b: ['reg-reg'],
      iface: 'registerTaskGroup(raw, { plugin, storedGroupCommands }) → () => void',
      convention: false,
      via: 'code',
      text: '服务的两个注册方法原样转进来，带上调用方的插件包名（取不到就不写）和此刻命令登记的组的命令。QQ 还没连上时后者是空的，连上以后的重名在派任务时报出。注册、撤掉都通知 onChange 的监听者，插件入口据此排一次「/」指令面板的同步。',
    },
    /* ref file="../plugins/qq-bot/src/dispatch/command-registry.ts" lines="29-53" hash="9ae281bdc22e" blob="eb57224d1c72" */
    {
      n: 5,
      name: '校验',
      a: ['reg-reg', 'cr-cmd'],
      b: ['rt-name', 'args-check'],
      iface: 'commandNameProblem(command) · parseTaskGroupDefinition(raw, where) · onlyKeys / requireText / requireExistingDirectory',
      convention: false,
      via: 'code',
      text: '插件注册与 qq-bot.group.add 走同一个校验：命令名、称呼、工作区、执行端名、可选的要求与空闲时长。不查执行端装没装，派任务时没装就把原因回给私聊；qq-bot.group.add 另外要求执行端此刻装着。',
    },
    /* ref file="../plugins/qq-bot/src/dispatch/group-session.ts" lines="14-20" hash="045fa8fbebcf" blob="df96b60d79d3" */
    {
      n: 6,
      name: '会话',
      a: ['cr-round'],
      b: ['gs-choose'],
      iface: 'chooseSession(state, { agent, workspace }, now, idleHours) → reuse | fresh | idle',
      convention: false,
      via: 'code',
      text: '开一轮时在串行队列里定下会话：定了开新会话就当场清掉旧的。空闲超时开的新会话，回执里写明空闲了多久。',
    },
    /* ref file="../plugins/qq-bot/src/dispatch/executors/executor.ts" lines="8-17" hash="1322be235ac9" blob="2914407123d2" */
    {
      n: 7,
      name: '执行端表',
      a: ['cr-round'],
      b: ['ex-table'],
      iface: 'executors.get(agent).start({ workspace, session, prompt }) · check({ workspace, session })',
      convention: false,
      via: 'code',
      text: '派出与懒检查都按这一轮记下的执行端名取实现；没装就抛「没装执行端」，派出时这一轮作废、原话回给私聊。',
    },
    /* ref file="../plugins/qq-bot/src/dispatch/executors/zcode.ts" lines="15-43" hash="f3cf227ae739" blob="e778e5e1b4b3" */
    /* ref file="../plugins/qq-bot/src/dispatch/executors/claudecode.ts" lines="4-17" hash="e58c31dd8765" blob="cffbea3f2763" */
    {
      n: 8,
      name: '执行端插件',
      a: ['ex-zc', 'ex-cc'],
      b: ['x-zc', 'x-cc'],
      iface: 'gwbZcode.open / create / send / status（taskId、roundIsOver、replies）；gwbClaudecode.create / send / status（sessionId、status、text）',
      convention: false,
      via: 'code',
      text: '两个执行端的形状不同，翻译只在这一层：会话号是 taskId 或 sessionId；ZCode 的回答里混着工具调用记录，只取末尾 600 字。ZCode 侧栏只列打开过的工作区：聊天表里没记过的工作区，开一轮前先 open 一次，成功才记下（记录由装配接到聊天表上）；open 失败按派出失败处理。',
    },
    /* ref file="../plugins/qq-bot/src/dispatch/chat-rounds.ts" lines="537-544" hash="2c18839d08c2" blob="b57d400e44e3" */
    {
      n: 9,
      name: '收发',
      a: ['cr-in', 'cr-round', 'cr-deliver'],
      b: ['q-in', 'q-reply'],
      iface: 'intakeFirstDelivery(table, message, onFirstDelivery) · MessageLog.inbound(message, route) · ReplySender.reply(target, trigger, text, purpose, quote?)',
      convention: false,
      via: 'code',
      text: '回执引用刚收到的那条，一轮的结果引用派出这一轮的那条；结果被动、主动都发不出去，连同要引用的消息 id 和组名记进这个私聊的没送达。连接与收发不认识任务组：收下的消息分到哪（inbound 的 route）、每条出站是哪一种、哪个组、第几轮（reply 的 purpose）由这里传过去，记进消息记录。',
    },
    /* ref file="../plugins/qq-bot/src/storage/chat-table.ts" lines="339-356" hash="0415f2890ddc" blob="d94736558b46" */
    {
      n: 10,
      name: '聊天表',
      a: ['cr-cmd', 'cr-report', 'cr-in', 'cr-round', 'cr-deliver'],
      b: ['st'],
      iface: 'ChatTable.serial(run) · groupState(chat, group) · findRound(roundId) · book.groups',
      convention: false,
      via: 'code',
      text: '一个组第一次有任务时才在私聊行里建出它的状态；回报按本轮编号在所有私聊的所有组里找在做的或刚收尾的那一轮。',
    },
  ],
});
