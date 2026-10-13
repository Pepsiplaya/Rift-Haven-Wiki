'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sanitizeSnapshot,SnapshotData}=require('./snapshot-data'),{sale}=require('./market-history'),{embed}=require('./audit-bot');
test('presence expires instead of presenting stale online players; hidden names never reach the response',async()=>{
  const raw={players:[{name:'Visible',level:12}],listings:[],presence:{observedAt:Date.now(),names:['Visible','Hidden','Visible']}};
  const live=await new SnapshotData(sanitizeSnapshot(raw)).status();assert.equal(live.state,'live');assert.equal(live.online,1);assert.equal(live.players[0].name,'Visible');assert.ok(!JSON.stringify(live).includes('Hidden'));
  raw.presence.observedAt-=181000;const stale=await new SnapshotData(sanitizeSnapshot(raw)).status();assert.equal(stale.online,null);assert.deepEqual(stale.players,[]);assert.equal(stale.state,'unknown');
});
test('equipment projection preserves inspection fields but excludes private inventory and metadata',async()=>{
  const raw={players:[{name:'Player',inventory:'PRIVATE',equipment:[{position:'head',itemId:'Armor_Adamantite_Head',quantity:1,metadata:'PRIVATE',ownerId:'PRIVATE',details:{requiredLevel:30,stats:{strength:7,secret:99},description:'A helmet.',receipt:'PRIVATE'}},{position:'storage',itemId:'Ingredient_Bar_Gold',quantity:99}],talents:{rogue_r01:2,private:'PRIVATE'}}],listings:[]};
  const profile=await new SnapshotData(sanitizeSnapshot(raw)).profile('Player');assert.equal(profile.equipment.length,1);assert.equal(profile.equipment[0].details.stats.strength,7);assert.equal(profile.equipment[0].details.requiredLevel,30);assert.match(profile.equipment[0].icon,/^items\//);assert.ok(!JSON.stringify(profile).includes('PRIVATE'));assert.ok(!JSON.stringify(profile).includes('secret'));assert.deepEqual(profile.talents,{rogue_r01:2});
});
test('public sales retain precise prices while removing all staff investigation and buyer fields',()=>{
  const projected=sale({created_at:Date.now(),actor_name:'PRIVATE',transaction_id:'PRIVATE',details_json:JSON.stringify({itemId:'Food_Wildmeat_Raw',quantity:3,price:'9007199254740993',sellerId:'PRIVATE',payloadHash:'PRIVATE',goldClaimId:'PRIVATE'})});assert.equal(projected.price,'9007199254740993');assert.match(projected.icon,/^items\//);assert.ok(!JSON.stringify(projected).includes('PRIVATE'));assert.equal(sale({created_at:Date.now(),details_json:'{"itemId":"bad/../../path","quantity":1,"price":4}'}),null);
});
test('wallet embed shows the known reward source and detail; older entries say source was not captured',()=>{
  const event={kind:'wallet.change',category:'economy',actorName:'Player',createdAt:Date.now(),details:{before:'10',after:'20',delta:'10',source:'Quest reward',questName:'A beginning'}};
  const fields=embed(event).fields;assert.equal(fields.find(f=>f.name==='Source').value,'Quest reward');assert.equal(fields.find(f=>f.name==='Quest').value,'A beginning');event.details={before:'1',after:'2',delta:'1'};assert.match(embed(event).fields.find(f=>f.name==='Source').value,/not recorded/);
});
test('older publisher preserves dated gear, explicit unequip clears it, and reused names never inherit it',()=>{
  const {mergeMissingPublicFields}=require('./ingest'),saved={players:[{name:'Player',createdAt:'2026-10-01',equipment:[{itemId:'Old_Gear'}],equipmentUpdatedAt:'2026-10-12',talents:{talent:1}}]};
  const older={players:[{name:'Player',createdAt:'2026-10-01',equipment:null,talents:null}]};mergeMissingPublicFields(older,saved);assert.equal(older.players[0].equipment[0].itemId,'Old_Gear');
  const empty={players:[{name:'Player',createdAt:'2026-10-01',equipment:[],talents:{}}]};mergeMissingPublicFields(empty,saved);assert.deepEqual(empty.players[0].equipment,[]);
  const reused={players:[{name:'Player',createdAt:'2026-10-13',equipment:null}]};mergeMissingPublicFields(reused,saved);assert.equal(reused.players[0].equipment,null);
});
