import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mcp} from './mcp.mjs';
const peers=JSON.parse(await readFile(new URL('./input/targets.json',import.meta.url),'utf8'));
const mode=process.argv[2]??'inspect';
const project='D:\\unitfolders\\b2o8l-sst-mmc-2026\\hybrid-mmc\\collab';
const results=[];
async function run(home,command,args={}) {return mcp(home,'run',{command,args});}
for(const peer of peers){
 const index=await mcp(peer.home,'index');
 if(index.home!==peer.home)throw Error('Wrong home');
 const status=await run(peer.home,'qq-bot.status');
 const projects=await run(peer.home,'collab.projects');
 const packages=await run(peer.home,'plugin-manager.list');
 const base=join(process.env.APPDATA,'gwb-kernel','homes',peer.home,'data','qq-bot');
 const ledger=JSON.parse(await readFile(join(base,'tasks.json'),'utf8'));
 let backup=null;try{backup=JSON.parse(await readFile(join(base,'tasks-before-source-routing.json'),'utf8'));}catch{}
 const row={home:peer.home,appId:peer.appId,status,projects,packages,ledger,backupVersion:backup?.version??null,backupJobIds:backup?.jobs?.map(j=>j.id)??[]};
 row.installedVersion=JSON.parse(await readFile(join(process.env.APPDATA,'gwb-kernel','homes',peer.home,'node_modules','@godcreator','gwb-qq-bot','package.json'),'utf8')).version;
 if(mode==='verify'){
  try{
  assert.equal(ledger.version,2);assert.equal(backup?.version,1);
  for(const old of backup.jobs){const current=ledger.jobs.find(j=>j.id===old.id);assert.ok(current);assert.equal(current.taskId,old.taskId);assert.equal(current.route.target,old.route.target);assert.equal(current.text,old.text);}
  const bot=packages.data.find(p=>p.pkg==='@godcreator/gwb-qq-bot');assert.ok(bot.entries.every(e=>e.active));assert.deepEqual(bot.unmetPeers,[]);
  assert.match(row.installedVersion,/^0\.2\.1-dev\./);
  assert.equal(status.data.gateway,'open');
  const source=ledger.sources.find(s=>s.scene==='group'&&s.target===peer.group&&s.appId===peer.appId);assert.equal(source.home,peer.home);assert.equal(source.binding.projectRepo,project);
  const oldTasks=new Set(backup.jobs.map(j=>j.taskId));assert.ok(ledger.conversations.every(c=>!oldTasks.has(c.taskId)));
  for(const name of ['qq-bot.sources','qq-bot.bind','qq-bot.unbind','qq-bot.resolve'])assert.ok(index.commands.some(g=>g.names.includes(name)));
  row.verified=true;
  }catch(error){row.verified=false;row.error=String(error);process.exitCode=1;}
 }
 if(mode==='bind'){
  const sources=await run(peer.home,'qq-bot.sources');
  if(!sources.ok)throw Error(JSON.stringify(sources));
  const source=sources.data.find(s=>s.scene==='group'&&s.target===peer.group&&s.appId===peer.appId);
  if(!source)throw Error('Expected actual group source missing');
  row.bind=await run(peer.home,'qq-bot.bind',{sourceId:source.id,projectRepo:project});
  row.after=await run(peer.home,'qq-bot.sources');
 }
 results.push(row);
 console.log(JSON.stringify({home:peer.home,version:ledger.version,installedVersion:row.installedVersion,verified:row.verified,gateway:status.data.gateway,jobs:ledger.jobs.length,backupVersion:row.backupVersion,projects:projects.data?.projects?.map(p=>({repo:p.repo,title:p.summary?.title,error:p.error})),bind:row.bind}));
}
await mkdir(new URL('./runs/',import.meta.url),{recursive:true});
const file=new URL(`./runs/${new Date().toISOString().replaceAll(':','').replaceAll('.','-')}-${mode}.json`,import.meta.url);
await writeFile(file,JSON.stringify({at:new Date().toISOString(),mode,node:process.version,scriptSha256:createHash('sha256').update(await readFile(new URL('./probe.mjs',import.meta.url))).digest('hex'),results},null,2));
console.log(JSON.stringify({saved:file.pathname}));
if(mode==='bind'&&results.some(r=>!r.bind?.ok))process.exitCode=1;
