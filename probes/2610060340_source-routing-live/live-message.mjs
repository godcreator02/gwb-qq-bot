import {readFile} from 'node:fs/promises';
import {watch} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {api,peers,save} from './api.mjs';
import {mcp} from './mcp.mjs';
const source=process.argv[2]??'A';
const mappings=JSON.parse(await readFile(new URL('./input/peer-ids.json',import.meta.url),'utf8'));
const sender=peers.find(p=>p.label===source), mapping=mappings.find(p=>p.caller===source);
const receiver=peers.find(p=>p.label===mapping.target);
const expectedRepo='D:\\unitfolders\\b2o8l-sst-mmc-2026\\hybrid-mmc\\collab';
const index=await mcp(receiver.home,'index');assert.equal(index.home,receiver.home);
const sources=await mcp(receiver.home,'run',{command:'qq-bot.sources'});
const origin=sources.data.find(s=>s.scene==='group'&&s.target===receiver.group);
assert.equal(origin.binding.projectRepo,expectedRepo);
const marker=`来源验证-${source}-${Date.now()}`;
const dir=join(process.env.APPDATA,'gwb-kernel','homes',receiver.home,'data','qq-bot');
let closed=false,watcher,timer,debounce,busy=false;
const completed=new Promise((resolve,reject)=>{
 const check=async()=>{
  if(closed||busy)return;busy=true;
  try{
   const status=await mcp(receiver.home,'run',{command:'qq-bot.status'});
   const conversation=status.data.conversations.find(c=>c.sourceId===origin.id);
   if(!conversation?.resultDelivered||conversation.roundRunning)return;
   const ledger=JSON.parse(await readFile(join(dir,'tasks.json'),'utf8'));
   const job=ledger.jobs.find(j=>j.prompt?.includes(marker)&&j.text?.includes(marker)&&j.delivery==='delivered');
   if(job){closed=true;clearTimeout(timer);watcher.close();resolve({job,ledgerVersion:ledger.version,status});}
  }finally{busy=false;}
 };
 watcher=watch(dir,()=>{clearTimeout(debounce);debounce=setTimeout(()=>void check().catch(()=>{}),400);});
 timer=setTimeout(()=>{closed=true;watcher.close();reject(Error('No delivered source-aware report within 240s'));},240000);
});
try{
 const content=`<qqbot-at-user id="${mapping.targetMemberOpenid}" /> 来源联调：读取本轮后附的QQ来源信息，结果只写“${marker} scene=实际scene title=实际title”。不读取或修改文件，不派其他任务。只通过本轮指定 MCP 服务调用 zcode.report 提交完成结果，然后结束。`;
 const response=await api(sender,'POST',`/v2/groups/${sender.group}/messages`,{msg_type:2,markdown:{content}});
 if(!response.ok)throw Error('QQ send failed');
 console.log(JSON.stringify({sent:source,to:receiver.label,marker}));
 const result=await completed;
 assert.equal(result.ledgerVersion,2);assert.equal(result.job.sourceId,origin.id);
 assert.equal(result.job.workspace,expectedRepo);assert.equal(result.job.source.scene,'group');
 assert.equal(result.job.source.target,receiver.group);assert.equal(result.job.source.appId,receiver.appId);
 assert.equal(result.job.source.home,receiver.home);assert.equal(result.job.source.title,'混合型 MMC 样机');
 assert.match(result.job.text,/scene=group/);assert.match(result.job.text,/title=混合型 MMC 样机/);
 await save({question:'真实群 @ 是否路由到指定协作站、新建来源独立会话，并由回调送回原群？',marker,receiver:receiver.label,passed:true,...result});
 console.log(JSON.stringify({passed:true,receiver:receiver.label,taskId:result.job.taskId,text:result.job.text,delivery:result.job.delivery}));
}catch(error){await save({marker,passed:false,error:String(error)});throw error;}
finally{closed=true;clearTimeout(timer);clearTimeout(debounce);watcher?.close();}
