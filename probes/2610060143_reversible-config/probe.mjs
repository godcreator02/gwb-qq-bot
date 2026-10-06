import {api,peers,save,delay} from './api.mjs';
const cleanup=[], observations=[];
try{
 for(const p of peers){
  const panelMarker=`qq-api-probe-${Date.now()}-${p.label}`;
  const list=await api(p,'GET','/v2/panels?scope=group&limit=50');
  if(!list.ok||(list.body.records??[]).length){observations.push({peer:p.label,skip:'panel lifecycle',reason:'Existing panels or failed baseline; do not disturb existing presentation'});continue;}
  const created=await api(p,'POST','/v2/panels',{scope:'group',target_type:'specific',group_openids:[p.group],panel:{items:[{type:'command',name:'/帮助',desc:'接口测试'}],remark:panelMarker}});
  if(created.ok&&created.body?.panel_id){
   const path='/v2/panels/'+encodeURIComponent(created.body.panel_id);
   try{
    await api(p,'GET',path);
    await api(p,'PUT',path,{panel:{items:[{type:'command',name:'/帮助',desc:'接口测试更新'}],remark:panelMarker+'-updated'}});
    await api(p,'PUT',path+'/target',{op:'del',group_openids:[p.group]});
    await api(p,'PUT',path+'/target',{op:'add',group_openids:[p.group]});
   }finally{const deleted=await api(p,'DELETE',path);cleanup.push({peer:p.label,kind:'panel',id:created.body.panel_id,ok:deleted.ok});}
   await api(p,'GET','/v2/panels?scope=group&limit=50');
  }
  const menu=await api(p,'GET','/v2/menu');
  if(menu.ok&&menu.body?.menu){
   const same=await api(p,'PUT','/v2/menu',{menu:menu.body.menu});
   const after=await api(p,'GET','/v2/menu');
   observations.push({peer:p.label,kind:'menu-same-value-write',http:same.http,preserved:JSON.stringify(menu.body.menu)===JSON.stringify(after.body?.menu)});
  }
  const strategy=await api(p,'POST','/v2/groups/join_approval_strategy',{group_openids:[p.group],is_enable:'off',remark:panelMarker});
  if(strategy.ok&&strategy.body?.strategy_id){
   const path='/v2/groups/join_approval_strategy/'+encodeURIComponent(strategy.body.strategy_id);
   try{
    await api(p,'PATCH',path,{is_enable:'off',remark:panelMarker+'-updated'});
    // Never execute the strategy: that would approve actual join requests.
    const me=await api(p,'GET','/users/@me');
    const uin=me.body?.share_url?new URL(me.body.share_url).searchParams.get('robot_uin'):null;
    if(uin){
     await api(p,'POST',path+'/whitelist_users',{op:'add',whitelist_users:[uin]});
     await api(p,'POST',path+'/whitelist_users',{op:'del',whitelist_users:[uin]});
    }
   }finally{const deleted=await api(p,'DELETE',path);cleanup.push({peer:p.label,kind:'disabled-strategy',id:strategy.body.strategy_id,ok:deleted.ok});}
   await api(p,'GET','/v2/groups/join_approval_strategy');
  }
  await api(p,'POST','/v2/generate_url_link',{callback_data:'qq-api-probe-261006'});
  await delay(500);
 }
}finally{await save({question:'仅使用新建测试资源时，面板与停用审批策略的增改查删是否可用？',cleanup,observations});if(cleanup.some(x=>!x.ok))process.exitCode=2;}
