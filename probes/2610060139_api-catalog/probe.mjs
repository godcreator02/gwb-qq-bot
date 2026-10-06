import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const here=new URL('./',import.meta.url);
const endpoints=JSON.parse(await readFile(new URL('./input/endpoints.json',here),'utf8'));
const evidence=JSON.parse(await readFile(new URL('./input/http-observations.json',here),'utf8'));
const pattern=path=>new RegExp('^'+path.split(/(\{[^}]+\})/).map(p=>p.startsWith('{')?'[^/]+':p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('')+'$');
const ids=new Set();
for(const e of endpoints){const id=e.method+' '+e.path;if(ids.has(id))throw new Error('Duplicate endpoint '+id);ids.add(id);if(!e.sources.length)throw new Error('Missing primary source '+id);}
const rows=endpoints.map(e=>{
 const re=pattern(e.path);
 const observations=evidence.filter(r=>r.method===e.method&&re.test(r.path.split('?')[0]));
 let status,reason;
 if(observations.length){status=observations.some(r=>r.http>=200&&r.http<300)?'HTTP成功':observations.every(r=>r.code===11253||r.errCode===40012010)?'权限拒绝':'调用失败';reason='以已保存回执为准；HTTP成功不等于客户端效果或所有参数分支通过';}
 else if(e.scope==='qq-channel'){status='未测：缺少频道';reason='两端 GET /users/@me/guilds 返回 []，没有有效 guild/channel/message/role 资源。QQ群不能替代 QQ频道。';}
 else if(e.scope==='interaction-resource'){status='未测：缺少互动事件';reason='没有可用 interaction_id，不能用虚构 ID 制造错误充当测试。';}
 else {status='未测：需要专用测试对象';reason='涉及实际成员禁言/移除/黑名单/审批，或依赖未具备的测试资源；未执行。';}
 return {...e,status,reason,observations};
});
const counts=Object.fromEntries([...new Set(rows.map(r=>r.status))].map(s=>[s,rows.filter(r=>r.status===s).length]));
const report={at:new Date().toISOString(),scope:'官方API v2当前目录：191 HTML及17目录页；相同method/path去重；含已废弃接口',total:rows.length,counts,rows};
await mkdir(new URL('./runs/',here),{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','').replaceAll('.','-');
const json=new URL(`./runs/${stamp}.json`,here);await writeFile(json,JSON.stringify(report,null,2));
const lines=['# QQ 官方 API 覆盖清单','',`去重接口：${rows.length}。本表复核固定输入的实测回执，**不会发起网络请求**。HTTP成功只证明这些实测参数被平台接受。`,'',`统计：${Object.entries(counts).map(([k,v])=>`${k} ${v}`).join('；')}。`,'', '| 方法 | 路径 | 用途 | 状态 | A / B 实测 | 边界 |','|---|---|---|---|---|---|'];
for(const e of rows){const results=['A','B'].map(p=>p+':'+([...new Set(e.observations.filter(r=>r.peer===p).map(r=>String(r.http)+(r.errCode?' / '+r.errCode:'')))].join(',')||'未调用')).join('；');lines.push(`| ${e.method} | \`${e.path}\` | [${e.title}](${e.sources[0]}) | ${e.status} | ${results} | ${e.reason} |`);}
await writeFile(new URL('./coverage.md',here),lines.join('\n')+'\n');
console.log(JSON.stringify({total:rows.length,counts,evidenceRequests:evidence.length,endpointSha256:createHash('sha256').update(JSON.stringify(endpoints)).digest('hex'),report:json.pathname},null,2));
