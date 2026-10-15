'use strict';

const ROSTER = new Set(['fighter','paladin','elemancer','rogue','druid']);
const PROFESSIONS = new Set(['MINING','FORAGING','ALCHEMY','COOKING','JEWELCRAFTING','SMITHING','WEAPONSMITHING','FISHING','HUNTER','LEATHERWORKING','WEAVING','FARMING']);
const METRICS = Object.freeze({quests:'quests.completed.total',dungeons:'dungeon.clears.total',mining:'mining.nodes.total',fishing:'fishing.caught.total',crafting:'craft.items.total',kills:'kills.npc.total'});
const PUBLIC_METRICS = new Set([...Object.values(METRICS),'kills.pvp.total','achievements.completed.total']);
const text = (value,max=160) => String(value??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max);
const parse = value => {try { const result=typeof value==='string'?JSON.parse(value):value;return result && typeof result==='object'?result:{};} catch{return {};}};
const integer = value => {try{return BigInt(String(value??0)).toString();}catch{return '0';}};
const positive = value => {try{return BigInt(integer(value))>0n;}catch{return false;}};
const like = value => '%'+text(value,64).replace(/[\\%_]/g,'\\$&')+'%';
function timestamp(value){if(value==null||value==='')return null;const date=new Date(typeof value==='string'&&/^\d+$/.test(value)?Number(value):value);return Number.isFinite(date.getTime())?date.toISOString():null;}
function skillsProjection(raw){const data=parse(raw),source=data.progress??data;const result={};for(const [key,value]of Object.entries(source)){if(!PROFESSIONS.has(key)||!value||typeof value!=='object')continue;result[key]={level:Math.max(0,Math.min(1000,Number(value.level)||0)),experience:integer(value.experience),xpCurveVersion:[0,1,2].includes(Number(value.xpCurveVersion))&&value.xpCurveVersion!=null?Number(value.xpCurveVersion):null};}return result;}
function listingProjection(row,now=Date.now(),catalog={}){
  const data=parse(row.data_json);
  if(data.id!==row.id||!data.itemId||(data.state!=null&&data.state!=='ACTIVE')||!positive(data.quantity)||!positive(data.price))return null;
  const expiresAt=Number(data.expiresAt)||0;if(expiresAt>0&&expiresAt<=now)return null;
  const metadata=parse(data.metadata),rawRarity=metadata.Rarity??metadata.ItemRarity??metadata.Quality??catalog[data.itemId]?.rarity;
  const rarity=text(typeof rawRarity==='object'?rawRarity.$string??rawRarity.value:rawRarity,20).toLowerCase();
  const name=catalog[data.itemId]?.name||(!/^server\.|^common\./.test(data.displayName??'')?text(data.displayName):'')||text(data.itemId.replace(/_/g,' '));
  return {id:row.id,itemId:text(data.itemId,128),name,seller:text(data.sellerName||'Adventurer',64),quantity:integer(data.quantity),price:integer(data.price),createdAt:Number(data.createdAt)||0,expiresAt,rarity:['poor','common','uncommon','rare','epic','legendary'].includes(rarity)?rarity:null,icon:catalog[data.itemId]?.icon||'auction'};
}
function guildProjection(row){const data=parse(row.data_json);if(data.id!==row.id||!text(data.name))return null;const members=Object.values(data.members??{});return {name:text(data.name,64),info:text(data.info,600),createdAt:timestamp(data.createdAt),memberCount:members.length};}

