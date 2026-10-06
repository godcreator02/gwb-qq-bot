import {readFile} from 'node:fs/promises';
const mode=process.argv[2]??'--replay';
if(mode==='--replay'){
 const evidence=JSON.parse(await readFile(new URL('./runs/01-original-api.json',import.meta.url),'utf8'));
 for(const label of ['A','B']){
  const state=evidence.results.find(r=>r.case===label+'-state');
  const sent=evidence.results.find(r=>r.case===label+'-mention-comparison');
  if(state?.http!==200||sent?.http!==200||!sent.body?.id)throw Error('Incomplete original receipt');
  for(const id of [state.body.member_openid,...JSON.parse(await readFile(new URL('./input/targets.json',import.meta.url),'utf8')).map(p=>p.human)])if(!sent.content.includes(id))throw Error('Missing comparison input');
 }
 console.log(JSON.stringify({mode,originalTime:evidence.time,requests:evidence.results.length,receiptCheck:'passed',visualEvidence:'runs/01-qq-window.png',limit:'离线回执核对；渲染结论来自截图人工复核，不是 HTTP 状态推导'}));
}else if(mode==='--live'){
 const {api,peers,save}=await import('./api.mjs');
 try{
  for(const p of peers){const r=await api(p,'GET',`/v2/groups/${p.group}/bot_state`);if(!r.ok||!r.body?.member_openid)throw Error('Cannot identify bot '+p.label);p.self=r.body.member_openid;}
  for(let i=0;i<peers.length;i++){
   const p=peers[i],other=peers[1-i],at=id=>`<qqbot-at-user id="${id}" />`;
   const content=`SCOPE-${p.label} /帮助\n\n①本端天神：${at(p.human)}\n\n②本端机器人：${at(p.self)}\n\n③另一端天神：${at(other.human)}\n\n④另一端机器人：${at(other.self)}`;
   await api(p,'POST',`/v2/groups/${p.group}/messages`,{msg_type:2,markdown:{content}});
   await api(p,'GET',`/v2/groups/${p.group}/members/${p.human}`);
  }
 }finally{await save({question:'本应用与另一应用取得的人/机器人 OpenID 是否都能用于本应用 Markdown @？',visualCheck:'需要人工截取本轮 QQ 消息核对，不得复用旧截图作新证据'});}
}else throw Error('Use --replay or --live');
