import {readFile} from 'node:fs/promises';
import {watch} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {api,peers,save} from './api.mjs';
const a=peers.find(p=>p.label==='A'),b=peers.find(p=>p.label==='B');
const mappings=JSON.parse(await readFile(new URL('./input/peer-ids.json',import.meta.url),'utf8'));
const mention=mappings.find(p=>p.caller==='A').targetMemberOpenid;
const ledger=join(process.env.APPDATA,'gwb-kernel','homes',b.home,'data','qq-bot','direct-report-tasks.json');
const before=JSON.parse(await readFile(ledger,'utf8'));
const source=before.sources.find(s=>s.target===b.group);
const seen=new Set(before.seen);
let watcher,timer,debounce;
const waiting=new Promise((resolve,reject)=>{
 watcher=watch(ledger,()=>{clearTimeout(debounce);debounce=setTimeout(async()=>{try{const book=JSON.parse(await readFile(ledger,'utf8'));const found=book.seen.find(s=>!seen.has(s)&&JSON.parse(s)[0]===source.id);if(found){clearTimeout(timer);watcher.close();resolve(JSON.parse(found)[1]);}}catch{}},700);});
 timer=setTimeout(()=>reject(Error('No fresh trigger in 30 seconds')),30000);
});
try{
 assert.ok((await api(a,'POST',`/v2/groups/${a.group}/messages`,{msg_type:2,markdown:{content:`<qqbot-at-user id="${mention}" /> /帮助`}})).ok);
 const msgId=await waiting;
 for(const [msg_type,msg_seq,label] of [[0,4,'TEXT'],[2,5,'MARKDOWN']]){
  const content=`【机器人回执】\nFORMAT-${label}：正文没有任何提及标签，这是显示格式测试。`;
  assert.ok((await api(b,'POST',`/v2/groups/${b.group}/messages`,{msg_type,...(msg_type===0?{content}:{markdown:{content}}),msg_id:msgId,msg_seq})).ok);
 }
}finally{watcher?.close();clearTimeout(timer);clearTimeout(debounce);await save({purpose:'Compare passive text and markdown without explicit mention'});}
