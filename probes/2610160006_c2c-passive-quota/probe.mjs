// 单聊被动回复的额度：同一条用户消息最多能被动回复几次，「输入中」（msg_type 6）占不占额度。用法见 README 第一行
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const [mode, triggerMsgId, countArg = '5'] = process.argv.slice(2);
const plainCount = Number(countArg);
if (!['plain', 'typing'].includes(mode) || !triggerMsgId || !Number.isInteger(plainCount) || plainCount < 1 || plainCount > 30) {
  throw new Error('用法：node probe.mjs <plain|typing> <触发消息 msg_id> [plain 发几条，1–30，缺省 5]');
}

const target = JSON.parse(await readFile(new URL('./input/target.json', import.meta.url), 'utf8'));
const home = join(process.env.APPDATA, 'gwb-kernel', 'homes', target.home);
const settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'))['qq-bot'];
const appId = String(settings['app-id'].value);
const openid = String(settings['owner-openid'].value);
const secret = JSON.parse(await readFile(join(home, 'credentials.json'), 'utf8')).sections['qq-bot']['app-secret'].value;

const tokenResponse = await fetch('https://api.bot.qq.com/app/getAppAccessToken', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({appId, clientSecret: secret}),
});
const {access_token: token} = await tokenResponse.json();
if (!token) throw new Error(`拿 access token 失败：HTTP ${tokenResponse.status}`);

const markdown = (label, seq) => ({label, body: {msg_type: 2, markdown: {content: `【被动额度实验 ${label}】msg_seq ${seq}`}, msg_id: triggerMsgId, msg_seq: seq}});
const typing = (label, seq) => ({label, body: {msg_type: 6, input_notify: {input_type: 1, input_second: 60}, msg_id: triggerMsgId, msg_seq: seq}});

// 触发消息是 /帮助：qq-bot 已经用掉 1 次被动回复（msg_seq 1），这里的序号从 11 / 21 起，不和它重复
const cases = mode === 'plain'
  ? Array.from({length: plainCount}, (_, i) => markdown(`P${i + 1}`, 11 + i))
  : [typing('T1', 21), typing('T2', 22), ...[23, 24].map((seq, i) => markdown(`M${i + 1}`, seq))];
// 「输入中」之后停 15 秒再发下一条，人在手机上才看得到它，也看得出第二次续上了没有
const pauseAfterMs = (msgType) => msgType === 6 ? 15000 : 1500;

const records = [];
for (const {label, body} of cases) {
  const response = await fetch(`https://api.bot.qq.com/v2/users/${openid}/messages`, {
    method: 'POST',
    headers: {Authorization: `QQBot ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  records.push({at: new Date().toISOString(), label, msgType: body.msg_type, msgSeq: body.msg_seq, http: response.status, body: raw});
  console.log(JSON.stringify({label, msgType: body.msg_type, msgSeq: body.msg_seq, http: response.status, body: raw.slice(0, 300)}));
  // 连着两次被拒就算探到了上限，后面的不再发
  if (records.length >= 2 && records.slice(-2).every(record => record.http !== 200)) break;
  await new Promise(resolve => setTimeout(resolve, pauseAfterMs(body.msg_type)));
}

const runs = new URL('./runs/', import.meta.url);
await mkdir(runs, {recursive: true});
const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
await writeFile(new URL(`${stamp}-${mode}.json`, runs), JSON.stringify({node: process.version, mode, records}, null, 2));