class PublicData {
  constructor(db,{group='mmo',items={},dungeons=[]}={}){
    if(!/^[a-z0-9_]{1,32}$/.test(group))throw new Error('Invalid database group');
    this.db=db;this.group=group;this.items=items;this.dungeonCatalog=dungeons;
  }
  table(name){return '`'+name+'_'+this.group+'`';}
  async query(sql,values=[]){if(!/^\s*SELECT\b/i.test(sql))throw new Error('Public data queries must be SELECT-only');const [rows]=await this.db.execute(sql,values);return rows;}
  publicCharacters(ranked=false){return `SELECT ac.character_id AS character_id, ac.character_name AS name, ac.created_at, ac.last_played,
      pc.main_class, pc.subclass, pc.level, pc.experience, cu.balance, (COALESCE(h.hidden,0)=0 AND COALESCE(hc.hidden,0)=0) AS leaderboard_eligible
      FROM ${this.table('account_characters')} ac
      LEFT JOIN ${this.table('player_classes')} pc ON pc.uuid=ac.character_id
      LEFT JOIN ${this.table('currency')} cu ON cu.uuid=ac.character_id
      LEFT JOIN ${this.hiddenTable()} h ON h.uuid=ac.account_uuid
      LEFT JOIN ${this.hiddenTable()} hc ON hc.uuid=ac.character_id
      WHERE ${ranked?'COALESCE(h.hidden,0)=0 AND COALESCE(hc.hidden,0)=0 AND LOWER(ac.character_name)<>\'lyq\' AND ':''}ac.character_name IS NOT NULL`;
  }
  hiddenTable(){return '`leaderboard_stats_'+this.group+'_hidden`';}
  characterSql(ranked=false){return this.publicCharacters(ranked);}
  characterProjection(row){return {name:text(row.name,64),leaderboardEligible:Number(row.leaderboard_eligible)!==0&&text(row.name,64).toLowerCase()!=='lyq',role:text(row.name,64).toLowerCase()==='lyq'?'founder':null,mainClass:ROSTER.has(row.main_class)?row.main_class:null,subclass:text(row.subclass,64)||null,level:row.level==null?null:Number(row.level),experience:integer(row.experience),balance:integer(row.balance),createdAt:timestamp(row.created_at),lastPlayed:timestamp(row.last_played)};}
  async players({q='',limit=36}={}){
    const safeLimit=Math.min(100,Math.max(1,Number(limit)||36));
    const source=this.characterSql();const where=q?' AND ac.character_name LIKE ?':'';const args=q?[like(q)]:[];
    const count=await this.query(`SELECT COUNT(*) AS total FROM (${source+where}) visible`,args);
    const rows=await this.query(source+where+' ORDER BY ac.last_played DESC, ac.character_name LIMIT '+safeLimit,args);
    return {players:rows.map(row=>this.characterProjection(row)),total:Number(count[0]?.total)||0};
  }
  async profile(name){
    const cleanName=text(name,64);if(!cleanName)return null;
    const rows=await this.query(this.characterSql()+' AND LOWER(ac.character_name)=LOWER(?) LIMIT 2',[cleanName]);
    if(rows.length!==1)return null;const row=rows[0],id=row.character_id;
    const [skills,quests,metrics]=await Promise.all([
      this.query(`SELECT skills_json FROM ${this.table('player_skills')} WHERE uuid=?`,[id]),
      this.query(`SELECT COUNT(*) AS completed FROM ${this.table('quest_progress')} WHERE uuid=? AND status='COMPLETED'`,[id]),
      this.query(`SELECT metric_key,score FROM ${this.table('leaderboard_stats')} WHERE uuid=?`,[id])
    ]);
    const result={...this.characterProjection(row),skills:skillsProjection(skills[0]?.skills_json),questsCompleted:Number(quests[0]?.completed)||0,metrics:{},guild:null};
    for(const metric of metrics)if(PUBLIC_METRICS.has(metric.metric_key))result.metrics[metric.metric_key]=integer(metric.score);
    const guildRows=await this.query(`SELECT id,data_json FROM ${this.table('guilds')} WHERE JSON_VALID(data_json)`);
    for(const guildRow of guildRows){const g=parse(guildRow.data_json);if(g.members?.[id]){const projected=guildProjection(guildRow);if(projected){const rank=(g.ranks??[]).find(r=>r.id===g.members[id].rankId);result.guild={name:projected.name,rank:text(rank?.name,64)};}break;}}
    return result;
  }
  async market({q='',rarity='',sort='newest',page=1,limit=20}={}){
    const now=Date.now();
    const rows=await this.query(`SELECT id,data_json FROM ${this.table('auction_listings')}
      WHERE JSON_VALID(data_json) AND (JSON_EXTRACT(data_json,'$.state') IS NULL
        OR JSON_TYPE(JSON_EXTRACT(data_json,'$.state'))='NULL' OR JSON_UNQUOTE(JSON_EXTRACT(data_json,'$.state'))='ACTIVE')
      AND (COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(data_json,'$.expiresAt')) AS UNSIGNED),0)=0
        OR CAST(JSON_UNQUOTE(JSON_EXTRACT(data_json,'$.expiresAt')) AS UNSIGNED)>?)
      ORDER BY updated_at DESC LIMIT 10000`,[now]);
    const needle=text(q,64).toLowerCase();let listings=rows.map(row=>listingProjection(row,now,this.items)).filter(Boolean);
    listings=listings.filter(item=>(!rarity||item.rarity===rarity)&&(!needle||(item.name+' '+item.seller).toLowerCase().includes(needle)));
    listings.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='price-asc'||sort==='price-desc'?(BigInt(a.price)<BigInt(b.price)?-1:BigInt(a.price)>BigInt(b.price)?1:0)*(sort==='price-desc'?-1:1):b.createdAt-a.createdAt||a.id.localeCompare(b.id));
    const size=Math.min(100,Math.max(1,Number(limit)||20)),current=Math.min(500,Math.max(1,Number(page)||1));return {listings:listings.slice((current-1)*size,current*size),total:listings.length,page:current,updatedAt:new Date(now).toISOString()};
  }
  async guilds({q=''}={}){const rows=await this.query(`SELECT id,data_json FROM ${this.table('guilds')} WHERE JSON_VALID(data_json) ORDER BY updated_at DESC LIMIT 1000`);const needle=text(q,64).toLowerCase();return {guilds:rows.map(guildProjection).filter(g=>g&&(!needle||g.name.toLowerCase().includes(needle))).sort((a,b)=>b.memberCount-a.memberCount||a.name.localeCompare(b.name))};}
  async guild(name){
    const rows=await this.query(`SELECT id,data_json FROM ${this.table('guilds')} WHERE JSON_VALID(data_json) LIMIT 1000`);
    const row=rows.find(r=>guildProjection(r)?.name.toLowerCase()===text(name,64).toLowerCase());
    if(!row)return null;
    const ids=Object.keys(parse(row.data_json).members||{}).slice(0,1000);
    const members=[];
    for(let at=0;at<ids.length;at+=100){const batch=ids.slice(at,at+100);
      const visible=await this.query(`SELECT name,main_class,level FROM (${this.characterSql(false)}) visible WHERE character_id IN (${batch.map(()=>'?').join(',')})`,batch);
      members.push(...visible.map(p=>({name:text(p.name,64),mainClass:text(p.main_class,64)||null,level:Number(p.level)||0,avatar:null})));
    }
    return {...guildProjection(row),members:members.sort((a,b)=>a.name.localeCompare(b.name))};
  }
  async rankings({metric='wealth'}={}){
    const source=this.characterSql(true);let rows;
    if(metric==='wealth'||metric==='level'){const field=metric==='wealth'?'balance':'level';rows=await this.query(`SELECT name,${field} AS score FROM (${source}) visible WHERE ${field}>0 ORDER BY ${field} DESC,name LIMIT 100`);}
    else{if(!Object.hasOwn(METRICS,metric))metric='quests';rows=await this.query(`SELECT visible.name,SUM(stats.score) AS score FROM (${source}) visible JOIN ${this.table('leaderboard_stats')} stats ON stats.uuid=visible.character_id WHERE stats.metric_key=? AND stats.score>0 GROUP BY visible.character_id,visible.name ORDER BY score DESC,visible.name LIMIT 100`,[METRICS[metric]]);}
    return {metric,players:rows.map(row=>({name:text(row.name,64),score:integer(row.score)}))};
  }
  async dungeons(){const rows=await this.query(`SELECT metric_key,SUM(score) AS clears FROM ${this.table('leaderboard_stats')} WHERE metric_key LIKE 'dungeon.clears.%' AND metric_key<>'dungeon.clears.total' GROUP BY metric_key`);const counts=Object.fromEntries(rows.map(r=>[r.metric_key,integer(r.clears)]));return {dungeons:this.dungeonCatalog.map(d=>({...d,playerClears:counts['dungeon.clears.'+d.id]??'0',bestTimeMs:null}))};}
  async overview(){const source=this.characterSql();const [characters,guilds,market,clears]=await Promise.all([
    this.query(`SELECT COUNT(*) AS total FROM (${source}) visible`),this.guilds(),this.market({limit:1}),
    this.query(`SELECT SUM(stats.score) AS total FROM (${source}) visible JOIN ${this.table('leaderboard_stats')} stats ON stats.uuid=visible.character_id WHERE stats.metric_key='dungeon.clears.total'`)
  ]);return {characters:Number(characters[0]?.total)||0,guilds:guilds.guilds.length,listings:market.total,playerClears:integer(clears[0]?.total)};}
}
module.exports={PublicData,skillsProjection,listingProjection,guildProjection,text,parse,integer};
