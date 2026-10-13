'use strict';
const {text,integer,skillsProjection}=require('./public-data');
const metrics={quests:'quests.completed.total',dungeons:'dungeon.clears.total',mining:'mining.nodes.total',fishing:'fishing.caught.total',crafting:'craft.items.total',kills:'kills.npc.total'};
const validClasses=new Set(['fighter','paladin','elemancer','rogue','druid']);
const professions=new Set(['MINING','FORAGING','FARMING','FISHING','SMITHING','WEAPONSMITHING','LEATHERWORKING','WEAVING','COOKING','ALCHEMY','JEWELCRAFTING','HUNTER']);
const catalog=require('../assets/data/items.json');
const dungeonCatalog=require('../assets/data/dungeons.json');
const {createHash}=require('node:crypto');
const appearanceKeys=new Set(['bodyCharacteristic','underwear','face','eyes','ears','mouth','haircut','eyebrows','facialHair','pants','undertop','overtop','shoes','gloves','overpants','cape','faceAccessory','headAccessory','earAccessory']);
function appearanceHash(raw){const visual={};for(const key of Object.keys(raw||{}).sort())if(appearanceKeys.has(key)&&typeof raw[key]==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(raw[key]))visual[key]=raw[key];return Object.keys(visual).length?createHash('sha256').update(JSON.stringify(visual)).digest('hex').slice(0,24):null;}
const rarities=new Set(['poor','common','uncommon','rare','epic','legendary','set','mythic']);
function itemDetails(raw={}){
  const result={};for(const key of ['slot','weaponType','armorType','requiredClass','requiredSubclass'])if(raw[key])result[key]=text(raw[key],80);
  for(const key of ['requiredLevel','durability','maxDurability'])if(Number.isFinite(Number(raw[key]))&&raw[key]!=null)result[key]=Number(raw[key]);
  if(raw.description)result.description=text(raw.description,4000).replace(/^\[TMP\]\s*/,'');
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
  result.avatar=appearanceHash(raw.appearance);
  return result;
}
function sanitizeSnapshot(raw){
  if(!Array.isArray(raw.players)||raw.players.length>10000||!Array.isArray(raw.listings)||raw.listings.length>10000)throw new Error('Invalid public snapshot');
  const players=raw.players.map(profile).filter(p=>p.name);
  const guilds=(raw.guilds||[]).slice(0,1000).map(g=>({name:text(g.name,64),info:text(g.info,600),createdAt:timestamp(g.createdAt),memberCount:Math.max(0,Number(g.memberCount)||0)}));
  const listings=raw.listings.map(l=>({id:text(l.id,64),itemId:text(l.itemId,128),name:text(l.name,160),seller:text(l.seller,64),sellerProfile:text(l.sellerProfile,64)||null,quantity:integer(l.quantity),price:integer(l.price),createdAt:Number(l.createdAt)||0,expiresAt:Number(l.expiresAt)||0,rarity:rarities.has(l.rarity)?l.rarity:null,details:itemDetails(l.details)})).filter(l=>BigInt(l.quantity)>0n&&BigInt(l.price)>0n);
  const dungeons=(raw.dungeons||[]).slice(0,100).map(d=>({id:text(d.id,64),name:text(d.name,128),description:text(d.description,600),minLevel:Number(d.minLevel)||0,maxLevel:Number(d.maxLevel)||60,minPlayers:Number(d.minPlayers)||1,maxPlayers:Number(d.maxPlayers)||5,native:d.native===true,playerClears:integer(d.playerClears),bestTimeMs:null}));
  return {players,guilds,listings,dungeons};
}
class SnapshotData{
  constructor(snapshot){Object.assign(this,snapshot);this.records=snapshot.players;delete this.players;this.guildRecords=snapshot.guilds;delete this.guilds;this.dungeonRecords=snapshot.dungeons;delete this.dungeons;this.listings=snapshot.listings.map(enrichListing);}
  async players({q='',limit=36}={}){const needle=text(q,64).toLowerCase(),rows=this.records.filter(p=>p.name.toLowerCase().includes(needle));return {players:rows.slice(0,Math.min(100,Math.max(1,Number(limit)||36))),total:rows.length};}
  async profile(name){const matches=this.records.filter(p=>p.name.toLowerCase()===String(name).toLowerCase());return matches.length===1?matches[0]:null;}
  async guilds({q=''}={}){return {guilds:this.guildRecords.filter(g=>g.name.toLowerCase().includes(text(q,64).toLowerCase())).sort((a,b)=>b.memberCount-a.memberCount)};}
  async dungeons(){return {dungeons:this.dungeonRecords.length?this.dungeonRecords:dungeonCatalog.map(d=>({...d,native:d.preserveNativeEncounters===true,playerClears:null,bestTimeMs:null}))};}
  async market({q='',rarity='',sort='newest',page=1,limit=20}={}){
    const now=Date.now(),needle=text(q,64).toLowerCase();const rows=this.listings.filter(l=>(!l.expiresAt||l.expiresAt>now)&&(!rarity||l.rarity===rarity)&&(!needle||(l.name+' '+l.seller).toLowerCase().includes(needle)));
    rows.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort.startsWith('price-')?(BigInt(a.price)<BigInt(b.price)?-1:BigInt(a.price)>BigInt(b.price)?1:0)*(sort==='price-desc'?-1:1):b.createdAt-a.createdAt);
    const size=Math.min(100,Math.max(1,Number(limit)||20)),current=Math.min(500,Math.max(1,Number(page)||1));return {listings:rows.slice((current-1)*size,current*size),total:rows.length,page:current,updatedAt:new Date(this.generatedAt||now).toISOString()};
  }
  async rankings({metric='level',class:classFilter=''}={}){
    const profession=metric.startsWith('skill-')?metric.slice(6).toUpperCase():null;
    if(!['wealth','level','class-xp','total-skills','total-skill-xp',...Object.keys(metrics)].includes(metric)&&!professions.has(profession))metric='level';
    const score=p=>profession?p.skills[profession]?.level||0:metric==='wealth'?p.balance:metric==='level'?p.level:metric==='class-xp'?p.experience:metric==='total-skills'?Object.values(p.skills).reduce((n,s)=>n+s.level,0):metric==='total-skill-xp'?Object.values(p.skills).reduce((n,s)=>n+BigInt(s.experience),0n).toString():p.metrics[metrics[metric]]||0;
    const xp=p=>profession?p.skills[profession]?.experience||'0':metric==='level'?p.experience:'0';
    return {metric,players:this.records.filter(p=>!validClasses.has(classFilter)||p.mainClass===classFilter).map(p=>({name:p.name,mainClass:p.mainClass,avatar:p.avatar,score:integer(score(p)),experience:integer(xp(p))})).filter(p=>BigInt(p.score)>0n).sort((a,b)=>BigInt(a.score)>BigInt(b.score)?-1:BigInt(a.score)<BigInt(b.score)?1:BigInt(a.experience)>BigInt(b.experience)?-1:BigInt(a.experience)<BigInt(b.experience)?1:a.name.localeCompare(b.name)).slice(0,100)};
  }
  async overview(){return {characters:this.records.length,guilds:this.guildRecords.length,listings:(await this.market({limit:1})).total,playerClears:this.records.reduce((n,p)=>n+BigInt(p.metrics['dungeon.clears.total']||0),0n).toString()};}
}
module.exports={sanitizeSnapshot,SnapshotData,itemDetails};
