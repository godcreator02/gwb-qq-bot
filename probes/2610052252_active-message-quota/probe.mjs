// 主动消息配额实测：连发 N 条不带 msg_id 的单聊，逐条打印 HTTP 状态与回执。
// 用法：node probe.mjs <appId> <收件人openid> [条数=8]
// 凭据从 default home 的凭据保管读取（qq-bot 分区 app-secret），不回显。
import fs from 'node:fs'
import path from 'node:path'

const [appId, openid, countArg] = process.argv.slice(2)
if (!appId || !openid) {
  console.error('用法：node probe.mjs <appId> <收件人openid> [条数=8]')
  process.exit(1)
}
const count = Number(countArg ?? 8)

const credentialsPath = path.join(process.env.APPDATA, 'gwb-kernel', 'homes', 'default', 'credentials.json')
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
const entry = credentials?.sections?.['qq-bot']?.['app-secret']
const appSecret = typeof entry?.value === 'string' ? entry.value : null
if (!appSecret) throw new Error(`default home 凭据里没有 qq-bot/app-secret：${credentialsPath}`)

const tokenResponse = await fetch('https://bots.qq.com/app/getAppAccessToken', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ appId, clientSecret: appSecret }),
})
const token = await tokenResponse.json()
if (!token.access_token) throw new Error(`拿 token 失败：HTTP ${tokenResponse.status}`)

for (let i = 1; i <= count; i++) {
  const response = await fetch(`https://sandbox.api.sgroup.qq.com/v2/users/${openid}/messages`, {
    method: 'POST',
    headers: { Authorization: `QQBot ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 0, content: `主动消息实测 ${i}/${count}：验证配额，可忽略` }),
  })
  const body = await response.json().catch(() => null)
  console.log(`第${i}条 HTTP ${response.status} ${JSON.stringify(body)}`)
  if (i < count) await new Promise((resolve) => setTimeout(resolve, 600))
}
