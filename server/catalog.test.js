'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const catalog=require('../assets/data/discovery-items.json'),items=catalog.items,metadata=require('../assets/data/items.json');
const drops=id=>items[id].sources.filter(s=>s.type==='drop').map(s=>s.creature);

test('seed pages include creature, brush and all six bag acquisition routes',()=>{
  for(const [id,creature] of [['RiftCore_Seed_Cotton','Cactee'],['RiftCore_Seed_Fire_Flower','Snapdragon']]){
    assert.ok(drops(id).includes(creature));
    assert.ok(items[id].sources.some(s=>s.type==='gathering'&&s.requiredPerk==='Seed Seeker'));
    const bags=items[id].sources.filter(s=>s.type==='bag');assert.equal(bags.length,6);
    for(const bag of bags){assert.ok(items[bag.bagId]);assert.ok(bag.requirements.FARMING);assert.ok(bag.minimum>0);}
  }
});
test('current raw hides and tanning routes replace obsolete NPC leather rewards',()=>{
  assert.ok(drops('Ingredient_Hide_Light').includes('Molerat_Level_12'));
  assert.ok(!drops('Ingredient_Hide_Medium').includes('Molerat_Level_12'));
  assert.ok(!drops('Ingredient_Hide_Soft').includes('Ram_Level_5'));
  assert.ok(drops('Ingredient_Fabric_Scrap_Cotton').includes('Ram_Level_5'));
  assert.deepEqual(drops('Ingredient_Hide_Dark').sort(),['RiftCore_Desert_Raptor_Level_25','RiftCore_Desert_Rex_Level_25']);
  const recipe=items.Ingredient_Leather_Dark.recipes.find(r=>r.bench==='Tannery');
  assert.deepEqual(recipe.inputs,[{itemId:'Ingredient_Hide_Dark',quantity:1}]);assert.equal(recipe.requiredLevel,36);
  for(const [id,item] of Object.entries(items))if(id.startsWith('Ingredient_Leather_'))assert.ok(!item.sources.some(s=>s.type==='drop'));
});
test('fish display the balanced species rarity in compendium and API metadata',()=>{
  const fish=Object.entries(items).filter(([,v])=>v.sources.some(s=>s.type==='fishing')&&v.name!=='Dead Fish');
  const totals={};for(const [id,item] of fish){totals[item.rarity]=(totals[item.rarity]||0)+1;assert.equal(metadata[id].rarity,item.rarity);}
  assert.deepEqual(totals,{common:6,uncommon:7,rare:9,epic:6,legendary:2});
  assert.equal(items.Fish_Crab_Item.rarity,'common');assert.equal(items.Fish_Shark_Hammerhead_Item.rarity,'legendary');
});
test('bag limits, raw supplies and lesser gem caps follow the current rewards',()=>{
  for(const [tier,count,min,max,gemMax] of [['Poor',2,1,3,1],['Common',3,2,5,2],['Uncommon',4,3,6,2],['Rare',5,4,8,3],['Epic',6,5,10,4],['Legendary',7,10,15,5]]){
    assert.ok(items['RiftCore_Bag_'+tier].description.includes(`Exactly ${count}`));
    const source=items.Ore_Copper.sources.find(s=>s.bagId==='RiftCore_Bag_'+tier);assert.equal(source.minimum,min);assert.equal(source.maximum,max);
    assert.equal(items.Rock_Gem_Ruby_Lesser.sources.find(s=>s.bagId==='RiftCore_Bag_'+tier).maximum,gemMax);
  }
  for(const [id,item] of Object.entries(items))if(item.sources.some(s=>s.type==='bag')){
    assert.ok(!/^Ingredient_(Bar|Leather|Bolt)_/.test(id));if(id.startsWith('Rock_Gem_'))assert.ok(id.endsWith('_Lesser'));
  }
});
test('ore availability and timers exclude retired raw metals without hiding physical market gear',()=>{
  for(const [metal,level,seconds] of [['Copper',1,30],['Tin',1,30],['Iron',10,30],['Adamantite',20,60],['Mithril',30,150],['Onyxium',45,600]]){
    const source=items['Ore_'+metal].sources.find(s=>s.type==='gathering');assert.equal(source.requiredLevel,level);assert.equal(source.respawnSeconds,seconds);
  }
  for(const metal of ['Thorium','Cobalt']){assert.ok(!items['Ore_'+metal]);assert.ok(!items['Ingredient_Bar_'+metal]);assert.ok(metadata['Armor_'+metal+'_Chest']);}
});
test('the published handbook wins over stale live text while preserving extra live articles',async()=>{
  const current=require('../assets/data/guide.json'),fishing=current.articles.find(a=>a.id==='fishing');
  const context={window:{RIFT_CONFIG:{apiBase:'/api'}},AbortSignal,fetch:async url=>({ok:true,json:async()=>structuredClone(url==='/api/guide'?{articles:[{id:'fishing',title:'OLD',blocks:[],links:[]},{id:'live-extra',title:'Live',blocks:[],links:[]}]}:url.endsWith('guide-additions.json')?{articles:[]}:current)})};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/js/guide-data.js'),'utf8'),context);
  const guide=await context.window.RiftGuideData.load();assert.equal(guide.articles.find(a=>a.id==='fishing').title,fishing.title);
  assert.ok(guide.articles.some(a=>a.id==='live-extra'));
  assert.match(JSON.stringify(guide.articles.find(a=>a.id==='jewelcrafting')),/900 XP/);
  assert.match(JSON.stringify(guide.articles.find(a=>a.id==='fishing')),/Legendary 7/);
});
