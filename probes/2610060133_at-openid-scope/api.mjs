import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
export const root=new URL('./',import.meta.url);
export const peers=JSON.parse(await readFile(new URL('./input/targets.json',root),'utf8'));
export const records=[];
const tokens=new Map();
const credentialStrings=new Set();
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export function redact(value,key=''){
 if(/secret|token|authorization|presigned|file_info|file_data|upload_id/i.test(key))return '<REDACTED>';
 if(Array.isArray(value))return value.map(v=>redact(v));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v,k)]));
 if(typeof value==='string'){
  for(const secret of credentialStrings)if(secret)value=value.replaceAll(secret,'<REDACTED>');
  if(/^https?:\/\//.test(value)){try{const u=new URL(value);if(u.search)value=`${u.origin}${u.pathname}?<REDACTED_QUERY>`;}catch{}}
 }
 return value;
}
async function token(peer){
 if(tokens.has(peer.home))return tokens.get(peer.home);
 const homes=process.env.QQ_PROBE_HOMES_ROOT||join(process.env.APPDATA,'gwb-kernel','homes');
 const home=resolve(homes,peer.home);
 const settings=JSON.parse(await readFile(join(home,'settings.json'),'utf8'))['qq-bot'];
 const secret=JSON.parse(await readFile(join(home,'credentials.json'),'utf8')).sections['qq-bot']['app-secret'].value;
 if(String(settings['app-id'].value)!==peer.appId)throw new Error(`AppID mismatch for ${peer.label}`);
 credentialStrings.add(secret);
 const response=await fetch('https://api.bot.qq.com/app/getAppAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appId:peer.appId,clientSecret:secret}),signal:AbortSignal.timeout(15000)});
 const body=await response.json();
 if(body.access_token)credentialStrings.add(body.access_token);
 records.push({at:new Date().toISOString(),peer:peer.label,method:'POST',path:'/app/getAppAccessToken',http:response.status,body:redact(body),verdict:response.ok&&!!body.access_token?'success':'api-error'});
 if(!response.ok||!body.access_token)throw new Error(`Token failed for ${peer.label}`);
 tokens.set(peer.home,body.access_token);return body.access_token;
}
export async function api(peer,method,path,body){
 if(!path.startsWith('/')||path.startsWith('//'))throw new Error('Only official API paths permitted');
 const accessToken=await token(peer);
 let item;
 try{
  const response=await fetch('https://api.bot.qq.com'+path,{method,headers:{Authorization:`QQBot ${accessToken}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const raw=await response.text();let data;try{data=raw?JSON.parse(raw):null}catch{data={nonJson:raw.slice(0,1000)}}
  const verdict=response.ok?'success':(data?.code===11253||data?.err_code===40012010?'permission-denied':'api-error');
  item={at:new Date().toISOString(),peer:peer.label,method,path,request:redact(body),http:response.status,body:redact(data),verdict};
  records.push(item);console.log(JSON.stringify({peer:peer.label,method,path,http:response.status,code:data?.err_code??data?.code,verdict}));
  await delay(300);return {http:response.status,body:data,ok:response.ok};
 }catch(error){item={at:new Date().toISOString(),peer:peer.label,method,path,verdict:'transport-error',error:redact(String(error))};records.push(item);console.log(JSON.stringify(item));return {http:null,body:null,ok:false};}
}
export async function save(extra={}){
 const dir=new URL('./runs/',root);await mkdir(dir,{recursive:true});
 const stamp=new Date().toISOString().replaceAll(':','').replaceAll('.','-');
 const script=await readFile(new URL('./probe.mjs',root));
 const report={at:new Date().toISOString(),node:process.version,platform:process.platform,subjectCommit:'98c25f5d44b31e8802d3ba035fe4e3354e1288f7',probeSha256:createHash('sha256').update(script).digest('hex'),...extra,records};
 const file=new URL(`${stamp}.json`,dir);await writeFile(file,JSON.stringify(redact(report),null,2));console.log(JSON.stringify({saved:file.pathname,requests:records.length}));return file;
}
