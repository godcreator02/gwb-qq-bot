import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {api,peers,records,delay} from './api.mjs';
import {mcp} from './mcp.mjs';
const a=peers.find(p=>p.label==='A'),b=peers.find(p=>p.label==='B');
const ids=JSON.parse(await readFile(new URL('./input/peer-ids.json',import.meta.url),'utf8'));
const result={at:new Date().toISOString(),passed:false};
try{
 assert.ok((await api(b,'POST',`/v2/groups/${b.group}/messages`,{msg_type:2,markdown:{content:`<qqbot-at-user id="${ids.find(i=>i.caller==='B').targetMemberOpenid}" /> /帮助`}})).ok);
 await delay(2000);
 const sources=await mcp(a.home,'run',{command:'qq-bot.sources',args:{}});assert.ok(sources.ok);
 const source=sources.data.find(s=>s.scene==='group'&&s.target===a.group);assert.ok(source,'A has not observed group');
 const bind=await mcp(a.home,'run',{command:'qq-bot.bind',args:{sourceId:source.id,projectRepo:'D:\\unitfolders\\b2o8l-sst-mmc-2026\\hybrid-mmc\\collab',agent:'zcode',journalLibrary:''}});
 assert.ok(bind.ok,JSON.stringify(bind));result.binding=bind.data;result.passed=true;
}catch(e){result.error=String(e);process.exitCode=1;}
result.requests=records;
await writeFile(new URL(`./runs/${Date.now()}-rebind.json`,import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:result.passed,error:result.error,binding:result.binding}));
