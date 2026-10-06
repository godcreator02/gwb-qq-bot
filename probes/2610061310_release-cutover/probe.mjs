import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {mcp} from './mcp.mjs';
const home=process.argv[2],action=process.argv[3]??'verify';
assert.ok(['default','qqbotb-2610052319'].includes(home));
const specs={'@godcreator/gwb-qq-bot':'0.3.1','@godcreator/gwb-zcode':'0.2.6','@godcreator/gwb-claudecode':'0.2.1','@godcreator/gwb-collab':'0.21.7'};
const result={at:new Date().toISOString(),home,action,passed:false};
async function run(command,args={}){const r=await mcp(home,'run',{command,args});assert.ok(r.ok,`${command}: ${r.error}`);return r.data;}
try{
 assert.equal((await mcp(home,'index')).home,home);
 if(action==='update'){
  const installed=await run('plugin-manager.list');
  const existing=Object.fromEntries(Object.entries(specs).filter(([pkg])=>installed.some(p=>p.pkg===pkg)));
  result.update=await run('plugin-manager.update',{specs:existing});
  for(const [pkg,spec] of Object.entries(specs))if(!(pkg in existing))await run('plugin-manager.install',{pkg,spec});
  result.reload=await run('shell.reload');
 }else{
  const plugins=await run('plugin-manager.list');
  result.plugins=plugins.filter(p=>p.pkg in specs);
  result.versions={};
  for(const [pkg,version] of Object.entries(specs)){
   const p=result.plugins.find(p=>p.pkg===pkg);assert.ok(p?.entries.some(e=>e.active));assert.equal(p.unmetPeers.length,0);
   const manifest=JSON.parse(await readFile(join(process.env.APPDATA,'gwb-kernel','homes',home,'node_modules',pkg,'package.json'),'utf8'));
   result.versions[pkg]=manifest.version;assert.equal(manifest.version,version);
  }
  result.sources=await run('qq-bot.sources');
  result.agents=await run('qq-bot.agents');
  result.status=await run('qq-bot.status');
 }
 result.passed=true;
}catch(error){result.error=String(error);process.exitCode=1;}
const file=new URL(`./runs/${Date.now()}-${home}-${action}.json`,import.meta.url);
await writeFile(file,JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
