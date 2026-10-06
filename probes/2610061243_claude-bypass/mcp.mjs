import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function mcp(home,tool,args={}) {
 const base=join(process.env.APPDATA,'gwb-kernel','homes',home);
 const runtime=JSON.parse(await readFile(join(base,'runtime.json'),'utf8'));
 const credentials=JSON.parse(await readFile(join(base,'credentials.json'),'utf8'));
 const url=runtime.mcp?.url;
 if(!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(url))throw Error('Invalid local MCP endpoint');
 const response=await fetch(url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+credentials.sections.mcp.token.value,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:tool,arguments:args}}),signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error('MCP HTTP '+response.status);
 const raw=await response.text();
 const body=raw.startsWith('{')?JSON.parse(raw):raw.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6))).find(x=>x.id===1);
 if(body?.error)throw Error('MCP protocol error');
 return JSON.parse(body.result.content.find(x=>x.type==='text').text);
}
