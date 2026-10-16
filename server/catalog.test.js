'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const catalog=require('../assets/data/discovery-items.json'),items=catalog.items,metadata=require('../assets/data/items.json');
const drops=id=>items[id].sources.filter(s=>s.type==='drop').map(s=>s.creature);

test('drop percentages describe receiving an item rather than summing repeated gem rolls',()=>{
  const source=(item,role)=>items[item].sources.find(s=>s.creature===role);
  assert.equal(source('Ingredient_Hide_Dark','RiftCore_Desert_Raptor_Level_25').dropChance,.5);
  assert.equal(source('Ingredient_Life_Essence','RiftCore_Desert_Raptor_Level_25').dropChance,.25);
  for(const item of ['Ingredient_Fabric_Scrap_Prismaloom','Ingredient_Hide_Heavy','Ore_Onyxium'])assert.equal(source(item,'Outlander_Priest_Level_22').dropChance,.15);
  const noGemOfType=.9+.1*(6/7)*(.9+.1*(6/7)*(.9+.1*(6/7)));
  assert.ok(Math.abs(source('Rock_Gem_Ruby','Outlander_Priest_Level_22').dropChance-(1-noGemOfType))<1e-9);
  assert.deepEqual(catalog.creatures.Trork_Raider_Level_16.gemChain,{chance:.1,maximum:3,repeatChance:.1,twoOrMore:.01,three:.001});
  for(const item of Object.values(items))for(const row of item.sources.filter(s=>s.type==='drop'))assert.ok(row.dropChance>0&&row.dropChance<=1);
});

test('plant seeds follow the new creature tiers and conditional brush drops',()=>{
  for(const [id,creature] of [['RiftCore_Seed_Whitecap','Cactee'],['RiftCore_Seed_Bluecap','Snapdragon']]){
    assert.ok(drops(id).includes(creature));
    assert.ok(items[id].sources.some(s=>s.type==='gathering'&&s.method.includes('1-in-10')));
    assert.ok(!drops(id).includes(creature==='Cactee'?'Snapdragon':'Cactee'));
  }
  assert.ok(!items.RiftCore_Seed_Pork);
  const party=items.RiftCore_Seed_Pumpkin.sources;
  assert.ok(!party.some(s=>s.type==='bag'||s.type==='drop'));
  assert.ok(party.some(s=>s.type==='gathering'&&s.method.includes('1 in 50')));
  assert.ok(party.some(s=>s.type==='gathering'&&s.method.includes('1 in 25')));
});

test('meals and potions describe the current stats, stacking and one-bottle recipes',()=>{
  assert.ok(!items.Food_Egg);assert.ok(!items.RiftCore_Frozen_Time);
  // Exact combination identities remain available for saved equipment/market
  // labels, while the browsable compendium contains only base foods.
  assert.match(metadata.RiftCore_MealV3__Beef__Beef__Pork.description,/\+80 Strength/);
  assert.match(metadata.RiftCore_MealV3__Beef__Corn__Pork.description,/\+25 Agility/);
  const meals=Object.entries(items).filter(([id])=>id.startsWith('RiftCore_MealV3__'));
  assert.equal(meals.length,21);
  assert.equal(new Set(meals.map(([,item])=>item.name)).size,21);
  for(const [id,item] of meals){assert.equal(id.split('__').length,2);assert.equal(item.recipes.length,1);assert.equal(item.recipes[0].requiredLevel,1);}
  assert.ok(!items.RiftCore_MealV3__Beef__Beef__Pork);
  assert.ok(!items.RiftCore_MealV3__Beef__Corn__Pork);
  assert.match(items.RiftCore_MealV3__Pork.description,/one minute/);
  assert.equal(items.RiftCore_MealV3__Pork.recipes[0].requiredLevel,1);
  for(const item of Object.values(items))for(const recipe of item.recipes.filter(r=>r.profession==='ALCHEMY')){
    assert.equal(recipe.quantity,1);assert.equal(recipe.goldCost,0);
  }
  assert.match(items.RiftCore_Alchemy_BATTLE_T1.description,/5/);
  assert.match(items.RiftCore_Alchemy_GUARDIAN_T3.description,/15%/);
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
  const context={window:{RIFT_CONFIG:{apiBase:'/api'}},AbortSignal,fetch:async url=>({ok:true,json:async()=>structuredClone(url==='/api/guide'?{articles:[{id:'fishing',title:'OLD',blocks:[],links:[]},{id:'live-extra',title:'Live',blocks:[],links:[]},{id:'item:Food_Egg',title:'Retired egg',blocks:[],links:[]},{id:'recipe:cooking:old_stew',title:'Old recipe',blocks:[],links:[]}]}:url.endsWith('guide-additions.json')?{articles:[]}:current)})};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/js/guide-data.js'),'utf8'),context);
  const guide=await context.window.RiftGuideData.load();assert.equal(guide.articles.find(a=>a.id==='fishing').title,fishing.title);
  assert.ok(guide.articles.some(a=>a.id==='live-extra'));
  assert.ok(!guide.articles.some(a=>a.id==='item:Food_Egg'||a.id==='recipe:cooking:old_stew'));
  assert.match(JSON.stringify(guide.articles.find(a=>a.id==='jewelcrafting')),/126 base XP/);
  assert.match(JSON.stringify(guide.articles.find(a=>a.id==='fishing')),/Legendary 7/);
});
