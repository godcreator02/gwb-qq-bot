import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const pages=JSON.parse(await readFile(new URL('./input/official-pages.json',import.meta.url),'utf8'));
const map=new Map();
for(const p of pages){
 if(!p.text || p.path.includes('/autogen/event/') || p.path.endsWith('/autogen/index.html'))continue;
 const found=[];
 for(const m of p.text.matchAll(/HTTP URL\s+(\S+)\s+HTTP Method\s+(GET|POST|PATCH|PUT|DELETE)/g))found.push([m[2],m[1].replace('https://api.bot.qq.com','')]);
 if(!found.length)for(const m of p.text.matchAll(/\b(GET|POST|PATCH|PUT|DELETE)\s+(\/[a-zA-Z0-9_@{}?=./-]+)/g)){
   const path=m[2].split('?')[0];
   if(path.includes('{')||/^\/(gateway(?:\/bot)?|users\/@me(?:\/(?:dms|guilds))?|app\/getAppAccessToken)$/.test(path))found.push([m[1],path]);
 }
 for(const[method,path]of found){
  const key=method+' '+path;let e=map.get(key);
  if(!e){e={method,path,title:p.title,sources:[],scope:'',sideEffect:'',prerequisites:[],documentationConstraints:[],manualReview:false};map.set(key,e);}
  if(!e.sources.includes(p.url))e.sources.push(p.url);
  for(const m of p.text.matchAll(/.{0,15}(?:仅私域机器人|私域机器人可用|仅白名单机器人|内邀接入|需要特殊申请|需特殊申请|仅限|需要机器人|机器人需要|需要管理员|需要频道|公域机器人暂不支持|不可撤回|5 分钟|60 分钟|2 分钟|仅支持|仅.*?可用|接口频率限制).{0,110}/g)) if(!e.documentationConstraints.includes(m[0].trim()))e.documentationConstraints.push(m[0].trim());
  if(/废弃/.test(p.title))e.deprecated=true;
 }
}
for(const e of map.values()){
 const p=e.path,m=e.method;
 if(p==='/app/getAppAccessToken'){e.scope='authentication';e.sideEffect='token-read-or-refresh';e.prerequisites=['当前应用 AppID 与 AppSecret；凭据只在本地读取，禁止进入输出'];continue;}
 e.prerequisites.push('当前应用有效 QQBot access_token');
 if(/^\/(?:gateway(?:\/bot)?|users\/@me(?:\/guilds)?)$/.test(p)){e.scope='base-query';e.sideEffect='read-only';}
 else if(p.startsWith('/v2/groups/')){e.scope='qq-group';if(p.includes('{group'))e.prerequisites.push('该应用回调或官方接口给出的 group_openid；不能跨应用照搬');}
 else if(p.startsWith('/v2/users/')){e.scope='qq-c2c';e.prerequisites.push('该应用对应的 user_openid；目标存在单聊关系和对应消息权限');}
 else if(p.startsWith('/interactions/')){e.scope='interaction-resource';e.prerequisites.push('平台实际下发且仍有效的 interaction_id；不能伪造');}
 else if(/^\/(?:guilds|channels|dms)\//.test(p)||p==='/users/@me/dms'){e.scope='qq-channel';e.prerequisites.push('机器人实际加入的频道/子频道及该应用获得的 ID；QQ 群 group_openid 不能替代 guild_id');}
 else{e.scope='application-config';}
 if(m==='GET')e.sideEffect='read-only';
 else if(/batch_remove_members|approval_join_request|member_blacklist|restrict_chat_setting|\/mute|\/permissions|\/roles|\/api_permission\/demand/.test(p))e.sideEffect='member-permission-or-moderation-change';
 else if(m==='DELETE')e.sideEffect='delete-or-recall';
 else if(/\/messages$|\/stream_messages$/.test(p))e.sideEffect='send-message';
 else if(/\/files$|\/upload_prepare$|\/upload_part_finish$/.test(p))e.sideEffect='upload-test-media';
 else if(/\/audio$|\/mic$/.test(p))e.sideEffect='audio-state-change';
 else if(p.startsWith('/interactions/'))e.sideEffect='acknowledge-existing-interaction';
 else if(p==='/v2/generate_url_link')e.sideEffect='create-bot-share-link';
 else e.sideEffect='create-or-update-configuration-resource';
 const resourceParams=[...p.matchAll(/\{([^}]+)\}/g)].map(x=>x[1]);
 e.resourceParameters=resourceParams;
 if(p==='/v2/panels'&&m==='GET')e.prerequisites.push('必填 query scope：c2c/group/channel/dm；可分别查询四场景');
 if(p==='/v2/groups/{group_openid}/members'&&m==='GET')e.prerequisites.push('cursor 可空；每页最多30，next_cursor为空结束');
 if(p==='/guilds/{guild_id}/members'&&m==='GET')e.prerequisites.push('after 默认0；limit 1-400；用上一页最后user id续页，空列表结束');
 if(p==='/guilds/{guild_id}/roles/{role_id}/members'&&m==='GET')e.prerequisites.push('start_index 默认0；limit 1-400；next作为后续游标');
 if(/join_request_list|restrict_chat_setting|approval_join_request/.test(p))e.prerequisites.push('官方说明机器人需拥有群管理员身份');
 if(resourceParams.some(x=>/message_id|thread_id|schedule_id|panel_id|strategy_id|role_id|interaction_id/.test(x)))e.prerequisites.push('须先取得该应用可访问的真实资源 ID；删除/修改只能针对本实验新建的资源');
 if(p.includes('/members/{'))e.prerequisites.push('已知目标成员在当前应用场景的 ID；本接口不能凭 QQ 号或另一应用 OpenID 反查');
 if(p.includes('/upload_part_finish'))e.prerequisites.push('成功的 upload_prepare 与分片上传会话、上传结果');
 if(p.includes('/files')||p.includes('/upload_prepare'))e.prerequisites.push('可访问的测试文件或实际测试文件字节；不上传用户私有文件');
 if(p.includes('/messages')&&m==='POST')e.prerequisites.push('使用本实验无害文本；主动消息需目标允许，被动消息需有效 msg_id/event_id 和剩余回复次数');
 if(e.deprecated)e.prerequisites.push('官方已废弃；仅记录文档覆盖，不应据此修改现网');
 if(e.documentationConstraints.some(x=>/白名单机器人|内邀接入/.test(x)))e.prerequisites.push('需平台内邀/接口白名单授权；11253 不能靠替换路径参数绕过');
 if(e.documentationConstraints.some(x=>/仅私域机器人|私域机器人可用|公域机器人暂不支持/.test(x)))e.prerequisites.push('仅私域频道机器人具备所述能力；不可推广到 QQ 群');
}
const list=[...map.values()].sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
const target=fileURLToPath(new URL('./runs/extracted-'+Date.now()+'.json',import.meta.url)).replaceAll('\\','/');
await mkdir(target.slice(0,target.lastIndexOf('/')),{recursive:true});
await writeFile(target,JSON.stringify(list,null,2)+'\n');
console.log(JSON.stringify({count:list.length,byScope:Object.fromEntries([...new Set(list.map(x=>x.scope))].map(s=>[s,list.filter(x=>x.scope===s).length])),byMethod:Object.fromEntries([...new Set(list.map(x=>x.method))].map(s=>[s,list.filter(x=>x.method===s).length])),target},null,2));

