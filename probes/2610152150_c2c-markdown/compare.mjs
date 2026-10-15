import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const appId = '<APP_ID_A>';
const openid = '<OPENID_OWNER_A>';
const home = join(process.env.APPDATA, 'gwb-kernel', 'homes', 'default');
const settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'))['qq-bot'];
if (String(settings['app-id'].value) !== appId) throw new Error('AppID mismatch');
const secret = JSON.parse(await readFile(join(home, 'credentials.json'), 'utf8')).sections['qq-bot']['app-secret'].value;

const tokenResponse = await fetch('https://api.bot.qq.com/app/getAppAccessToken', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({appId, clientSecret: secret}),
});
const {access_token: token} = await tokenResponse.json();
if (!token) throw new Error(`token failed: HTTP ${tokenResponse.status}`);

const sample = [
  '# 一级标题 H1',
  '## 二级标题 H2',
  '**粗体** *斜体* ~~删除线~~ `行内代码`',
  '',
  '- 无序列表一',
  '- 无序列表二',
  '',
  '1. 有序一',
  '2. 有序二',
  '',
  '> 引用一段',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '---',
  '[链接 github](https://github.com)',
].join('\n');

const cases = [
  ['A-纯文本 msg_type 0', {msg_type: 0, content: `【A：msg_type 0 纯文本】\n${sample}`}],
  ['B-原生 markdown msg_type 2', {msg_type: 2, markdown: {content: `【B：msg_type 2 原生 markdown】\n\n${sample}`}}],
];
for (const [label, body] of cases) {
  const response = await fetch(`https://api.bot.qq.com/v2/users/${openid}/messages`, {
    method: 'POST',
    headers: {Authorization: `QQBot ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  const text = await response.text();
  console.log(JSON.stringify({label, http: response.status, body: text.slice(0, 400)}));
  await new Promise(r => setTimeout(r, 800));
}
