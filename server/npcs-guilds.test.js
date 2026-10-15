'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {sanitizeSnapshot,SnapshotData}=require('./snapshot-data'),{publicApi}=require('./routes');
test('guild detail shows only public characters and basic guild information',async()=>{
  const raw={players:[{name:'Member',mainClass:'rogue',level:20,balance:'9999',guild:{name:'Haven & Co',rank:'PRIVATE'}},{name:'Other',guild:{name:'Other'}}],listings:[],guilds:[{name:'Haven & Co',info:'A friendly guild.',memberCount:3,bank:'PRIVATE',members:{privateUuid:{notes:'PRIVATE'}},invitations:['PRIVATE'],logs:['PRIVATE']}]};
  const data=new SnapshotData(sanitizeSnapshot(raw)),guild=await publicApi(new URL('https://example.test/api/guilds/Haven%20%26%20Co'),data);
  assert.deepEqual(Object.keys(guild).sort(),['createdAt','info','memberCount','members','name']);
  assert.deepEqual(guild.members,[{name:'Member',mainClass:'rogue',level:20,avatar:null}]);
  assert.ok(!JSON.stringify(guild).includes('PRIVATE'));assert.ok(!JSON.stringify(guild).includes('9999'));
  await assert.rejects(()=>publicApi(new URL('https://example.test/api/guilds/Missing'),data),e=>e.status===404);
});
test('NPC directory contains Rift Haven citizens and only authored overworld role families',()=>{
  const rows=require('../assets/data/npcs.json').npcs,items=require('../assets/data/discovery-items.json').items;
  assert.equal(rows.filter(n=>n.kind==='citizen').length,44);assert.equal(new Set(rows.map(n=>n.id)).size,rows.length);
  assert.ok(rows.some(n=>n.name==='Margaret Quill'&&n.lore.includes('tavern')));
  assert.ok(rows.some(n=>n.name==='Rowan Mossvale'));assert.equal(rows.filter(n=>n.name==='Tobias Watterson').length,1);
  for(const row of rows){
    for(const key of ['position','npcId','hyCitizenId','cached-skin','commands','pages'])assert.ok(!Object.hasOwn(row,key));
    if(row.kind!=='citizen')assert.match(row.id,/_Level_\d+$/);
    assert.ok(!row.id.includes('_Quest_'));
    for(const reward of row.drops)assert.ok(items[reward.itemId]);
    for(const item of row.items)assert.ok(items[item]);
    assert.ok(fs.existsSync(path.join(__dirname,'../assets/images',row.portrait+'.webp')));
  }
});
test('dungeons have distinct native encounter previews instead of a generic chest',()=>{
  const art=require('../assets/data/dungeon-art.json');assert.equal(Object.keys(art).length,6);
  assert.equal(new Set(Object.values(art).map(v=>v.image)).size,6);
  for(const row of Object.values(art)){assert.ok(row.subject);assert.ok(fs.existsSync(path.join(__dirname,'../assets/images',row.image+'.webp')));}
});
