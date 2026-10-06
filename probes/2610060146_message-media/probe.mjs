import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {api,peers,save,records,delay} from './api.mjs';
const notes=[],cleanup=[];
const bytes=await readFile(new URL('./input/fixture.txt',import.meta.url));
const hash=(alg,data)=>createHash(alg).update(data).digest('hex');
async function retract(p,base,response){
 if(response.ok&&response.body?.id){const out=await api(p,'DELETE',`${base}/messages/${encodeURIComponent(response.body.id)}`);cleanup.push({peer:p.label,path:base,id:response.body.id,ok:out.ok});}
}
try{
 for(const p of peers){
  const me=await api(p,'GET','/users/@me');
  for(const scene of ['groups','users']){
   const base=`/v2/${scene}/${scene==='groups'?p.group:p.human}`;
   const text=await api(p,'POST',base+'/messages',{msg_type:0,content:`QQ-API-PROBE ${p.label} ${scene}：文本发送与撤回测试。`});
   await retract(p,base,text);
   const markdown=await api(p,'POST',base+'/messages',{msg_type:2,markdown:{content:`**QQ-API-PROBE ${p.label} ${scene}**\n\nMarkdown 发送与撤回测试。`}});
   await retract(p,base,markdown);
   if(typeof me.body?.avatar==='string'){
    const media=await api(p,'POST',base+'/files',{file_type:1,url:me.body.avatar,srv_send_msg:false});
    if(media.ok&&media.body?.file_info){const sent=await api(p,'POST',base+'/messages',{msg_type:7,media:{file_info:media.body.file_info}});await retract(p,base,sent);}
   }
   const prepared=await api(p,'POST',base+'/upload_prepare',{file_type:4,file_size:String(bytes.length),file_name:'qq-api-probe.txt',md5:hash('md5',bytes),sha1:hash('sha1',bytes),md5_10m:hash('md5',bytes.subarray(0,10002432))});
   if(prepared.ok&&prepared.body?.upload_id&&Array.isArray(prepared.body.parts)){
    let completed=true,offset=0;
    for(const part of prepared.body.parts){
     const url=new URL(part.presigned_url);
     const allowed=url.protocol==='https:'&&/(^|\.)(qq\.com|myqcloud\.com|tencentcos\.cn|tencentcos\.com|qpic\.cn|gtimg\.com)$/.test(url.hostname);
     if(!allowed){notes.push({peer:p.label,scene,blocked:'Unexpected presigned upload host',host:url.hostname});completed=false;break;}
     const size=Number(part.block_size??prepared.body.block_size);
     if(!Number.isSafeInteger(size)||size<1){completed=false;break;}
     const block=bytes.subarray(offset,Math.min(offset+size,bytes.length));offset+=block.length;
     const uploaded=await fetch(url,{method:'PUT',body:block,signal:AbortSignal.timeout(15000)});
     records.push({at:new Date().toISOString(),peer:p.label,method:'PUT',path:'<official-presigned-upload>',http:uploaded.status,verdict:uploaded.ok?'success':'api-error',bytes:block.length});
     if(!uploaded.ok){completed=false;break;}
     const finish=await api(p,'POST',base+'/upload_part_finish',{upload_id:prepared.body.upload_id,part_index:part.index,block_size:String(block.length),md5:hash('md5',block)});
     if(!finish.ok){completed=false;break;}
    }
    if(completed&&offset===bytes.length){const merged=await api(p,'POST',base+'/files',{file_type:4,srv_send_msg:false,file_name:'qq-api-probe.txt',upload_id:prepared.body.upload_id});notes.push({peer:p.label,scene,multipartMerge:merged.ok});}
   }else notes.push({peer:p.label,scene,multipart:'No usable upload task returned; no fabricated upload_id used'});
   await delay(1000);
  }
  const stream=await api(p,'POST',`/v2/users/${p.human}/stream_messages`,{input_mode:'append',input_state:10,index:0,content_type:'text',content_raw:`QQ-API-PROBE ${p.label}：流式接口单片结束测试。`,msg_seq:1});
  await retract(p,`/v2/users/${p.human}`,stream);
 }
}finally{await save({question:'正式API的群聊/私聊文本、Markdown、URL上传、分片上传、流式及本次测试消息撤回是否可用？',notes,cleanup});if(cleanup.some(x=>!x.ok))process.exitCode=2;}
