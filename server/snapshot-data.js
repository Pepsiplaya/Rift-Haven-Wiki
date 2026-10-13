'use strict';
const {text,integer,skillsProjection}=require('./public-data');
const metrics={quests:'quests.completed.total',dungeons:'dungeon.clears.total',mining:'mining.nodes.total',fishing:'fishing.caught.total',crafting:'craft.items.total',kills:'kills.npc.total'};
const validClasses=new Set(['fighter','paladin','elemancer','rogue','druid']);
const timestamp=value=>{const date=new Date(value);return value&&Number.isFinite(date.getTime())?date.toISOString():null;};
function profile(raw){
  const result={name:text(raw.name,64),mainClass:validClasses.has(raw.mainClass)?raw.mainClass:null,subclass:text(raw.subclass,64)||null,level:Math.max(0,Number(raw.level)||0),experience:integer(raw.experience),balance:integer(raw.balance),createdAt:timestamp(raw.createdAt),lastPlayed:timestamp(raw.lastPlayed),questsCompleted:Math.max(0,Number(raw.questsCompleted)||0),skills:skillsProjection(raw.skills),metrics:{},guild:raw.guild?{name:text(raw.guild.name,64),rank:text(raw.guild.rank,64)}:null};
  for(const key of Object.values(metrics))if(raw.metrics?.[key]!=null)result.metrics[key]=integer(raw.metrics[key]);
  return result;
}
function sanitizeSnapshot(raw){
  if(!Array.isArray(raw.players)||raw.players.length>10000||!Array.isArray(raw.listings)||raw.listings.length>10000)throw new Error('Invalid public snapshot');
  const players=raw.players.map(profile).filter(p=>p.name);
  const guilds=(raw.guilds||[]).slice(0,1000).map(g=>({name:text(g.name,64),info:text(g.info,600),createdAt:timestamp(g.createdAt),memberCount:Math.max(0,Number(g.memberCount)||0)}));
  const listings=raw.listings.map(l=>({id:text(l.id,64),itemId:text(l.itemId,128),name:text(l.name,160),seller:text(l.seller,64),quantity:integer(l.quantity),price:integer(l.price),createdAt:Number(l.createdAt)||0,expiresAt:Number(l.expiresAt)||0,rarity:['poor','common','uncommon','rare','epic','legendary'].includes(l.rarity)?l.rarity:null,icon:'auction'})).filter(l=>BigInt(l.quantity)>0n&&BigInt(l.price)>0n);
  const dungeons=(raw.dungeons||[]).slice(0,100).map(d=>({id:text(d.id,64),name:text(d.name,128),minLevel:Number(d.minLevel)||0,maxLevel:Number(d.maxLevel)||60,playerClears:integer(d.playerClears),bestTimeMs:null}));
  return {players,guilds,listings,dungeons};
}
class SnapshotData{
  constructor(snapshot){Object.assign(this,snapshot);this.records=snapshot.players;delete this.players;this.guildRecords=snapshot.guilds;delete this.guilds;this.dungeonRecords=snapshot.dungeons;delete this.dungeons;}
  async players({q='',limit=36}={}){const needle=text(q,64).toLowerCase(),rows=this.records.filter(p=>p.name.toLowerCase().includes(needle));return {players:rows.slice(0,Math.min(100,Math.max(1,Number(limit)||36))),total:rows.length};}
  async profile(name){const matches=this.records.filter(p=>p.name.toLowerCase()===String(name).toLowerCase());return matches.length===1?matches[0]:null;}
  async guilds({q=''}={}){return {guilds:this.guildRecords.filter(g=>g.name.toLowerCase().includes(text(q,64).toLowerCase())).sort((a,b)=>b.memberCount-a.memberCount)};}
  async dungeons(){return {dungeons:this.dungeonRecords};}
  async market({q='',rarity='',sort='newest',page=1,limit=20}={}){
    const now=Date.now(),needle=text(q,64).toLowerCase();const rows=this.listings.filter(l=>(!l.expiresAt||l.expiresAt>now)&&(!rarity||l.rarity===rarity)&&(!needle||(l.name+' '+l.seller).toLowerCase().includes(needle)));
    rows.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort.startsWith('price-')?(BigInt(a.price)<BigInt(b.price)?-1:BigInt(a.price)>BigInt(b.price)?1:0)*(sort==='price-desc'?-1:1):b.createdAt-a.createdAt);
    const size=Math.min(100,Math.max(1,Number(limit)||20)),current=Math.min(500,Math.max(1,Number(page)||1));return {listings:rows.slice((current-1)*size,current*size),total:rows.length,page:current,updatedAt:new Date(this.generatedAt||now).toISOString()};
  }
  async rankings({metric='wealth'}={}){if(!['wealth','level',...Object.keys(metrics)].includes(metric))metric='quests';const score=p=>metric==='wealth'?p.balance:metric==='level'?p.level:p.metrics[metrics[metric]]||0;return {metric,players:this.records.map(p=>({name:p.name,score:integer(score(p))})).filter(p=>BigInt(p.score)>0n).sort((a,b)=>BigInt(a.score)>BigInt(b.score)?-1:BigInt(a.score)<BigInt(b.score)?1:a.name.localeCompare(b.name)).slice(0,100)};}
  async overview(){return {characters:this.records.length,guilds:this.guildRecords.length,listings:(await this.market({limit:1})).total,playerClears:this.records.reduce((n,p)=>n+BigInt(p.metrics['dungeon.clears.total']||0),0n).toString()};}
}
module.exports={sanitizeSnapshot,SnapshotData};
