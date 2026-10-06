import type { GwbContext } from '@godcreator/gwb-kernel-desktop'
// 空的类型 import 只为让这几个包的 `declare module 'cordis'` 生效，ctx 上才有 gwbCommands / gwbSettings 的类型
import type {} from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-settings'
import type {} from '@godcreator/gwb-skills'
import type {} from '@godcreator/gwb-data'
import path from 'node:path'
import { ChatBridge } from './bridge.js'
import { QqGateway } from './qq-gateway.js'
import { QqRestClient } from './qq-rest.js'
import { parseProbeArgs } from './probe.js'

/**
 * node 侧：QQ 官方机器人当通道，把私聊 / 群 @ 的任务文本转给所选原生 agent 执行，接收主动回报。
 * 无界面；连接状态与会话映射经 qq-bot.status 查
 */
export const name = 'gwb-qq-bot'

export const inject = ['gwbCommands', 'gwbSettings', 'gwbData']

const KEY_APP_ID = 'app-id'
const KEY_APP_SECRET = 'app-secret'
const KEY_SANDBOX = 'sandbox'
const KEY_ALLOWED_OPENIDS = 'allowed-openids'
const KEY_DEFAULT_WORKSPACE = 'default-workspace'

export function apply(ctx: GwbContext): void {
  let disposed = false
  const log = ctx.logger(name)
  const settings = ctx.gwbSettings
  const commands = ctx.gwbCommands
  if (settings === undefined || commands === undefined) throw new Error('ctx.gwbSettings / ctx.gwbCommands 不在：inject 里写了它们，cordis 本不该调用 apply')

  settings.define({
    key: KEY_APP_ID,
    title: 'AppID',
    type: 'string',
    description: 'QQ 开放平台（q.qq.com）机器人的 AppID。改了它要调 qq-bot.reconnect（或重载本插件）才生效',
    default: '',
  })
  settings.define({
    key: KEY_APP_SECRET,
    title: 'AppSecret',
    type: 'secret',
    description: 'QQ 开放平台机器人的 AppSecret，与 AppID 一起用于换 access token。改了它要调 qq-bot.reconnect 才生效',
  })
  settings.define({
    key: KEY_SANDBOX,
    title: '沙箱环境',
    type: 'boolean',
    description: 'false 使用当前官方 api.bot.qq.com；true 仅兼容旧 sandbox.api.sgroup.qq.com 沙箱。新版后台的开发体验号码也用 false。改了要调 qq-bot.reconnect 才生效',
    default: true,
  })
  settings.define({
    key: KEY_ALLOWED_OPENIDS,
    title: '允许的 openid 白名单',
    type: 'string-list',
    description:
      '允许使用机器人的 QQ 用户 openid（官方 API 给的标识，每个机器人各不相同，不是 QQ 号）。空名单谁都用不了；谁发过消息被拒了，去 qq-bot.status 的 recentRejected 里看 openid 再加进来',
    default: [],
  })
  settings.define({
    key: KEY_DEFAULT_WORKSPACE,
    title: '默认工作区',
    type: 'string',
    description: '主人私聊默认工作区（绝对路径）；群来源由项目绑定指定目录。为空时需要显式绑定',
    default: '',
  })

  const appId = (): string => readString(settings.get(KEY_APP_ID))
  const appSecret = (): string => readString(settings.get(KEY_APP_SECRET))
  const sandbox = (): boolean => settings.get(KEY_SANDBOX) === true
  // 入站来源与出站凭据使用同一连接快照，设置修改在 reconnect 时一起生效。
  let activeAppId = appId(), activeSecret = appSecret(), activeSandbox = sandbox()
  const rest = new QqRestClient(() => activeAppId, () => activeSecret, () => activeSandbox, log)
  for (const definition of [
    { key: 'report-mcp-server', title: '回报 MCP 服务名', type: 'string' as const, default: 'gwb', description: '执行端配置中连接到本 home 的 MCP 服务名；两个 home 必须分别配置，不能共用一个入口' },
    { key: 'owner-openid', title: '主人私聊 openid', type: 'string' as const, default: '', description: '主动通知唯一收件人；填写从本机器人私聊消息取得的 openid，并加入白名单。不能填写另一个机器人的标识' },
    { key: 'journal-library', title: '随手记笔记库', type: 'string' as const, default: '', description: '本 home 中随手记的目标库 id；留空时由 agent 先确认目标库，不猜测' },
  ]) settings.define(definition)
  const bridge = new ChatBridge({
    home: path.basename(ctx.gwbKernel.dataDir),
    appId: () => activeAppId,
    runCommand: (commandName, args) => commands.run(commandName, args),
    defaultWorkspace: () => readString(settings.get(KEY_DEFAULT_WORKSPACE)),
    allowedOpenids: () => readStringList(settings.get(KEY_ALLOWED_OPENIDS)),
    sendC2c: (openid, content, msgId, msgSeq) => rest.sendC2c(openid, { content, msgId, msgSeq }),
    sendGroup: (groupOpenid, content, msgId, msgSeq) => rest.sendGroup(groupOpenid, { content, msgId, msgSeq }),
    reportServer: () => readString(settings.get('report-mcp-server')),
    journalLibrary: () => readString(settings.get('journal-library')),
    ownerOpenid: () => readString(settings.get('owner-openid')),
    read: () => ctx.gwbData.readDoc('direct-report-tasks'),
    write: (value) => ctx.gwbData.writeDoc('direct-report-tasks', value),
    log,
  })
  const gateway = new QqGateway(rest, log, {
    onMessage: (message) => {
      void bridge.handleIncoming(message).catch((error: unknown) => {
        log.error(`QQ ${message.scene} 消息处理失败：${String(error)}`)
      })
    },
    onState: (state, detail) => {
      log.info(`QQ 网关状态：${state}${detail === undefined ? '' : `（${detail}）`}`)
    },
  })

  const startIfConfigured = async (): Promise<boolean> => {
    if (disposed) return false
    if (appId() === '' || appSecret() === '') {
      log.info('QQ 机器人的 AppID / AppSecret 没配置，不连接；配置后调 qq-bot.reconnect')
      return false
    }
    activeAppId = appId(); activeSecret = appSecret(); activeSandbox = sandbox()
    await bridge.restore()
    if (disposed) return false
    gateway.start()
    return true
  }

  commands.register(
    {
      name: 'qq-bot.status',
      description: '读 QQ 通道状态：连接、聊天来源与绑定、独立会话、排队和历史任务',
      usage: '无参数。回 { gateway, sandbox, appIdConfigured, appSecretSet, defaultWorkspace, allowedOpenidCount, sources, conversations, queuedTasks, unresolvedTasks, pendingResults, recentRejected }；每项按来源而不是按发言人区分。来源的 id 用于 qq-bot.bind；unresolvedTasks 含 jobId/sourceId/taskId/workspace，人工核对后可用 qq-bot.resolve 解除未确认派单。',
      effect: 'read',
    },
    async () => {
      return {
        ok: true,
        data: {
          gateway: gateway.currentState,
          sandbox: sandbox(),
          appIdConfigured: appId() !== '',
          appSecretSet: appSecret() !== '',
          defaultWorkspace: readString(settings.get(KEY_DEFAULT_WORKSPACE)),
          allowedOpenidCount: readStringList(settings.get(KEY_ALLOWED_OPENIDS)).length,
          ...bridge.report(),
        },
      }
    },
  )

  commands.register(
    {
      name: 'qq-bot.reconnect',
      description: '改完 QQ 机器人的 AppID / AppSecret / 沙箱设置后调它：断开当前网关连接并按新配置重连',
      usage: '无参数。AppID / AppSecret 没配置时报错，不连接',
      effect: 'write',
    },
    async () => {
      gateway.stop()
      rest.resetAuth()
      if (!(await startIfConfigured())) throw new Error('AppID / AppSecret 没配置：先到设置的 qq-bot 分区填好再重连')
      return { ok: true, data: { gateway: gateway.currentState } }
    },
  )

  commands.register({ name: 'qq-bot.report', description: '执行中的 agent 直接提交本轮 QQ 任务结果',
    usage: '{ticket:string,state:completed|failed|needs_input,text:string}。ticket 由本轮任务提供，正文1~16000字符，不接受收件人或会话ID。返回 {recorded:true,duplicate,delivery}，recorded只表示已落盘，不保证QQ已送达。超时仅用同票同结果重交，不重做任务。', effect: 'external' },
    async (raw) => ({ ok: true, data: await bridge.receiveReport(raw) }))
  commands.register({ name: 'qq-bot.agents', description: '列出 QQ 支持的 agent 适配接口（不表示原生插件已安装或在线）', usage: '无参数。回 {agents:[{id,title}]}。绑定前确认对应插件已安装，执行环境已配置本 home 的 MCP。', effect: 'read' }, async () => ({ ok: true, data: { agents: bridge.agentOptions() } }))
  commands.register({ name: 'qq-bot.agent', description: '切换一个聊天的 agent，保留项目和日志库并开始新会话', usage: '{sourceId:string,agent:zcode|claudecode}。仅限已绑定且无排队、执行中或派发不明任务的来源；相同选择幂等，旧会话不转移到新执行端。', effect: 'write' }, async (raw) => ({ ok: true, data: await bridge.switchAgent(raw) }))
  commands.register({ name: 'qq-bot.notify', description: '主动私聊通知已配置的主人，相同 id 不重复发送',
    usage: '{id: string, text: string}。正文 1–600 字符；主人由 owner-openid 配置并须在白名单中；失败不自动重试。回 {delivered, duplicate}。', effect: 'external' },
    async (raw) => ({ ok: true, data: await bridge.notify(raw) }))

  commands.register({ name: 'qq-bot.sources', description: '查看本 home 当前机器人的聊天来源与项目、个人空间绑定',
    usage: '无参数，返回来源数组：id、home、appId、scene、target、lastSeen、lastSender、generation、binding。群与私聊标识独立；先在目标聊天发 /帮助 取得真实来源，再用 id 绑定。', effect: 'read' },
    async () => ({ ok: true, data: await bridge.sources() }))
  commands.register({ name: 'qq-bot.bind', description: '将已观察到的群绑定到协作项目，或将私聊绑定到个人工作区',
    usage: '{sourceId:string, projectRepo?:string, workspace?:string, journalLibrary?:string, agent?:zcode|claudecode}。群必须 projectRepo（已登记的 collab.projects 项目根），不收 workspace；私聊必须绝对路径 workspace，不收 projectRepo。journalLibrary 留空不使用笔记库；非空时经 block-note.lib.list 校验库存在、且库的插件白名单含 @godcreator/gwb-bn-journal，读不到库列表或校验不过都拒绝绑定。agent 缺省保持原选择，新来源默认 zcode；改变 agent 开始新会话。忙碌或派单未确认时拒绝；改绑新建上下文，不复用旧会话。返回来源及绑定。', effect: 'write' },
    async (raw) => ({ ok: true, data: await bridge.bind(raw) }))
  commands.register({ name: 'qq-bot.unbind', description: '解除聊天绑定，保留历史任务，不再从此来源派新任务',
    usage: '{sourceId:string}。有执行中、排队、派单未确认任务时拒绝。解绑后主人私聊也不再自动继承默认工作区，需要重新显式绑定。返回来源及空绑定。', effect: 'write' },
    async (raw) => ({ ok: true, data: await bridge.unbind(raw) }))
  commands.register({ name: 'qq-bot.resolve', description: '人工确认执行端已停止后结束未确认派单，恢复工作区队列',
    usage: '{jobId:string, confirmedStopped:true, note:string}。先查 qq-bot.status 的 unresolvedTasks，并核对 执行端会话确实没在执行；只接受当前机器人的 dispatch_unknown 任务。note 1–600 字符，保存核对理由；不取消、不重派原任务，标为 failed 并通知原来源，推进后续队列。回 {resolved:true, duplicate}，相同理由可重复确认。', effect: 'external' },
    async (raw) => ({ ok: true, data: await bridge.resolve(raw) }))

  commands.register(
    {
      name: 'qq-bot.probe',
      description:
        '实测 QQ 官方接口限制的探针，会真的往最近一个白名单消息的来源发消息：count 连发被动回复测同一消息能回几次；length 逐档发主动长消息测单条长度上限',
      usage:
        '参数 { experiment: "count"|"length", sends?: number, chars?: number[] }。要求先在 QQ 上给机器人发过一条消息（探针以它为触发源）。' +
        'count：sends 缺省 6，从该消息已用次数接着连发被动回复，失败也发完，回执逐条带 ok / HTTP 状态 / 官方 code / message；' +
        'length：chars 缺省 [600,680,700,1000,1500,2000,2500]（680 与 700 一档之差分辨限制按字节还是按字符），逐档发主动消息，仅单聊（群聊直接报错）。' +
        '回 { experiment, scene, results: [...] }。只做实测用，别在日常任务里调',
      effect: 'external',
    },
    async (raw) => {
      return { ok: true, data: await bridge.probe(parseProbeArgs(raw)) }
    },
  )

  // 说明书在包根的 skills/，相对产物 dist/index.js 写作 '../skills/'；那个目录要在 package.json 的 files 里
  ctx.inject(['gwbSkills'], (scoped) => {
    scoped.effect(() => scoped.gwbSkills.register(new URL('../skills/', import.meta.url)))
  })

  void startIfConfigured().catch((error: unknown) => log.error(`QQ 启动失败：${String(error)}`))
  ctx.effect(() => () => {
    disposed = true
    gateway.stop()
    return bridge.dispose()
  })
  log.info('已加载')
}

/** settings.get 的返回按声明类型兜不住收窄，这里显式收；收到不认识的类型当默认值，不猜 */
function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
