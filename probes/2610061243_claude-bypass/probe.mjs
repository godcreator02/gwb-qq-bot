import { readFile, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { mcp } from './mcp.mjs';
import { api, peers, records } from './api.mjs';
const receiver=peers.find(p=>p.label==='B'),sender=peers.find(p=>p.label==='A');
const mappings=JSON.parse(await readFile(new URL('./input/peer-ids.json',import.meta.url),'utf8'));
const mention=mappings.find(p=>p.caller==='A').targetMemberOpenid;
const workspace='D:\\unitfolders\\b2o8l-sst-mmc-2026\\hybrid-mmc\\collab';
const ledgerDir=join(process.env.APPDATA,'gwb-kernel','homes',receiver.home,'data','qq-bot');
const ledgerFile=join(ledgerDir,'direct-report-tasks.json');
const mode=process.argv[2]??'inspect',agent=process.argv[3]??'zcode';
let watcher,timer,debounce,closed=false;
const record={mode,agent,at:new Date().toISOString(),home:receiver.home,passed:false};
async function run(command,args={}){const r=await mcp(receiver.home,'run',{command,args});assert.equal(r.ok,true,`${command} failed`);return r.data;}
const sanitize=(v,k='')=>/ticket|token|secret|authorization/i.test(k)?'<REDACTED>':Array.isArray(v)?v.map(x=>sanitize(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([key,val])=>[key,sanitize(val,key)])):typeof v==='string'?v.replace(/[a-f0-9]{64}/giu,'<REDACTED>'):v;
async function send(text){const r=await api(sender,'POST',`/v2/groups/${sender.group}/messages`,{msg_type:2,markdown:{content:`<qqbot-at-user id="${mention}" /> ${text}`}});assert.equal(r.ok,true,'QQ send failed');}
function waitFor(check){
 return new Promise((resolve,reject)=>{
  let busy=false,again=false;
  const onChange=async()=>{if(closed)return;if(busy){again=true;return;}busy=true;try{const r=await check();if(r){closed=true;clearTimeout(timer);watcher.close();resolve(r);}}catch{}finally{busy=false;if(again){again=false;void onChange();}}};
  watcher=watch(ledgerDir,()=>{clearTimeout(debounce);debounce=setTimeout(()=>void onChange(),500);});timer=setTimeout(()=>{closed=true;watcher.close();reject(Error('No expected event within 240 seconds'));},240000);void onChange();
 });
}
try{
 assert.equal((await mcp(receiver.home,'index')).home,receiver.home);
 if(mode==='inspect'){
  record.status=await run('qq-bot.status'); record.agents=await run('qq-bot.agents');
  const installed=await run('plugin-manager.list'); record.plugins=installed;
  record.passed=true;
 } else if(mode==='bind') {
  const seen=waitFor(async()=>{const sources=await run('qq-bot.sources');return sources.find(s=>s.scene==='group'&&s.target===receiver.group);});
  await send('/帮助');const source=await seen;
  record.source=await run('qq-bot.bind',{sourceId:source.id,projectRepo:workspace,agent:'zcode'});record.passed=true;
 }else if(mode==='run'){
  assert.ok(['zcode','claudecode'].includes(agent));
  const sources=await run('qq-bot.sources');const source=sources.find(s=>s.scene==='group'&&s.target===receiver.group);
  assert.equal(source.binding.projectRepo,workspace);
  record.source=await run('qq-bot.agent',{sourceId:source.id,agent});
  const marker=`B-DIRECT-${agent}-${Date.now()}`;record.marker=marker;
  const completed=waitFor(async()=>{const b=JSON.parse(await readFile(ledgerFile,'utf8'));const job=b.jobs.find(j=>j.prompt?.includes(marker));if(job?.text!==null&&job?.text!==undefined&&job.delivery==='delivered')return job;});
  await send(`这是回报链路测试。只通过本轮后附服务调用 qq-bot.report，state=completed，text="${marker} scene=group title=混合型 MMC 样机"，然后结束。禁止读取或修改任何文件，不派其他任务、不发送其他消息。`);
  record.job=await completed;
  assert.equal(record.job.agent,agent);assert.equal(record.job.sourceId,source.id);assert.equal(record.job.source.home,receiver.home);assert.equal(record.job.source.appId,receiver.appId);assert.equal(record.job.workspace,workspace);assert.ok(record.job.text.includes(marker));
  record.passed=true;
 }else throw Error('Unknown mode');
}catch(error){record.error=String(error);process.exitCode=1;try{record.status=await run('qq-bot.status');const b=JSON.parse(await readFile(ledgerFile,'utf8'));record.jobs=b.jobs.map(({prompt,ticketHash,...job})=>job);}catch{}}
finally{
 closed=true;watcher?.close();clearTimeout(timer);clearTimeout(debounce);record.requests=records;
 const file=new URL(`./runs/${record.at.replaceAll(':','').replaceAll('.','-')}-${mode}-${agent}.json`,import.meta.url);
 await writeFile(file,JSON.stringify(sanitize(record),null,2));
 console.log(JSON.stringify({mode,agent,passed:record.passed,error:record.error,file:file.pathname,job:record.job?{agent:record.job.agent,taskId:record.job.taskId,text:record.job.text,delivery:record.job.delivery}:undefined}));
}
