`node probe.mjs`

## 问什么

当前官方 API v2 文档到底有多少去重 REST 接口，现有两个机器人实际调用了哪些，哪些因为权限或缺少真实场景尚未完成？

## 怎么运行

在本目录运行第一行命令，Node.js 24，零依赖。此命令对本目录固定的 `input/endpoints.json` 与 `input/http-observations.json` 做离线交叉核对，生成 `coverage.md` 和新增 `runs/*.json`，不会发消息或改平台配置。

目录清单的来源、前提、副作用保存在每条 endpoint 的 sources 等字段；文档目录与 SHA256 保存在 `input/document-index.json`，完整抓取正文固定在 `input/official-pages.json` 和 `input/official-directories.json`，研究说明在 `input/official-review.md`。`node extract.mjs` 可从本目录固定正文重提取接口到新增 runs 文件，不覆盖输入清单。HTTP 观测是其他实测实验本轮回执的精简固定副本，运行本实验不读取兄弟目录。活体 HTTP 复现由各独立实验的 README 指定，不能把离线覆盖统计说成再次在线测试。

## 结论

完整清单为 96 个 REST，包含 47 个新版 autogen 接口、鉴权以及旧版接口，按 method/path 去重。128 次实测请求覆盖 37 个接口：31 个有 HTTP 成功回执、3 个无接口权限、3 个其他失败。59 个未测：53 个缺频道资源、1 个缺互动事件、5 个涉及真实成员管理或执行审批且缺专用对象。128 次含 4 次预签名分片 PUT，这 4 次不另算机器人 REST。HTTP 成功不等于所有参数分支、客户端显示及回调验证通过。完整逐项清单见 coverage.md 与 runs。

## 运行那次的环境

2026-10-06，Windows，Node.js v24.14.1，被测项目 commit `98c25f5d44b31e8802d3ba035fe4e3354e1288f7`。官方文档 CDN 版本 v1.33.0，191 HTML 与17目录页；平台和权限会变化，清单和回执代表采集时刻。
