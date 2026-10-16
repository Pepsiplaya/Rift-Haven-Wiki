'use strict';
const {text,integer,skillsProjection}=require('./public-data');
const metrics={quests:'quests.completed.total',dungeons:'dungeon.clears.total',mining:'mining.nodes.total',fishing:'fishing.caught.total',crafting:'craft.items.total',kills:'kills.npc.total'};
const validClasses=new Set(['fighter','paladin','elemancer','rogue','druid']);
const professions=new Set(['MINING','FORAGING','FARMING','FISHING','SMITHING','WEAPONSMITHING','LEATHERWORKING','WEAVING','COOKING','ALCHEMY','JEWELCRAFTING','HUNTER']);
const catalog=require('../assets/data/items.json');
const dungeonCatalog=require('../assets/data/dungeons.json');
const curves=require('../assets/data/progression.json');
function totalProgression(level,experience,curve){const at=Math.min(60,Math.max(1,Number(level)||1));return (BigInt(experience||0)+curve.slice(1,at).reduce((n,x)=>n+BigInt(x),0n)).toString();}
function enrichProfile(player){const p={...player,skills:Object.fromEntries(Object.entries(player.skills).map(([key,s])=>{const curve=s.xpCurveVersion===curves.professionRevision?curves.professionBySkill?.[key]:s.xpCurveVersion===2?curves.professionCurrent:s.xpCurveVersion===0||s.xpCurveVersion===1?curves.professionLegacy:null;return [key,{...s,totalExperience:curve?totalProgression(s.level,s.experience,curve):null,experienceToNextLevel:curve?.[s.level]??null}];}))};p.totalExperience=totalProgression(p.level,p.experience,curves.classes);p.experienceToNextLevel=curves.classes[p.level]??null;return p;}
const {createHash}=require('node:crypto');
const appearanceKeys=new Set(['bodyCharacteristic','underwear','face','eyes','ears','mouth','haircut','eyebrows','facialHair','pants','undertop','overtop','shoes','gloves','overpants','cape','faceAccessory','headAccessory','earAccessory']);
function appearanceHash(raw){const visual={};for(const key of Object.keys(raw||{}).sort())if(appearanceKeys.has(key)&&typeof raw[key]==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(raw[key]))visual[key]=raw[key];return Object.keys(visual).length?createHash('sha256').update(JSON.stringify(visual)).digest('hex').slice(0,24):null;}
const rarities=new Set(['poor','common','uncommon','rare','epic','legendary','set','mythic']);
function itemDetails(raw={}){
  const result={};for(const key of ['slot','weaponType','armorType','requiredClass','requiredSubclass'])if(raw[key])result[key]=text(raw[key],80);
  for(const key of ['requiredLevel','durability','maxDurability'])if(Number.isFinite(Number(raw[key]))&&raw[key]!=null)result[key]=Number(raw[key]);
  if(raw.description)result.description=String(raw.description).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').slice(0,4000).replace(/^\[TMP\]\s*/,'');
  const allowedStats=new Set(['strength','constitution','dexterity','agility','intelligence','wisdom','spirit','armor','physicalResistance','projectileResistance','spellPower','maxHealth','maxStamina','damage','attackSpeed']);
  result.stats={};for(const [key,value]of Object.entries(raw.stats||{}))if(allowedStats.has(key)&&Number.isFinite(Number(value)))result.stats[key]=Number(value);
  return result;
}
function enrichListing(listing){
  const item=catalog[listing.itemId]||{},quality=listing.rarity||item.rarity;
  return {...listing,name:listing.name||item.name||String(listing.itemId||'Item').replace(/_/g,' '),icon:item.icon||'auction',rarity:rarities.has(quality)?quality:null,
    details:{...itemDetails({...item,requiredClass:item.requiredMainClass}),...listing.details,stats:Object.keys(listing.details?.stats||{}).length?listing.details.stats:itemDetails(item).stats}};
}
const timestamp=value=>{const date=new Date(value);return value&&Number.isFinite(date.getTime())?date.toISOString():null;};
function profile(raw){
  const result={name:text(raw.name,64),mainClass:validClasses.has(raw.mainClass)?raw.mainClass:null,subclass:text(raw.subclass,64)||null,level:Math.max(0,Number(raw.level)||0),experience:integer(raw.experience),balance:integer(raw.balance),createdAt:timestamp(raw.createdAt),lastPlayed:timestamp(raw.lastPlayed),questsCompleted:Math.max(0,Number(raw.questsCompleted)||0),skills:skillsProjection(raw.skills),metrics:{},guild:raw.guild?{name:text(raw.guild.name,64),rank:text(raw.guild.rank,64)}:null};
  for(const key of Object.values(metrics))if(raw.metrics?.[key]!=null)result.metrics[key]=integer(raw.metrics[key]);
  result.leaderboardEligible=raw.leaderboardEligible!==false && result.name.toLowerCase()!=='lyq';
  result.role=result.name.toLowerCase()==='lyq'?'founder':null;
  result.avatar=appearanceHash(raw.appearance);
  result.equipment=Array.isArray(raw.equipment)?raw.equipment.slice(0,9).filter(e=>['head','chest','hands','legs','mainHand','offHand','ringOne','ringTwo','amulet'].includes(e.position)&&/^[A-Za-z0-9_.-]{1,128}$/.test(e.itemId||'')).map(e=>({position:e.position,itemId:e.itemId,name:text(e.name,160)||null,quantity:integer(e.quantity),rarity:rarities.has(e.rarity)?e.rarity:null,details:itemDetails(e.details),gems:(Array.isArray(e.gems)?e.gems:[]).filter(id=>/^[A-Za-z0-9_.-]{1,128}$/.test(id)).slice(0,6)})):null;
  result.equipmentUpdatedAt=timestamp(raw.equipmentUpdatedAt);
  result.talents=raw.talents&&typeof raw.talents==='object'?Object.fromEntries(Object.entries(raw.talents).filter(([id,rank])=>/^[A-Za-z0-9_.-]{1,100}$/.test(id)&&Number.isInteger(rank)&&rank>0&&rank<=10).slice(0,100)):null;
  return result;
}
function sanitizeSnapshot(raw){
  if(!Array.isArray(raw.players)||raw.players.length>10000||!Array.isArray(raw.listings)||raw.listings.length>10000)throw new Error('Invalid public snapshot');
  const players=raw.players.map(profile).filter(p=>p.name);
  const guilds=(raw.guilds||[]).slice(0,1000).map(g=>({name:text(g.name,64),info:text(g.info,600),createdAt:timestamp(g.createdAt),memberCount:Math.max(0,Number(g.memberCount)||0)}));
  const listings=raw.listings.map(l=>({id:text(l.id,64),itemId:text(l.itemId,128),name:text(l.name,160),seller:text(l.seller,64),sellerProfile:text(l.sellerProfile,64)||null,quantity:integer(l.quantity),price:integer(l.price),createdAt:Number(l.createdAt)||0,expiresAt:Number(l.expiresAt)||0,rarity:rarities.has(l.rarity)?l.rarity:null,details:itemDetails(l.details)})).filter(l=>BigInt(l.quantity)>0n&&BigInt(l.price)>0n);
  const dungeons=(raw.dungeons||[]).slice(0,100).map(d=>({id:text(d.id,64),name:text(d.name,128),description:text(d.description,600),minLevel:Number(d.minLevel)||0,maxLevel:Number(d.maxLevel)||60,minPlayers:Number(d.minPlayers)||1,maxPlayers:Number(d.maxPlayers)||5,native:d.native===true,playerClears:integer(d.playerClears),bestTimeMs:null}));
  const knownNames=new Map(players.map(p=>[p.name.toLowerCase(),p.name])),observed=Number(raw.presence?.observedAt);
  const presence=Number.isSafeInteger(observed)&&observed>0?{observedAt:observed,names:[...new Set((Array.isArray(raw.presence.names)?raw.presence.names:[]).map(n=>knownNames.get(String(n).toLowerCase())).filter(Boolean))]}:null;
  if(presence){const count=raw.presence.connectedCount;presence.connectedCount=typeof count==='number'&&Number.isSafeInteger(count)&&count>=0&&count<=10000?Math.max(count,presence.names.length):null;}
  return {players,guilds,listings,dungeons,presence};
}
class SnapshotData{
  constructor(snapshot){Object.assign(this,snapshot);this.records=snapshot.players.map(enrichProfile).map(p=>({...p,equipment:p.equipment?.map(e=>enrichListing(e))??null}));delete this.players;this.guildRecords=snapshot.guilds;delete this.guilds;this.dungeonRecords=snapshot.dungeons;delete this.dungeons;this.listings=snapshot.listings.map(enrichListing);}
  async status(){const observed=Number(this.presence?.observedAt)||0,fresh=observed>0&&Date.now()-observed>=-30000&&Date.now()-observed<180000;return {state:fresh?'live':'unknown',observedAt:observed?new Date(observed).toISOString():null,updatedAt:this.generatedAt?new Date(this.generatedAt).toISOString():null,players:fresh?this.records.filter(p=>this.presence.names.includes(p.name)).map(({name,mainClass,level,avatar})=>({name,mainClass,level,avatar})):[],online:fresh?(this.presence.connectedCount??null):null,publicOnline:fresh?this.presence.names.length:null};}
  async players({q='',limit=36,page=1,class:classFilter='',sort='recent'}={}){
    const needle=text(q,64).toLowerCase(),matches=this.records.filter(p=>p.name.toLowerCase().includes(needle));
    const rows=matches.filter(p=>!validClasses.has(classFilter)||p.mainClass===classFilter);
    rows.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='level'?b.level-a.level||a.name.localeCompare(b.name):sort==='wealth'?(BigInt(a.balance)>BigInt(b.balance)?-1:BigInt(a.balance)<BigInt(b.balance)?1:a.name.localeCompare(b.name)):new Date(b.lastPlayed||0)-new Date(a.lastPlayed||0)||a.name.localeCompare(b.name));
    const size=Math.min(100,Math.max(1,Math.floor(Number(limit)||36))),pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(pages,Math.max(1,Math.floor(Number(page)||1)));
    return {players:rows.slice((current-1)*size,current*size),total:rows.length,page:current,pages,classCounts:Object.fromEntries([...validClasses].map(key=>[key,matches.filter(p=>p.mainClass===key).length])),updatedAt:new Date(this.generatedAt||Date.now()).toISOString()};
  }
  async profile(name){const matches=this.records.filter(p=>p.name.toLowerCase()===String(name).toLowerCase());return matches.length===1?matches[0]:null;}
  async guilds({q=''}={}){return {guilds:this.guildRecords.filter(g=>g.name.toLowerCase().includes(text(q,64).toLowerCase())).sort((a,b)=>b.memberCount-a.memberCount)};}
  async guild(name){
    const guild=this.guildRecords.find(g=>g.name.toLowerCase()===text(name,64).toLowerCase());
    if(!guild)return null;
    const members=this.records.filter(p=>p.guild?.name?.toLowerCase()===guild.name.toLowerCase())
      .map(({name,mainClass,level,avatar})=>({name,mainClass,level,avatar})).sort((a,b)=>a.name.localeCompare(b.name));
    return {name:guild.name,info:guild.info,createdAt:guild.createdAt,memberCount:guild.memberCount,members};
  }
  async dungeons(){return {dungeons:this.dungeonRecords.length?this.dungeonRecords:dungeonCatalog.map(d=>({...d,native:d.preserveNativeEncounters===true,playerClears:null,bestTimeMs:null}))};}
  async market({q='',rarity='',sort='newest',page=1,limit=20}={}){
    const now=Date.now(),needle=text(q,64).toLowerCase();const rows=this.listings.filter(l=>(!l.expiresAt||l.expiresAt>now)&&(!rarity||l.rarity===rarity)&&(!needle||(l.name+' '+l.seller).toLowerCase().includes(needle)));
    rows.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort.startsWith('price-')?(BigInt(a.price)<BigInt(b.price)?-1:BigInt(a.price)>BigInt(b.price)?1:0)*(sort==='price-desc'?-1:1):b.createdAt-a.createdAt);
    const size=Math.min(100,Math.max(1,Number(limit)||20)),current=Math.min(500,Math.max(1,Number(page)||1));return {listings:rows.slice((current-1)*size,current*size),total:rows.length,page:current,updatedAt:new Date(this.generatedAt||now).toISOString()};
  }
  async rankings({metric='level',class:classFilter='',q='',page=1,limit=25}={}){
    let profession=metric.startsWith('skill-')?metric.slice(6).toUpperCase():null;
    if(!['wealth','level','class-xp','total-skills','total-skill-xp',...Object.keys(metrics)].includes(metric)&&!professions.has(profession)){metric='level';profession=null;}
    const score=p=>profession?p.skills[profession]?.level||0:metric==='wealth'?p.balance:metric==='level'?p.level:metric==='class-xp'?p.totalExperience:metric==='total-skills'?Object.values(p.skills).reduce((n,s)=>n+s.level,0):metric==='total-skill-xp'?Object.values(p.skills).every(s=>s.totalExperience!=null)?Object.values(p.skills).reduce((n,s)=>n+BigInt(s.totalExperience),0n).toString():0:p.metrics[metrics[metric]]||0;
    const xp=p=>profession?p.skills[profession]?.experience||'0':metric==='level'?p.experience:'0';
    const ranked=this.records.filter(p=>p.leaderboardEligible!==false).filter(p=>!validClasses.has(classFilter)||p.mainClass===classFilter).map(p=>({name:p.name,mainClass:p.mainClass,avatar:p.avatar,score:integer(score(p)),experience:integer(xp(p))})).filter(p=>BigInt(p.score)>0n).sort((a,b)=>BigInt(a.score)>BigInt(b.score)?-1:BigInt(a.score)<BigInt(b.score)?1:BigInt(a.experience)>BigInt(b.experience)?-1:BigInt(a.experience)<BigInt(b.experience)?1:a.name.localeCompare(b.name)).map((p,i)=>({...p,rank:i+1}));
    const rows=ranked.filter(p=>p.name.toLowerCase().includes(text(q,64).toLowerCase())),size=Math.min(100,Math.max(1,Math.floor(Number(limit)||25))),pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(pages,Math.max(1,Math.floor(Number(page)||1)));
    return {metric,players:rows.slice((current-1)*size,current*size),topPlayers:ranked.slice(0,3),total:rows.length,totalRanked:ranked.length,page:current,pages};
  }
  async overview(){return {characters:this.records.length,guilds:this.guildRecords.length,listings:(await this.market({limit:1})).total,playerClears:this.records.reduce((n,p)=>n+BigInt(p.metrics['dungeon.clears.total']||0),0n).toString()};}
}
module.exports={sanitizeSnapshot,SnapshotData,itemDetails};
