import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {watch} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {api,peers,records} from './api.mjs';
import {mcp} from './mcp.mjs';
const agent=process.argv[2]??'claudecode';assert.ok(['zcode','claudecode'].includes(agent));
const a=peers.find(p=>p.label==='A'),b=peers.find(p=>p.label==='B');
const mention=JSON.parse(await readFile(new URL('./input/peer-ids.json',import.meta.url),'utf8')).find(p=>p.caller==='A').targetMemberOpenid;
const base=join(process.env.APPDATA,'gwb-kernel','homes',b.home);
const ledger=join(base,'data','qq-bot','direct-report-tasks.json');
const at=new Date().toISOString(),marker=`B-SEAMS-${agent}-${Date.now()}`;
const result={at,agent,marker,home:b.home,passed:false};
const sanitize=(v,k='')=>/ticket|token|secret|authorization/i.test(k)?'<REDACTED>':Array.isArray(v)?v.map(x=>sanitize(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([key,val])=>[key,sanitize(val,key)])):typeof v==='string'?v.replace(/[a-f0-9]{64}/giu,'<REDACTED>'):v;
async function run(command,args={}){const r=await mcp(b.home,'run',{command,args});assert.ok(r.ok,`${command}: ${r.error??'failed'}`);return r.data;}
let watcher,timer,debounce,source,original,bound=false;
try{
 assert.equal((await mcp(b.home,'index')).home,b.home);
 result.plugins=(await run('plugin-manager.list')).filter(p=>/gwb-(qq-bot|zcode|claudecode|collab|bn-journal|bn-core)$/.test(p.pkg));
 const pkg=JSON.parse(await readFile(join(base,'package.json'),'utf8'));
 for(const [name,spec] of Object.entries(pkg.dependencies))if(/gwb-(qq-bot|zcode|claudecode|collab)$/.test(name)&&spec.startsWith('file:./dev-packs/'))await copyFile(join(base,spec.slice(7)),new URL(`./input/${spec.split('/').at(-1)}`,import.meta.url));
 source=(await run('qq-bot.sources')).find(s=>s.scene==='group'&&s.target===b.group);assert.ok(source.binding.projectRepo);original=source.binding;
 await run('qq-bot.bind',{sourceId:source.id,projectRepo:original.projectRepo,journalLibrary:'notes',agent});bound=true;
 const before=await run('collab.inbox',{repo:original.projectRepo});
 result.expectedInbox={tasks:before.tasks.length,mentions:before.mentions.length,repliesToMe:before.repliesToMe.length};
 const completed=new Promise((resolve,reject)=>{
  watcher=watch(join(base,'data','qq-bot'),()=>{clearTimeout(debounce);debounce=setTimeout(async()=>{try{const book=JSON.parse(await readFile(ledger,'utf8'));const job=book.jobs.find(j=>j.prompt?.includes(marker));if(job?.text!=null&&job.delivery==='delivered'){clearTimeout(timer);watcher.close();resolve(job);}}catch{}},700);});
  timer=setTimeout(()=>reject(Error('No delivered result within 240 seconds')),240000);
 });
 const text=`这是业务接缝测试。请经本轮指定 home 的 MCP 读取绑定项目的 collab.inbox，只报告 tasks、mentions、repliesToMe 数量，不复述项目内容。然后在本聊天已绑定的隔离 notes 库当日日志创建且只创建一条原文：${marker}。先读 bn-journal 说明书，再 ensure、block.create；回报前读回这一条，确认没有重复。不要改项目文件、不要提交或联网取回项目、不要派单。最后调用本轮 qq-bot.report，text 为 JSON 字符串，包含 marker、blockId、lib、repo、tasks、mentions、repliesToMe。`;
 assert.ok((await api(a,'POST',`/v2/groups/${a.group}/messages`,{msg_type:2,markdown:{content:`<qqbot-at-user id="${mention}" /> ${text}`}})).ok);
 const job=await completed;result.job=job;
 assert.equal(job.agent,agent);assert.equal(job.sourceId,source.id);assert.equal(job.source.journalLibrary,'notes');assert.equal(job.state,'completed');
 const day=await run('bn-journal.day',{lib:'notes'});result.entries=day.entries.filter(e=>e.source.includes(marker));assert.equal(result.entries.length,1);assert.ok(job.text.includes(result.entries[0].id));
 const parsed=JSON.parse(job.text.replace(/^```(?:json)?\s*|\s*```$/g,''));assert.equal(parsed.marker,marker);assert.equal(parsed.lib,'notes');assert.equal(parsed.repo.toLowerCase().replaceAll('/','\\'),original.projectRepo.toLowerCase().replaceAll('/','\\'));
 for(const key of ['tasks','mentions','repliesToMe'])assert.equal(parsed[key],result.expectedInbox[key]);
 result.passed=true;
}catch(error){result.error=String(error);process.exitCode=1;}
finally{
 watcher?.close();clearTimeout(timer);clearTimeout(debounce);
 if(bound){try{await run('qq-bot.bind',{sourceId:source.id,projectRepo:original.projectRepo,journalLibrary:original.journalLibrary,agent:original.agent});result.restored=true;}catch(error){result.restoreError=String(error);process.exitCode=1;}}
 result.requests=records;const file=new URL(`./runs/${at.replaceAll(':','').replaceAll('.','-')}-${agent}.json`,import.meta.url);await writeFile(file,JSON.stringify(sanitize(result),null,2));console.log(JSON.stringify({agent,passed:result.passed,error:result.error,restored:result.restored,file:file.pathname,entries:result.entries?.map(e=>e.id)}));
}
