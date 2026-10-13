'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {verify}=require('./ingest'),{sanitizeSnapshot,SnapshotData}=require('./snapshot-data');
test('bridge signature rejects modified, stale and unsigned payloads',()=>{
  const body='{"events":[]}',time=String(Date.now()),secret='test'.repeat(16),signature=crypto.createHmac('sha256',secret).update(time+'.'+body).digest('hex');
  assert.equal(verify(body,time,signature,secret),true);assert.equal(verify(body+' ',time,signature,secret),false);assert.equal(verify(body,time,signature,secret,Date.now()+360000),false);assert.equal(verify(body,time,signature,''),false);
});
test('public projection strips private fields and preserves big balances',()=>{
  const projected=sanitizeSnapshot({players:[{name:'Player',accountUuid:'private',skin:'private',balance:'9007199254740993',skills:{progress:{MINING:{level:4,experience:9,secret:'private'},ADMIN:{level:99}}},metrics:{'kills.npc.total':3,'staff.actions':99}}],listings:[],guilds:[{name:'Guild',bank:'private',officerNote:'private',memberCount:4}]});
  const json=JSON.stringify(projected);assert.ok(!json.includes('private'));assert.ok(!json.includes('ADMIN'));assert.ok(!json.includes('staff.actions'));assert.equal(projected.players[0].balance,'9007199254740993');assert.equal(projected.players[0].skills.MINING.level,4);
});
test('snapshot market excludes expired listings and sorts full prices precisely',async()=>{
  const snapshot=sanitizeSnapshot({players:[],listings:[{id:'expired',name:'Old',price:1,quantity:1,expiresAt:1},{id:'high',name:'High',price:'9007199254740993',quantity:5},{id:'low',name:'Low',price:'9007199254740992',quantity:1}]});
  const market=await new SnapshotData(snapshot).market({sort:'price-asc'});assert.deepEqual(market.listings.map(l=>l.id),['low','high']);assert.equal(market.listings[1].price,'9007199254740993');
});
