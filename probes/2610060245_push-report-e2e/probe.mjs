import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {watch} from 'node:fs';
import {join} from 'node:path';
import {api,peers,save} from './api.mjs';
import {mcp} from './mcp.mjs';
const source=process.argv[2]??'A';
const mappings=JSON.parse(await readFile(new URL('./input/peer-ids.json',import.meta.url),'utf8'));
const sender=peers.find(x=>x.label===source);
const mapping=mappings.find(x=>x.caller===source);
const receiver=peers.find(x=>x.label===mapping.target);
const index=await mcp(receiver.home,'index');
if(index.home!==receiver.home)throw Error('Wrong home');
if(!index.commands.some(g=>g.names.includes('zcode.report')))throw Error('Missing zcode.report');
const marker=`主动回报验证-${source}-${Date.now()}`;
const incomingPeer=mappings.find(x=>x.caller===receiver.label).targetMemberOpenid;
const before=(await mcp(receiver.home,'run',{command:'qq-bot.status',args:{}})).data.sessions.find(x=>x.openid===incomingPeer)?.roundIndex??0;
const dir=join(process.env.APPDATA,'gwb-kernel','homes',receiver.home,'data','qq-bot');
const ledger=join(dir,'tasks.json');
let closed=false,watcher,timer,settled,busy=false;
const completed=new Promise((resolve,reject)=>{
 const check=async()=>{
  if(closed||busy)return;
  busy=true;
  try {
   const state=await mcp(receiver.home,'run',{command:'qq-bot.status',args:{}});
   const session=state.data.sessions.find(x=>x.openid===incomingPeer);
   if(!session?.resultDelivered||session.roundIndex<=before)return;
   const data=JSON.parse(await readFile(ledger,'utf8'));
   const job=data.jobs.find(j=>j.text?.includes(marker)&&j.delivery==='delivered');
   if(job){closed=true;clearTimeout(timer);watcher.close();resolve(job);}
  }catch{}finally{busy=false;}
 };
 watcher=watch(dir,()=>{clearTimeout(settled);settled=setTimeout(()=>void check(),300);});
 timer=setTimeout(()=>{closed=true;watcher.close();reject(Error('No delivered callback within 180s'));},180000);
});
try {
 const content=`<qqbot-at-user id="${mapping.targetMemberOpenid}" /> 这是主动回报联调。结果文本只写“${marker}成功”。不读写文件，不运行其他任务。请按本轮附加的回报约定调用指定 MCP 服务的 zcode.report，然后结束。`;
 const result=await api(sender,'POST',`/v2/groups/${sender.group}/messages`,{msg_type:2,markdown:{content}});
 if(!result.ok)throw Error('QQ send failed');
 console.log(JSON.stringify({sent:source,to:mapping.target,marker,receiverHome:receiver.home}));
 const job=await completed;
 const status=await mcp(receiver.home,'run',{command:'qq-bot.status',args:{}});
 await save({question:'真实 QQ 入站任务是否经正确 home 的 MCP 主动回报并立即送回 QQ？',marker,receiverHome:receiver.home,job,status,proof:'fs.watch observed persisted callback and delivered state; no zcode.status was called by this probe'});
} catch(error) { await save({marker,error:String(error)});throw error; }
finally {closed=true;clearTimeout(timer);clearTimeout(settled);watcher?.close();}
