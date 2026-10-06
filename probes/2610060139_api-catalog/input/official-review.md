# QQ API v2 官方目录只读复核

核对日期：2026-10-06（Asia/Shanghai）。本笔记只记录官方文档，不使用用户凭据、不发送消息、不改变权限。接口是否可用须以主实验的真实请求结果为准。

## 目录覆盖

- 官方 VuePress 当前脚本 `https://qq-ai.cdn-go.cn/web/bot-docs/-/v1.33.0/assets/js/app.67bb54ce.js` 提供 208 个 `/develop/api-v2/` 路由，其中 191 个 HTML 页面、17 个目录路径。
- 191 个页面全量读取；额外读取 17 个目录路径。目录页不提供额外 REST：`autogen/` 为已有 47 REST / 22 事件索引，其余目录为空分类页或概念介绍。
- `endpoints.json` 按 HTTP method + 模板 path 去重：96 个 REST，含 47 个 autogen、1 个鉴权接口、48 个 legacy 新增接口。HTTP 方法为 GET 33、POST 29、DELETE 17、PATCH 6、PUT 11。
- 旧频道私信页包含 3 个 REST，表情表态页包含 3 个 REST，均已逐项纳入；群禁言批量/全员文档共用一个 method + path，保留两个来源。示例中的数字 ID URL 不另算接口。
- 2 个子频道公告接口文档标记已废弃，清单保留 `deprecated`。事件是平台下行，不应伪装为可逐个 GET 的接口；小程序 `qq.getGuildInfo` 是客户端 API，不是机器人 REST。

## 与本次身份问题直接相关

| 官方入口 | 能得到什么 | 文档前提与限制 |
|---|---|---|
| [GET 群成员列表](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_members.get.html) | 群成员 `member_openid`、昵称、`bot`、可选 `union_openid` | 内邀接入，接口白名单；60 QPM；每页最多 30；11253 的指引为联系平台运营申请权限 |
| [GET 群成员详情](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_members_member_openid.get.html) | 已知成员详细信息及可能的统一标识 | 内邀白名单；30 QPM；调用前必须已经知道 member_openid，不是 QQ 号/应用 ID 的转换接口 |
| [GET 机器人群内状态](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_bot_state.get.html) | 当前调用机器人的 member_openid、群角色、接收设置 | 没有指定另一机器人的参数；不能据此得到其他机器人的本应用 ID |
| [GET 机器人详情](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/users_me.get.html) | 当前机器人的 ID、资料；特殊申请时的 union_openid/union_user_account | 文档明确统一字段需特殊申请；示例有字段不代表实际应用已获授权 |
| [群 @ 事件](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_at_message_create.html) | author、mentions、引用元素 author 都定义了 User | mentions 描述为不含机器人自身；定义不等于每次回调都有字段；引用示例本身只有聚合文本，无 author |
| [群成员加入事件](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_member_add.html) | 新入群成员 member_openid | Intent `GROUP_MEMBER_EVENT (1<<24)`；这是与 bit25 群 @ 独立的事件订阅。未说明机器人新入群必定按普通成员下发，不得声称可行 |
| [入群申请列表](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_join_request_list.get.html) | 申请人 member_openid、bot、昵称等 | 机器人须为群管理员；只有实际申请者，不是当前全部成员 |
| [群黑名单查询](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_member_blacklist.get.html) | 被拉黑成员 member_openid、bot | 内邀白名单；不是当前成员列表，不应通过拉黑制造数据 |
| [群禁言状态查询](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_restrict_chat_setting.get.html) | 当前禁言成员 member_openid | 需群管理员；不是全部成员，不应通过禁言制造数据 |

本轮全目录未发现公开的 `QQ号 → 本应用群成员 OpenID`、`AppID → 对方群成员 OpenID`、`另一应用 OpenID → 当前应用 OpenID` 转换 REST。此为对已抓取当前文档范围的结论，不等于平台绝不存在未公开能力。

[文本交互](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/text-chain.html) 明确群聊与文字子频道使用 `<qqbot-at-user id="" />`，旧 `<@userid>` 将弃用；该页没有说明以 QQ 号、AppID 或另一应用 OpenID 替代 id，也没有明确禁止机器人互相提及。因此应分别记录标签渲染、服务端消息投递和应用回调，不能从一个阶段失败推断全部不支持。

## 旧版频道接口的意义

频道成员接口 `/guilds/{guild_id}/members` 及身份组成员接口 `/guilds/{guild_id}/roles/{role_id}/members` 是另一场景，官方写明成员列表仅私域机器人可用，公域不支持申请。不能把群 group_openid 填进去当 guild_id，也不能据频道资料证明 QQ 群 OpenID 可互换。

- [频道成员列表](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/channel/role/member/get_members.html)
- [身份组成员列表](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/channel/role/member/get_role_members.html)
- [用户对象](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/channel/manage/user/model.html)：ID 仅在机器人场景流通；关联应用统一标识需特殊申请。
- [频道权限列表](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/channel/api_permissions/get_guild_api_permission.html) 及权限申请接口仅用于频道场景；不能当作 QQ 群 11253 的通用开关。

## 可执行性划分

基础无场景 GET：`/users/@me`、`/users/@me/guilds`、`/gateway`、`/gateway/bot`。配置只读入口还包括 `/v2/menu`、`/v2/panels?scope=...`、`/v2/groups/join_approval_strategy`。面板列表 scope 必填，可分别覆盖 c2c/group/channel/dm。

QQ群只读入口按本应用真实 group_openid 请求；成员详情使用已知同应用成员 ID。频道只读入口需先从 `/users/@me/guilds` 取得真实频道，再取子频道，之后才能访问帖子、日程、消息反应等资源。空频道列表意味着依赖场景未具备，而非后续 53 个频道接口均失败。

写接口的覆盖不得等同于盲发：消息及上传可使用本实验无害素材；面板/日程等需要先保存并限定实验新资源；删除/撤回只针对实验新建对象；踢人、禁言、黑名单、改权限、审批真实入群请求都不是获取成员 ID 的查询手段。用户明确拒绝更改“接收全部消息”，实验不得更改该设置。

未在本研究中实测任何接口。`manualReview=false` 表示路由声明已核对，绝不表示调用已验证或全部副作用已获授权。
