`node probe.mjs --preflight`

## 问什么

将接收范围从 all 改回 only_mention，使用之前实测成功且按应用/群保存的双向成员 ID，能否继续互相 @ 并投递？

## 怎么运行

Node.js 24，零第三方依赖。首行查询两端设置并断言 only_mention。输入及客户端都是本目录独立副本；peer-ids.json 保存来源和作用域，凭据只读取本机对应 home 并校验 AppID。在线前暂停两端 QQ 插件，运行 `node probe.mjs --live`：建立两端 WS，先发送无 @ 普通消息负对照，再发送固定有效 ID 的真实 Markdown @，继续监听共约 60 秒。之后恢复插件连接。只记录测试群的选择字段，丢弃 message_scene 鉴权数据；不派 ZCode 任务。

## 结论

实测通过：runs/2026-10-05T181651-958Z.json 及同轮 events.jsonl。两端查询均为 only_mention，无 @ HELLO 没有入站；使用保存 ID 发出的 Markdown @ 双向均收到 GROUP_AT_MESSAGE_CREATE。正文实际保留 `[@机器人名字]`，且不含 mentions；实现不能一律假设平台已剥掉前缀。此实验未派 ZCode 任务。ID 在这次模式切换前后可复用，不等于退群重加、应用关系变化后永久不变。

## 运行那次的环境

2026-10-06，Windows，Node.js 24，正式 API，项目基线 98c25f5d44b31e8802d3ba035fe4e3354e1288f7。控制变量为客户端接收范围；身份映射、应用和群与前次 all 实验相同。官方文档固定在 input/docs.json。
