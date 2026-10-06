import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {mcp} from './mcp.mjs';
const packages=['@godcreator/gwb-zcode','@godcreator/gwb-qq-bot','@godcreator/gwb-collab'];
const rows=[];
for(const home of ['default','qqbotb-2610052319']) {
 const index=await mcp(home,'index');assert.equal(index.home,home);
 const list=await mcp(home,'run',{command:'plugin-manager.list',args:{}});
 if(!list.ok)throw Error('list failed');
 const plugins=(Array.isArray(list.data)?list.data:list.data.packages).filter(x=>packages.includes(x.pkg));
 assert.equal(plugins.length,3);
 for(const plugin of plugins){assert.deepEqual(plugin.unmetPeers,[]);assert.ok(plugin.entries.every(e=>e.active));}
 const status=await mcp(home,'run',{command:'qq-bot.status',args:{}});
 assert.equal(status.ok,true);
 const settings=[];
 for(const [section,key] of [['qq-bot','report-mcp-server'],['qq-bot','journal-library'],['qq-bot','owner-openid'],['collab','qq-notifications'],['collab','report-mcp-server']]) {
  const value=await mcp(home,'run',{command:'settings.get',args:{section,key}});
  assert.equal(value.ok,true);settings.push({section,key,...value});
 }
 rows.push({home,plugins,status,settings,commands:index.commands.filter(x=>packages.includes(x.plugin))});
}
const result={at:new Date().toISOString(),node:process.version,platform:process.platform,rows,boundary:'Read-only final install and reload check; real tasks were already exercised separately.'};
await mkdir(new URL('runs/',import.meta.url),{recursive:true});
await writeFile(new URL(`runs/${Date.now()}.json`,import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
