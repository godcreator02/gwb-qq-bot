/**
 * 派任务 src/dispatch/ 的内部接缝图：模块页 <SeamMap module="dispatch" /> 画的就是它。
 * 框是目录里的文件，方块是文件对外给的东西；灰色实线框是装配、claude-agent、连接与收发和聊天表。
 * 坐标在 dispatch.layout.ts。
 */
import { defineSeamGraph } from '@godcreator/docfirst-explainer/seam-graph';

export const dispatchGraph = defineSeamGraph({
  id: 'dispatch',
  title: '派任务内部的文件与接缝',
  intro:
    '派任务内部接缝图：虚线框是 src/dispatch/ 下的文件，框里的方块是它对外给的函数与类，灰色实线框是目录外的装配、claude-agent、连接与收发和聊天表。chat-rounds.ts 在中间，别的文件都是它用的纯函数与注册表。',
  frameLabel: '文件',
  modules: [
    {
      id: 'wiring',
      name: '装配',
      pkg: 'src/index.ts · src/rounds.ts',
      role: null,
      outside: true,
      blurb: 'index.ts 持有插件注册表和可选注入的 claude-agent，服务的两个注册方法直接进注册表；命令与入站私聊经 rounds.ts 转给 chat-rounds.ts。读设置（default-workspace、owner-openid、idle-hours）的函数也从这里传进来。',
      caps: [
        { id: 'a-svc', name: '服务方法', ident: 'GwbQqBot（index.ts）' },
        { id: 'a-rnd', name: '接线：入站与命令', ident: 'Rounds（rounds.ts）' },
      ],
    },
    {
      id: 'exec',
      name: 'claude-agent',
      pkg: '可选 inject gwbClaudeAgent',
      role: null,
      outside: true,
      blurb: 'gwb-claude-agent 的 cordis 服务。装着才派得出任务；它装上（包括它自己重载后）时，装配让在做的轮次接着等。模型、token、轮数上限都是它的设置。',
      caps: [
        { id: 'x-start', name: '开一轮', ident: 'create · send → { sessionId, round, model }' },
        { id: 'x-wait', name: '等结束、读进度', ident: 'waitRound · status' },
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
      blurb: '每个私聊的每个组各有会话与队列，一组一次一轮：消息入队、交给 claude-agent 开一轮、等这一轮结束、把最后一条回复发回、接着开下一轮。改聊天表都在串行队列里做；调 claude-agent、发 QQ 消息、执行直接命令都在队列外面做。',
      caps: [
        { id: 'cr-cmd', name: '命令：绑定、登记组、列组、状态', ident: 'bind · unbind · addGroup · removeGroup · listGroups · summary' },
        { id: 'cr-wait', name: '等结束；重载后接着等', ident: 'waitAndClose · resumeWaiting' },
        { id: 'cr-in', name: '入站：分发、入队或当场回', ident: 'handleAdmitted · answer' },
        { id: 'cr-round', name: '一轮：派出、收尾', ident: 'takeNextRound · startNext · closeRound · advance' },
        { id: 'cr-deliver', name: '保留命令、直接命令与投递', ident: 'status · freshSession · runDirectCommand · deliver' },
      ],
    },
    {
      id: 'gs',
      name: '会话选择',
      pkg: 'group-session.ts',
      role: 'amber',
      outside: false,
      blurb: '纯函数：下一轮接着用这一组的会话，还是开新会话（没有会话、工作区变了、空闲超时）；空闲时长组自己给了用组的，没给用设置 idle-hours，设置不是正数回原因。',
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
      blurb: '私聊行里按组名记会话、在做的一轮（含 claude-agent 的会话号与轮数）、队列与上一条任务的时间；另记命令登记的任务组。',
      caps: [{ id: 'st', name: '每个私聊每组一份状态', ident: 'ChatTable.serial · groupState · openRounds' }],
    },
  ],
  entries: [],
  seams: [
    /* ref file="../plugins/qq-bot/src/rounds.ts" lines="53-102" hash="0272a229e912" blob="b6110e59a544" */
    {
      n: 1,
      name: '接线转进来',
      a: ['a-rnd'],
      b: ['cr-cmd', 'cr-wait', 'cr-in'],
      iface: 'handleAdmitted(message) · resumeWaiting() · bind · unbind · addGroup · removeGroup · listGroups · summary',
      convention: false,
      via: 'code',
      text: '入站私聊过了白名单才进来；命令 qq-bot.bind、group.*、status 都经接线转到这里。连上机器人、claude-agent 装上时各调一次 resumeWaiting。QQ 没连上时没有接线，命令直接报错。',
    },
    /* ref file="../plugins/qq-bot/src/dispatch/chat-rounds.ts" lines="167-183" hash="9e69ca0997ee" blob="1bae6e1bce18" */
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
    /* ref file="../plugins/qq-bot/src/dispatch/chat-rounds.ts" lines="128-135" hash="80f91ccbf8f6" blob="1bae6e1bce18" */
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
    /* ref file="../plugins/qq-bot/src/dispatch/command-registry.ts" lines="66-82" hash="a91aa77baae8" blob="57372ee11366" */
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
    /* ref file="../plugins/qq-bot/src/dispatch/command-registry.ts" lines="26-50" hash="f63e574d9446" blob="57372ee11366" */
    {
      n: 5,
      name: '校验',
      a: ['reg-reg', 'cr-cmd'],
      b: ['rt-name', 'args-check'],
      iface: 'commandNameProblem(command) · parseTaskGroupDefinition(raw, where) · onlyKeys / requireText / requireExistingDirectory',
      convention: false,
      via: 'code',
      text: '插件注册与 qq-bot.group.add 走同一个校验：命令名、称呼、工作区、可选的要求与空闲时长，别的键（包括已经删掉的 agent）一律报错。不查 claude-agent 装没装，派任务时没装就把原因回给私聊。',
    },
    /* ref file="../plugins/qq-bot/src/dispatch/group-session.ts" lines="14-20" hash="43a3b8e8ba92" blob="1a863e70c7f2" */
    {
      n: 6,
      name: '会话',
      a: ['cr-round'],
      b: ['gs-choose'],
      iface: 'chooseSession(state, { workspace }, now, idleHours) → reuse | fresh | idle',
      convention: false,
      via: 'code',
      text: '开一轮时在串行队列里定下会话：定了开新会话就当场清掉旧的。空闲超时开的新会话，回执里写明空闲了多久。',
    },
    /* ref file="../plugins/qq-bot/src/dispatch/chat-rounds.ts" lines="255-261" hash="1a67aa5163e0" blob="1bae6e1bce18" */
    /* ref file="../plugins/qq-bot/src/dispatch/chat-rounds.ts" lines="313-345" hash="c019023bf9d8" blob="1bae6e1bce18" */
    {
      n: 7,
      name: 'claude-agent',
      a: ['cr-round', 'cr-wait'],
      b: ['x-start', 'x-wait'],
      iface: 'create({ workspace, prompt }) · send({ workspace, sessionId, prompt }) · waitRound({ workspace, sessionId, round }) · status({ workspace, sessionId })',
      convention: false,
      via: 'code',
      text: '派出时开新会话调 create、接着用调 send，交回的会话号与轮数记进这一轮；然后调 waitRound 等它结束，最后一条回复原样发回。没装 claude-agent 时派出这一轮作废、原话回给私聊。重载后凭聊天表里记下的会话号与轮数接着等；还没拿到会话号的那一轮作废。',
    },
    /* ref file="../plugins/qq-bot/src/dispatch/chat-rounds.ts" lines="549-556" hash="2c18839d08c2" blob="1bae6e1bce18" */
    {
      n: 8,
      name: '收发',
      a: ['cr-in', 'cr-round', 'cr-deliver'],
      b: ['q-in', 'q-reply'],
      iface: 'intakeFirstDelivery(table, message, onFirstDelivery) · MessageLog.inbound(message, route) · ReplySender.reply(target, trigger, text, purpose, quote?)',
      convention: false,
      via: 'code',
      text: '回执引用刚收到的那条，一轮的结果引用派出这一轮的那条；结果被动、主动都发不出去，连同要引用的消息 id 和组名记进这个私聊的没送达。连接与收发不认识任务组：收下的消息分到哪（inbound 的 route）、每条出站是哪一种、哪个组、第几轮（reply 的 purpose）由这里传过去，记进消息记录。',
    },
    /* ref file="../plugins/qq-bot/src/storage/chat-table.ts" lines="382-396" hash="a01f99657cca" blob="85ca3a3dcf0c" */
    {
      n: 9,
      name: '聊天表',
      a: ['cr-cmd', 'cr-wait', 'cr-in', 'cr-round', 'cr-deliver'],
      b: ['st'],
      iface: 'ChatTable.serial(run) · groupState(chat, group) · openRounds() · book.groups',
      convention: false,
      via: 'code',
      text: '一个组第一次有任务时才在私聊行里建出它的状态；重载后从 openRounds 取出所有私聊里在做的一轮接着等。',
    },
  ],
});
