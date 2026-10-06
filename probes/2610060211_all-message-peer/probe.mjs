import {appendFile,mkdir,writeFile} from 'node:fs/promises';
import {api,token,peers,save,root,delay} from './api.mjs';
const mode=process.argv[2]??'--preflight';
const events=[],states=[],sockets=[],sent=[],peerIds=new Map();
const nonce='ALLMSG-'+Date.now(),stamp=new Date().toISOString().replaceAll(':','').replaceAll('.','-');
await mkdir(new URL('./runs/',root),{recursive:true});
const eventFile=new URL(`./runs/${stamp}-events.jsonl`,root);
let writes=Promise.resolve();
function record(e){const row={at:new Date().toISOString(),...e};events.push(row);const line=JSON.stringify(row);writes=writes.then(()=>appendFile(eventFile,line+'\n'));console.log(line);}
const user=u=>u&&typeof u==='object'?Object.fromEntries(['id','member_openid','username','bot'].filter(k=>u[k]!==undefined).map(k=>[k,u[k]])):undefined;
async function connect(p){
 const accessToken=await token(p),gateway=await api(p,'GET','/gateway');
 if(!gateway.ok||typeof gateway.body?.url!=='string')throw Error('Missing gateway');
 return await new Promise((resolve,reject)=>{
  const ws=new WebSocket(gateway.body.url);let sequence=null,heartbeat=null,ready=false;
  const stop=()=>{clearInterval(heartbeat);clearTimeout(timeout);ws.close();};sockets.push(stop);
  const timeout=setTimeout(()=>{stop();reject(Error('READY timeout '+p.label));},15000);
  ws.addEventListener('message',event=>{
   const frame=JSON.parse(String(event.data));if(typeof frame.s==='number')sequence=frame.s;
   if(frame.op===10){heartbeat=setInterval(()=>ws.send(JSON.stringify({op:1,d:sequence})),frame.d.heartbeat_interval);ws.send(JSON.stringify({op:2,d:{token:`QQBot ${accessToken}`,intents:1<<25,shard:[0,1],properties:{$os:'win32',$browser:'qq-all-message-probe',$device:'qq-all-message-probe'}}}));}
   if(frame.t==='READY'){ready=true;clearTimeout(timeout);record({peer:p.label,type:'READY',user:user(frame.d?.user)});resolve();}
   if(frame.op===7||frame.op===9)record({peer:p.label,type:'gateway-control',op:frame.op});
   if(frame.op!==0||!['GROUP_MESSAGE_CREATE','GROUP_AT_MESSAGE_CREATE'].includes(frame.t)||frame.d?.group_openid!==p.group)return;
   const d=frame.d;
   const data={peer:p.label,type:frame.t,keys:Object.keys(d),id:d.id,group_openid:d.group_openid,author:user(d.author),content:typeof d.content==='string'?d.content.slice(0,2000):undefined,mentions:Array.isArray(d.mentions)?d.mentions.map(user):undefined};
   record(data);
   const other=peers.find(x=>x.label!==p.label);
   if(data.content?.includes(`${nonce} HELLO-${other.label}`)&&typeof data.author?.member_openid==='string')peerIds.set(p.label,data.author.member_openid);
  });
  ws.addEventListener('close',e=>{clearInterval(heartbeat);record({peer:p.label,type:'CLOSED',code:e.code});if(!ready)reject(Error('Closed before ready '+p.label));});
  ws.addEventListener('error',()=>{record({peer:p.label,type:'socket-error'});if(!ready)reject(Error('Socket error '+p.label));});
 });
}
try{
 for(const p of peers){const r=await api(p,'GET',`/v2/groups/${p.group}/bot_state`);states.push({peer:p.label,http:r.http,...r.body});if(r.body?.recv_msg_setting!=='all')throw Error(p.label+' is not all-message mode');p.self=r.body.member_openid;}
 if(mode==='--preflight')console.log(JSON.stringify({states}));
 else if(mode==='--live'){
  for(const p of peers)await connect(p);
  record({type:'LISTENING',nonce,durationSeconds:180,noTaskDispatch:true});
  for(const p of peers){const r=await api(p,'POST',`/v2/groups/${p.group}/messages`,{msg_type:0,content:`${nonce} HELLO-${p.label} 全量消息投递测试，不执行任务。`});sent.push({peer:p.label,kind:'hello',http:r.http,id:r.body?.id});}
  await delay(15000);
  for(const p of peers){const observedId=peerIds.get(p.label);if(!observedId){record({peer:p.label,type:'NO_PEER_ID_FROM_BOT_EVENT'});continue;}
   const other=peers.find(x=>x.label!==p.label);
   const r=await api(p,'POST',`/v2/groups/${p.group}/messages`,{msg_type:2,markdown:{content:`<qqbot-at-user id="${observedId}" /> ${nonce} TASK-${p.label}-TO-${other.label} 只回复收到，不调用工具。`}});sent.push({peer:p.label,kind:'mention-task',http:r.http,id:r.body?.id,target:observedId});
  }
  for(let i=0;i<33;i++)await delay(5000);
 }else throw Error('Use --preflight or --live');
}finally{
 for(const stop of sockets)stop();await delay(200);await writes;
 await save({question:'开启 all 后，机器人消息是否向另一机器人投递，并能取得本应用 peer ID？',mode,nonce,states,sent,peerIds:Object.fromEntries(peerIds),eventFile:eventFile.pathname,received:events.filter(e=>e.type==='GROUP_MESSAGE_CREATE'||e.type==='GROUP_AT_MESSAGE_CREATE').length});
}
