import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const read=async name=>JSON.parse(await readFile(new URL('./runs/'+name,import.meta.url),'utf8'));
const completed=await read('03-completed.json'),stable=await read('04-stable.json'),zcode=await read('03-zcode-results.json');
assert.ok(Date.parse(stable.at)-Date.parse(completed.at)>=60000,'Need at least 60 seconds of observation after completed snapshot');
for(const peer of ['A','B']){
 const done=completed[peer].data,after=stable[peer].data;
 assert.equal(done.gateway,'open');assert.equal(after.gateway,'open');
 assert.equal(after.sessions.length,1);
 const s=after.sessions[0];assert.equal(s.taskId,done.sessions[0].taskId);
 assert.equal(s.roundIndex,1);assert.equal(s.roundRunning,false);assert.equal(s.resultDelivered,true);
 assert.equal(zcode[peer].taskId,s.taskId);assert.equal(zcode[peer].roundIsOver,true);
 assert.deepEqual(zcode[peer].replies,[`自然语言互派验证-${peer==='A'?'B到A':'A到B'}成功`]);
 assert.deepEqual(zcode[peer].fileChanges,[]);assert.deepEqual(zcode[peer].pendingPermissions,[]);
}
console.log('PASS: bidirectional natural-language dispatch, results delivered, no extra rounds after >=60 seconds. Offline evidence verification only.');
