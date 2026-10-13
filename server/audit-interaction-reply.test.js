'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {boundedReply}=require('./audit-interaction-reply');
const {interactionReply,policy}=require('./audit-bot');
const interaction={type:2,guild_id:policy.guildId,member:{roles:[policy.allowedRoleIds[0]]},data:{name:'audit',options:[{name:'reference',value:'Lyq'}]}};
test('empty audit search replies immediately without a deferred message',async()=>{
  const reply=await boundedReply(()=>interactionReply(interaction,async()=>[]),{waitUntil(){assert.fail('no background reply needed');}});
  assert.equal(reply.type,4);assert.equal(reply.data.flags,64);
  assert.equal(reply.data.content,'No retained records match that reference.');
});
test('database errors return a private response instead of leaving thinking',async()=>{
  const reply=await boundedReply(async()=>{throw Error('private connection details');},{},{log(){}});
  assert.equal(reply.type,4);assert.match(reply.data.content,/temporarily unavailable/);
  assert.ok(!JSON.stringify(reply).includes('private connection details'));
});
test('slow query gets a bounded private response and tracked completion',async()=>{
  let finish;const tasks=[];
  const reply=await boundedReply(()=>new Promise(resolve=>{finish=resolve;}),{waitUntil(task){tasks.push(task);}},{timeoutMs:5,log(){}});
  assert.equal(reply.type,4);assert.match(reply.data.content,/taking longer/);assert.equal(tasks.length,1);
  finish({type:4,data:{content:'late'}});await Promise.all(tasks);
});
