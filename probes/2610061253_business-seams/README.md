`node probe.mjs claudecode`

## 问什么

QQ 架构 B 的 ZCode / Claude Code 能否读取绑定协作站、写入指定隔离日志库，并直接回报原群？

## 怎么运行

Node 24，零外部依赖；第二次运行 `node probe.mjs zcode`。固定 QQ 身份来自 input，本机凭据只在所属 home 读取。临时给测试群绑定隔离 home 的 notes 日志库，每轮创建一条唯一标记日志，结束后恢复原绑定。协作站只读 inbox，不改真实项目、不提交 git、不派其他任务。原始结果追加 runs；库只记录当前标记和块 ID，不导出其他日志或项目内容。

## 结论

以每次运行的 passed、实际日记读回数量和 QQ delivery 为准；派单 accepted 不算完成。

## 运行那次的环境

2026-10-06，Windows、Node v24.14.1；QQ 基线 98c25f5d44b31e8802d3ba035fe4e3354e1288f7。运行记录保存现场插件版本；input 保存本次安装包。只验证 qqbotb-2610052319，不向 default 日志写测试内容。
