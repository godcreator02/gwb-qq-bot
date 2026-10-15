// 单聊原生 markdown（msg_type 2）的边界：被动回复加引用、可能被误渲染的正文、长度上限。用法见 README 第一行
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const [triggerMsgId] = process.argv.slice(2);
if (!triggerMsgId) throw new Error('用法：node probe.mjs <触发消息 msg_id>');

const target = JSON.parse(await readFile(new URL('./input/target.json', import.meta.url), 'utf8'));
const home = join(process.env.APPDATA, 'gwb-kernel', 'homes', target.home);
const settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'))['qq-bot'];
if (String(settings['app-id'].value) !== target.appId) throw new Error('AppID 与 input/target.json 不一致');
const secret = JSON.parse(await readFile(join(home, 'credentials.json'), 'utf8')).sections['qq-bot']['app-secret'].value;

const tokenResponse = await fetch('https://api.bot.qq.com/app/getAppAccessToken', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({appId: target.appId, clientSecret: secret}),
});
const {access_token: token} = await tokenResponse.json();
if (!token) throw new Error(`拿 access token 失败：HTTP ${tokenResponse.status}`);

const misrenderSample = [
  '【P2 误渲染检查：被动回复】',
  '路径 D:\\unitfolders\\evew5-gwbapps\\gwb-qq-bot\\plugins\\qq_bot\\src',
  '蛇形 snake_case_name 和 a_b_c',
  '算式 2*3*4 与 a * b * c',
  '仓号 god-private/gwb-cgm-alert#1',
  '#1 行首的井号',
  '尖括号 <div>x</div> 与 a<b>c',
  '1) 括号编号',
  '(1/2) 分段前缀',
  '网址 https://github.com/godcreator02/gwb-qq-bot',
  '反斜杠 \\_ \\* \\\\ 三个',
].join('\n');

function longMarkdown(label, chars) {
  const lines = [`【${label}：目标 ${chars} 字】`, '', '## 小标题', '```ts', 'const answer = 42', '```', ''];
  for (let n = 1; lines.join('\n').length < chars; n++) lines.push(`- 第 ${n} 行：用来凑长度的列表项，看分段前后渲染是否完整。`);
  return lines.join('\n').slice(0, chars);
}

const cases = [
  {label: 'P1 被动 + 引用', body: {msg_type: 2, markdown: {content: '【P1 被动 + 引用】\n\n**粗体** 与 `行内代码`\n\n- 列表一\n- 列表二'}, msg_id: triggerMsgId, msg_seq: 11, message_reference: {message_id: triggerMsgId, ignore_get_message_error: true}}},
  {label: 'P2 误渲染检查', body: {msg_type: 2, markdown: {content: misrenderSample}, msg_id: triggerMsgId, msg_seq: 12}},
  {label: 'L1 主动 + 引用 2000 字', body: {msg_type: 2, markdown: {content: longMarkdown('L1 主动 + 引用', 2000)}, message_reference: {message_id: triggerMsgId, ignore_get_message_error: true}}},
  {label: 'L2 主动 5000 字', body: {msg_type: 2, markdown: {content: longMarkdown('L2 主动', 5000)}}},
];

const records = [];
for (const {label, body} of cases) {
  const response = await fetch(`https://api.bot.qq.com/v2/users/${target.openid}/messages`, {
    method: 'POST',
    headers: {Authorization: `QQBot ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  const record = {at: new Date().toISOString(), label, contentChars: body.markdown.content.length, request: body, http: response.status, body: raw};
  records.push(record);
  console.log(JSON.stringify({label, contentChars: record.contentChars, http: response.status, body: raw.slice(0, 300)}));
  await new Promise(resolve => setTimeout(resolve, 800));
}

const runs = new URL('./runs/', import.meta.url);
await mkdir(runs, {recursive: true});
const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
await writeFile(new URL(`${stamp}.json`, runs), JSON.stringify({node: process.version, triggerMsgId, records}, null, 2));
