'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sanitizeSnapshot,SnapshotData}=require('./snapshot-data'),{sale}=require('./market-history'),{embed}=require('./audit-bot');
test('staff profiles remain clickable while every leaderboard excludes them',async()=>{
 const raw={players:[{name:'Lyq',level:60,balance:'99999',leaderboardEligible:false},{name:'Staff',level:60,balance:'99999',leaderboardEligible:false},{name:'Player',level:12,balance:'10'}],listings:[],presence:{observedAt:Date.now(),names:['Lyq','Staff','Player'],connectedCount:3}};
 const data=new SnapshotData(sanitizeSnapshot(raw));
 assert.equal((await data.profile('lyq')).role,'founder');
 assert.deepEqual((await data.players()).players.map(p=>p.name).sort(),['Lyq','Player','Staff']);
 assert.deepEqual((await data.status()).players.map(p=>p.name),['Lyq','Staff','Player']);
 for(const metric of ['level','wealth','class-xp'])assert.deepEqual((await data.rankings({metric})).players.map(p=>p.name),['Player']);
});
test('retired material guide routes disappear without hiding physical gear identities',()=>{
 const {projectGuide}=require('./guide-data');
 const guide=projectGuide({articles:[{id:'mining',title:'Mining',links:['item:Ore_Cobalt','item:Ore_Mithril'],blocks:[{text:'Cobalt',link:'item:Ore_Cobalt'}]},{id:'item:Ore_Cobalt',title:'Cobalt Ore'},{id:'item:Ore_Mithril',title:'Mithril Ore'},{id:'item:Armor_Cobalt_Chest',title:'Chest armor'}]});
 assert.deepEqual(guide.articles.map(a=>a.id),['mining','item:Ore_Mithril','item:Armor_Cobalt_Chest']);
 assert.deepEqual(guide.articles[0].links,['item:Ore_Mithril']);assert.deepEqual(guide.articles[0].blocks,[]);
});
test('presence expires instead of presenting stale online players; hidden names never reach the response',async()=>{
  const raw={players:[{name:'Visible',level:12}],listings:[],presence:{observedAt:Date.now(),names:['Visible','Hidden','Visible']}};
  const live=await new SnapshotData(sanitizeSnapshot(raw)).status();assert.equal(live.state,'live');assert.equal(live.online,null);assert.equal(live.publicOnline,1);assert.equal(live.players[0].name,'Visible');assert.ok(!JSON.stringify(live).includes('Hidden'));
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
test('sales history uses committed records, exact unit averages and bound item searches',async()=>{
  const {DatabaseSync}=require('node:sqlite'),{history}=require('./market-history'),sqlite=new DatabaseSync(':memory:');
  try{sqlite.exec('CREATE TABLE audit_events(event_id TEXT PRIMARY KEY,kind TEXT,outcome TEXT,created_at INTEGER,details_json TEXT)');const insert=sqlite.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)'),now=Date.now();
    insert.run('one','auction.purchase','committed',now,JSON.stringify({itemId:'Food_Wildmeat_Raw',price:'9007199254740993',quantity:3,buyer:'PRIVATE'}));insert.run('two','auction.purchase','committed',now-1000,JSON.stringify({itemId:'Food_Wildmeat_Raw',price:'9',quantity:3}));insert.run('aborted','auction.purchase','aborted',now,JSON.stringify({itemId:'Food_Wildmeat_Raw',price:99,quantity:1}));insert.run('old','auction.purchase','committed',now-31*86400000,JSON.stringify({itemId:'Food_Wildmeat_Raw',price:99,quantity:1}));
    let maxBindings=0;const db={prepare:sql=>({bind:(...values)=>{maxBindings=Math.max(maxBindings,values.length);const statement=sqlite.prepare(sql);return {first:async()=>statement.get(...values),all:async()=>({results:statement.all(...values)})};}})};
    const data=await history(db,{item:'Food_Wildmeat_Raw'});assert.equal(data.total,2);assert.equal(data.priceSample.quantity,'6');assert.equal(data.priceSample.averageUnitPrice,((9007199254740993n+9n)/6n).toString());assert.ok(!JSON.stringify(data).includes('PRIVATE'));const search=await history(db,{q:'wild meat'});assert.equal(search.total,2);assert.ok(maxBindings<=3);
  }finally{sqlite.close();}
});

test('connected staff count does not depend on public leaderboard profiles',async()=>{
 const raw={players:[{name:'Visible',level:12}],listings:[],presence:{observedAt:Date.now(),names:['Visible','PrivateStaff'],connectedCount:2}};
 const live=await new SnapshotData(sanitizeSnapshot(raw)).status();assert.equal(live.online,2);assert.equal(live.publicOnline,1);assert.deepEqual(live.players.map(p=>p.name),['Visible']);assert.ok(!JSON.stringify(live).includes('PrivateStaff'));
 raw.players=[];raw.presence.names=['PrivateStaff'];const staff=await new SnapshotData(sanitizeSnapshot(raw)).status();assert.equal(staff.online,2);assert.equal(staff.publicOnline,0);assert.deepEqual(staff.players,[]);
 raw.presence.connectedCount=-1;assert.equal((await new SnapshotData(sanitizeSnapshot(raw)).status()).online,null);
 raw.presence.connectedCount=0;raw.presence.names=[];assert.equal((await new SnapshotData(sanitizeSnapshot(raw)).status()).online,0);
 raw.presence.observedAt-=181000;assert.equal((await new SnapshotData(sanitizeSnapshot(raw)).status()).online,null);
});
