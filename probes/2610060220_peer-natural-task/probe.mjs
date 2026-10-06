import {readFile} from 'node:fs/promises';
import {api,peers,save,delay} from './api.mjs';
const targets=JSON.parse(await readFile(new URL('./input/peer-ids.json',import.meta.url),'utf8'));
const sent=[];
try {
 for(const p of peers){
  const state=await api(p,'GET',`/v2/groups/${p.group}/bot_state`);
  if(state.body?.recv_msg_setting!=='only_mention')throw Error('Expected only_mention for '+p.label);
  const mapped=targets.find(x=>x.caller===p.label&&x.callerAppId===p.appId&&x.groupOpenid===p.group);
  if(!mapped)throw Error('Missing scoped peer mapping');
  const marker=`自然语言互派验证-${p.label}到${mapped.target}`;
  const content=`<qqbot-at-user id="${mapped.targetMemberOpenid}" /> 请只回复“${marker}成功”，不要调用工具，不要读写文件，不要转发消息。`;
  const result=await api(p,'POST',`/v2/groups/${p.group}/messages`,{msg_type:2,markdown:{content}});
  sent.push({from:p.label,to:mapped.target,marker,http:result.http,id:result.body?.id});
  await delay(2000);
 }
}finally{await save({question:'仅 @ 模式下不加命令前缀，双向自然语言任务能否经已安装 QQ 插件进入 ZCode 并回传？',sent,installedVersion:'0.1.4-dev.20261006021903',limit:'HTTP 发送不是验收；必须核对接收端 qq-bot.status 和 ZCode 结果/日志'});}
