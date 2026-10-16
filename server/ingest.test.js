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
test('item inspection uses native artwork and drops private metadata',async()=>{
  const snapshot=sanitizeSnapshot({players:[],listings:[{id:'food',itemId:'Food_Wildmeat_Raw',name:'Wild Meat',price:'1',quantity:'3',metadata:'private receipt',details:{ownerId:'private',receipt:'private',stats:{strength:7,secretStat:99},requiredLevel:5}}]});
  const item=(await new SnapshotData(snapshot).market()).listings[0];assert.match(item.icon,/^items\/[a-f0-9]{16}$/);assert.equal(item.details.stats.strength,7);assert.equal(item.details.requiredLevel,5);assert.ok(!JSON.stringify(item).includes('private'));assert.ok(!JSON.stringify(item).includes('secretStat'));assert.match(item.details.description,/Cooking: Adds \+10 Strength/);
});
test('profession ranks break level ties using saved XP and respect class filters',async()=>{
  const data=new SnapshotData(sanitizeSnapshot({listings:[],players:[{name:'First',mainClass:'rogue',skills:{MINING:{level:8,experience:90}}},{name:'Second',mainClass:'rogue',skills:{MINING:{level:8,experience:80}}},{name:'Other',mainClass:'fighter',skills:{MINING:{level:10,experience:1}}}]}));
  const rankings=await data.rankings({metric:'skill-mining',class:'rogue'});assert.deepEqual(rankings.players.map(p=>p.name),['First','Second']);assert.equal(rankings.players[0].experience,'90');
});
test('guide export removes unrelated fields and broken navigation',()=>{
  const guide=require('./guide-data').projectGuide({articles:[{id:'farming',title:'Farming',category:'Professions',private:'secret',blocks:[{text:'Plant your seeds.',link:'missing',receipt:'secret'}],links:['missing']} ]});assert.deepEqual(guide.articles[0].links,[]);assert.equal(guide.articles[0].blocks[0].link,'');assert.ok(!JSON.stringify(guide).includes('secret'));
});
test('searching a highscore preserves its ordinal and the actual podium',async()=>{
  const data=new SnapshotData(sanitizeSnapshot({listings:[],players:Array.from({length:60},(_,i)=>({name:'Player'+i,mainClass:'rogue',level:60-i,experience:1}))}));
  const result=await data.rankings({metric:'level',q:'Player40'});assert.equal(result.players[0].rank,41);assert.equal(result.topPlayers[0].name,'Player0');assert.equal(result.totalRanked,60);
  const directory=await data.players({limit:24,page:2,sort:'level'});assert.equal(directory.players[0].name,'Player24');assert.equal(directory.pages,3);
});
test('progression XP includes completed levels instead of ranking only leftover XP',async()=>{
  const data=new SnapshotData(sanitizeSnapshot({listings:[],players:[{name:'Higher',skills:{MINING:{level:2,experience:0,xpCurveVersion:2}}},{name:'Lower',skills:{MINING:{level:1,experience:80,xpCurveVersion:2}}}]}));
  const result=await data.rankings({metric:'total-skill-xp'});assert.deepEqual(result.players.map(p=>p.name),['Higher','Lower']);assert.ok(BigInt(result.players[0].score)>80n);assert.equal((await data.profile('Higher')).skills.MINING.experienceToNextLevel,require('../assets/data/progression.json').professionCurrent[2]);
});
