'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {policy,authorized,verifyInteraction,batches,deliver,interactionReply}=require('./audit-bot');
const {embed}=require('./audit-bot');
test('native give cards show requested details without claiming delivery or leaking mentions',()=>{
  const panel=embed({eventId:'give-1',transactionId:'tx-1',category:'staff',kind:'staff.item.give.requested',outcome:'attempt',actorName:'Lyq',createdAt:Date.now(),details:{recipient:'@everyone',itemId:'Wood_Oak_Trunk',quantity:'3',quality:'Rare'}});
  assert.equal(panel.title,'Staff /give requested');
  assert.ok(panel.fields.some(f=>f.name==='Quantity requested'&&f.value==='3'));
  assert.ok(panel.fields.some(f=>f.name==='Status'&&f.value.includes('not confirmed')));
  assert.ok(panel.fields.some(f=>f.name==='Item'&&f.value.length>0));
  assert.ok(!JSON.stringify(panel).includes('@everyone'));
  assert.equal(panel.fields.length,6);
});
const event=i=>({eventId:'event-'+i,category:'economy',kind:'wallet.change',outcome:'committed',actorName:'@everyone',summary:'gold moved',createdAt:Date.now()});
test('staff roles are restricted to the configured guild',()=>{
  for(const role of policy.allowedRoleIds)assert.equal(authorized({guild_id:policy.guildId,member:{roles:[role]}}),true);
  assert.equal(authorized({guild_id:'other',member:{roles:policy.allowedRoleIds}}),false);
  assert.equal(authorized({guild_id:policy.guildId,member:{roles:['other']}}),false);
});
test('interaction signatures cover raw bytes and timestamp',()=>{
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519'),body='{"type":1}',timestamp=String(Math.floor(Date.now()/1000));
  const key=publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
  const signature=crypto.sign(null,Buffer.from(timestamp+body),privateKey).toString('hex');
  assert.equal(verifyInteraction(body,signature,timestamp,key),true);
  assert.equal(verifyInteraction(body+' ',signature,timestamp,key),false);
  assert.equal(verifyInteraction(body,signature,timestamp,key,Date.now()+600000),false);
});
test('messages are bounded and user text cannot mention staff',()=>{
  const messages=batches(Array.from({length:110},(_,i)=>event(i)));
  assert.equal(messages.reduce((n,m)=>n+m.events.length,0),100);
  for(const message of messages){assert.ok(message.events.length<=5);const content=JSON.stringify(message.embeds);assert.ok(!content.includes('@everyone'));assert.ok(message.embeds.reduce((n,e)=>n+e.title.length+e.description.length+e.footer.text.length+e.fields.reduce((n,f)=>n+f.name.length+f.value.length,0),0)<=5500);}
});
test('429 stops delivery without acknowledgement',async()=>{
  let ack=0;const result=await deliver([event(1)],{token:'test',fetch:async()=>new Response(JSON.stringify({retry_after:2.5}),{status:429}),acknowledge:async()=>ack++});
  assert.equal(ack,0);assert.equal(result.sent,0);assert.equal(result.retryAfterSeconds,2.5);
});
test('successful batches acknowledge stable references and disable mentions',async()=>{
  let captured,receipt;await deliver([event(1)],{token:'test',fetch:async(url,init)=>{captured=JSON.parse(init.body);return Response.json({id:'receipt'});},acknowledge:async(ids,id)=>receipt={ids,id}});
  assert.deepEqual(captured.allowed_mentions.parse,[]);assert.deepEqual(receipt,{ids:['event-1'],id:'receipt'});
});
test('unauthorized search never touches private records',async()=>{
  const result=await interactionReply({type:2,data:{name:'audit'}},()=>{throw new Error('Must not query');});assert.equal(result.data.flags,64);
});
