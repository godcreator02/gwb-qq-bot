import {api,peers,save} from './api.mjs';
const observations=[];
try{
 for(const p of peers){
  await api(p,'GET','/users/@me');
  await api(p,'GET','/gateway');
  await api(p,'GET','/gateway/bot');
  const guilds=await api(p,'GET','/users/@me/guilds?limit=100');
  observations.push({peer:p.label,guilds:guilds.body});
  const base=`/v2/groups/${p.group}`;
  const state=await api(p,'GET',base+'/bot_state');
  for(const suffix of ['info','members','join_request_list','member_blacklist','restrict_chat_setting'])await api(p,'GET',base+'/'+suffix);
  await api(p,'GET',base+'/members/'+p.human);
  if(state.body?.member_openid)await api(p,'GET',base+'/members/'+state.body.member_openid);
  await api(p,'GET','/v2/groups/join_approval_strategy');
  await api(p,'GET','/v2/menu');
  for(const scope of ['group','c2c','channel','dm']){
   const list=await api(p,'GET',`/v2/panels?scope=${scope}&limit=50`);
   for(const panel of list.body?.records??[])if(panel.panel_id)await api(p,'GET',`/v2/panels/${encodeURIComponent(panel.panel_id)}`);
  }
  // Only use actual guild IDs returned for this application; no guessed fixture IDs.
  const actualGuilds=Array.isArray(guilds.body)?guilds.body:guilds.body?.guilds??[];
  for(const guild of actualGuilds){
   if(!guild.id)continue;
   const g=encodeURIComponent(guild.id);
   for(const suffix of ['', '/channels','/roles','/members?limit=100','/api_permission','/message/setting'])await api(p,'GET',`/guilds/${g}${suffix}`);
  }
 }
}finally{await save({question:'当前两个机器人账户可访问哪些不改变平台状态的官方查询接口？',observations});}
