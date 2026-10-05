import type { GwbContext } from '@godcreator/gwb-kernel-desktop'
// 空的类型 import 只为让这几个包的 `declare module 'cordis'` 生效，ctx 上才有 gwbCommands / gwbSettings 的类型
import type {} from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-settings'
import type {} from '@godcreator/gwb-skills'
import { ZcodeBridge } from './bridge.js'
import { QqGateway } from './qq-gateway.js'
import { QqRestClient } from './qq-rest.js'
import { parseProbeArgs } from './probe.js'

/**
 * node 侧：QQ 官方机器人当通道，把私聊 / 群 @ 的任务文本转给 ZCode 桌面端执行，轮询结果回推。
 * 无界面；连接状态与会话映射经 qq-bot.status 查
 */
export const name = 'gwb-qq-bot'

export const inject = ['gwbCommands', 'gwbSettings']

const KEY_APP_ID = 'app-id'
const KEY_APP_SECRET = 'app-secret'
const KEY_SANDBOX = 'sandbox'
const KEY_ALLOWED_OPENIDS = 'allowed-openids'
const KEY_DEFAULT_WORKSPACE = 'default-workspace'

export function apply(ctx: GwbContext): void {
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
    description: 'true 连沙箱环境（sandbox.api.sgroup.qq.com，只收发沙箱配置里的测试用户与测试群的消息）；false 连正式环境。改了要调 qq-bot.reconnect 才生效',
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
    description: '派任务时 ZCode 在哪个目录干活（绝对路径）。相当于 zcode.create 的 workspace 参数；为空时机器人会提示先配置',
    default: '',
  })

  const appId = (): string => readString(settings.get(KEY_APP_ID))
  const appSecret = (): string => readString(settings.get(KEY_APP_SECRET))
  const sandbox = (): boolean => settings.get(KEY_SANDBOX) === true

  const rest = new QqRestClient(appId, appSecret, sandbox, log)
  const bridge = new ZcodeBridge({
    runCommand: (commandName, args) => commands.run(commandName, args),
    defaultWorkspace: () => readString(settings.get(KEY_DEFAULT_WORKSPACE)),
    allowedOpenids: () => readStringList(settings.get(KEY_ALLOWED_OPENIDS)),
    sendC2c: (openid, content, msgId, msgSeq) => rest.sendC2c(openid, { content, msgId, msgSeq }),
    sendGroup: (groupOpenid, content, msgId, msgSeq) => rest.sendGroup(groupOpenid, { content, msgId, msgSeq }),
    every: (intervalMs, callback) => {
      const timer = setInterval(callback, intervalMs)
      return () => clearInterval(timer)
    },
    log,
  })
  const gateway = new QqGateway(rest, log, {
    onMessage: (message) => {
      void bridge.handleIncoming(message)
    },
    onState: (state, detail) => {
      log.info(`QQ 网关状态：${state}${detail === undefined ? '' : `（${detail}）`}`)
    },
  })

  const startIfConfigured = (): boolean => {
    if (appId() === '' || appSecret() === '') {
      log.info('QQ 机器人的 AppID / AppSecret 没配置，不连接；配置后调 qq-bot.reconnect')
      return false
    }
    gateway.start()
    return true
  }

  commands.register(
    {
      name: 'qq-bot.status',
      description: '读 QQ 机器人通道的状态：网关连接、配置齐不齐、每个用户的 ZCode 会话映射、最近被白名单拒掉的消息',
      usage: '无参数。回 { gateway, sandbox, appIdConfigured, appSecretSet, defaultWorkspace, allowedOpenidCount, sessions, recentRejected }；recentRejected 里的 openid 复制进设置的 allowed-openids 即完成绑定',
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
      if (!startIfConfigured()) throw new Error('AppID / AppSecret 没配置：先到设置的 qq-bot 分区填好再重连')
      return { ok: true, data: { gateway: gateway.currentState } }
    },
  )

  commands.register(
    {
      name: 'qq-bot.probe',
      description:
        '实测 QQ 官方接口限制的探针，会真的往最近一个白名单消息的来源发消息：count 连发被动回复测同一消息能回几次；length 逐档发主动长消息测单条长度上限',
      usage:
        '参数 { experiment: "count"|"length", sends?: number, chars?: number[] }。要求先在 QQ 上给机器人发过一条消息（探针以它为触发源）。' +
        'count：sends 缺省 6，从该消息已用次数接着连发被动回复，失败也发完，回执逐条带 ok / HTTP 状态 / 官方 code / message；' +
        'length：chars 缺省 [600,680,700,1000,1500,2000,2500]（680 与 700 一档之差分辨限制按字节还是按字符），逐档发主动消息，仅单聊（群聊会耗每月主动配额，直接报错）。' +
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

  startIfConfigured()
  ctx.effect(() => () => {
    gateway.stop()
    bridge.dispose()
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
