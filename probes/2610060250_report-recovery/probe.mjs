import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ZcodeBridge} from './input/bridge.mjs';
import {ReportBook} from './input/reports.mjs';
import {QqNotifications} from './input/collab.mjs';
const disk=new Map(),sent=[],calls=[],tickets=[];
const store=key=>({read:async()=>structuredClone(disk.get(key)),write:async value=>disk.set(key,structuredClone(value))});
const log={info(){},warn(){},error(){}};
let bridge;
const reports=new ReportBook({home:'test-b',...store('reports'),warn(){},deliver:async(command,report)=>{
 assert.equal(command,'qq-bot.receive-report');await bridge.receiveReport(report);return{ok:true};
}});
const deps={...store('qq'),log,defaultWorkspace:()=>'/test',allowedOpenids:()=>['user'],reportServer:()=> 'gwb_botb',journalLibrary:()=>'',ownerOpenid:()=> 'user',
 sendC2c:async(target,text,msgId,seq)=>{sent.push({target,text,msgId,seq});return{ok:true,id:'out'}},
 sendGroup:async(target,text,msgId,seq)=>{sent.push({target,text,msgId,seq});return{ok:true,id:'out'}},
 runCommand:async(name,args)=>{
  calls.push(name);
  if(name==='zcode.report.replay')return{ok:true,data:await reports.replay(args.callback)};
  assert.ok(name==='zcode.create'||name==='zcode.send');
  const task=args.task??'sess-test';tickets.push(await reports.prepare(args.report,args.workspace,task));
  return{ok:true,data:{taskId:task}};
 }};
bridge=new ZcodeBridge(deps);
const message=(msgId,replyTarget)=>({scene:'group',msgId,replyTarget,senderOpenid:'user',content:'测试'});
await Promise.all([bridge.handleIncoming(message('m1','group-1')),bridge.handleIncoming(message('m2','group-2'))]);
await bridge.dispose();bridge=new ZcodeBridge(deps);await bridge.restore();
await reports.report({ticket:tickets[1],state:'completed',text:'second'});
await reports.report({ticket:tickets[0],state:'completed',text:'first'});
await reports.report({ticket:tickets[0],state:'completed',text:'first'});
await bridge.handleIncoming(message('m1','group-1'));
assert.equal(sent.length,4);
assert.equal(sent.find(x=>x.text.includes('first')).target,'group-1');
assert.equal(sent.find(x=>x.text.includes('second')).target,'group-2');
assert.ok(!calls.includes('zcode.status'));
const foreign=new ReportBook({home:'other',...store('foreign'),warn(){},deliver:async()=>({ok:true})});
await assert.rejects(foreign.report({ticket:tickets[0],state:'completed',text:'first'}));
await bridge.notify({id:'mr-one',text:'通知'});await bridge.dispose();bridge=new ZcodeBridge(deps);
assert.deepEqual(await bridge.notify({id:'mr-one',text:'通知'}),{delivered:true,duplicate:true});
const notices=[];
const collabDeps={...store('collab'),enabled:()=>true,server:()=> 'gwb_botb',warn(){},commands:{run:async(name,args)=>{notices.push({name,...args});return{ok:true,data:{delivered:true}}}}};
const attention={conflicts:[],syncProblem:null,submitFailure:null,checkError:null,pendingPulls:[{repo:'code',number:1,title:'测试',poster:'peer',url:'https://example.invalid/1'}],repoSetupProblems:[]};
let collab=new QqNotifications(collabDeps);await collab.observe('/project',attention);await collab.close();collab=new QqNotifications(collabDeps);await collab.observe('/project',attention);
assert.equal(notices.length,1);
await collab.observe('/project',{...attention,pendingPulls:[]});await collab.observe('/project',attention);assert.equal(notices.length,2);assert.notEqual(notices[0].id,notices[1].id);
const hashes={};for(const name of ['bridge','reports','collab'])hashes[name]=createHash('sha256').update(await readFile(new URL(`input/${name}.mjs`,import.meta.url))).digest('hex');
await mkdir(new URL('runs/',import.meta.url),{recursive:true});
const result={at:new Date().toISOString(),node:process.version,platform:process.platform,hashes,checks:['out-of-order route binding','restart restores pending tasks','duplicate message and report suppressed','wrong-home ticket rejected','zero zcode.status calls','owner notice dedupe survives reload','collab reconnect dedupe and reopened MR event'],qqSends:sent.length,collabSends:notices.length,calls};
await writeFile(new URL(`runs/${Date.now()}.json`,import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
