'use strict';
const crypto=require('node:crypto');
const policy=require('./audit-policy.json');
const categories=new Set(Object.keys(policy.channels));
const clean=(value,limit=160)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/[@`*_~|<>\\]/g,'').slice(0,limit);
function authorized(interaction){
  return interaction?.guild_id===policy.guildId &&
    Array.isArray(interaction.member?.roles) &&
    interaction.member.roles.some(role=>policy.allowedRoleIds.includes(role));
}
function verifyInteraction(body,signature,timestamp,publicKey,now=Date.now()){
  if(!/^[a-f0-9]{128}$/i.test(signature||'')||!/^[a-f0-9]{64}$/i.test(publicKey||'')||!/^\d{10}$/.test(timestamp||''))return false;
  if(Math.abs(now/1000-Number(timestamp))>300)return false;
  try{
    const key=crypto.createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(publicKey,'hex')]),format:'der',type:'spki'});
    return crypto.verify(null,Buffer.concat([Buffer.from(timestamp),Buffer.from(body)]),key,Buffer.from(signature,'hex'));
  }catch{return false;}
}
function line(event){
  const category=categories.has(event.category)?event.category:'alerts';
  const outcome=['committed','observed','attempt','aborted','recovered','unknown'].includes(event.outcome)?event.outcome:'unknown';
  const time=new Date(Number(event.createdAt));
  return `${Number.isFinite(time.getTime())?time.toISOString():'Unknown time'} | ${category} | ${clean(event.kind)} | ${outcome} | ${clean(event.actorName,64)||'system'} | ${clean(event.summary,320)} | ref ${clean(event.eventId)} | tx ${clean(event.transactionId)}`;
}
const itemCatalog=require('../assets/data/items.json');
const colors={economy:0xd5b76a,items:0x62b8cf,activity:0x70b897,staff:0xa398dd,alerts:0xd98665};
const titles={'wallet.change':'Wallet updated','auction.purchase':'Auction purchased','auction.listing.created':'Auction listed','auction.listing.cancelled':'Listing cancelled','auction.return':'Auction returned to claims','auction.item.claim':'Item collected','auction.gold.claim':'Auction proceeds collected','bank.tab.purchase':'Bank tab unlocked','bank.transfer.settled':'Bank transfer saved','bank.transfer.cancelled':'Bank transfer cancelled','bank.items.changed':'Bank items moved','dungeon.start':'Dungeon entered','dungeon.complete':'Dungeon completed','dungeon.abandoned':'Dungeon run ended','staff.command':'Staff command used','staff.command.invoked':'Staff command invoked','integration.test':'Audit connection ready'};
function embed(event){
  const category=categories.has(event.category)?event.category:'alerts',d=event.details||{},fields=[];
  const field=(name,value,inline=false)=>{if(value!=null&&String(value)!=='')fields.push({name,value:String(value).split('\n').map(line=>clean(line,500)).join('\n').slice(0,500),inline});};
  const money=value=>{try{return BigInt(String(value)).toLocaleString('en-US')+' gold';}catch{return clean(value,40);}};
  let description=`**${clean(event.actorName,64)||'System'}**`;
  if(event.kind==='integration.test')description='Staff logging is connected. This was a delivery test; no player transaction or suspected abuse was recorded.';
  else if(event.kind==='wallet.change'){field('Before',money(d.before),true);field('After',money(d.after),true);field('Change',(Number(d.delta)>0?'+':'')+money(d.delta),true);}
  else if(event.kind.startsWith('auction.')){field('Item',itemCatalog[d.itemId]?.name||d.itemId,true);field('Quantity',d.quantity,true);field('Total price',d.price?money(d.price):null,true);field('Seller',d.sellerName,true);field('Market fee',d.saleCut?money(d.saleCut):null,true);field('Seller receives',d.sellerProceeds?money(d.sellerProceeds):null,true);field('Source',d.source||d.reason);}
  else if(event.kind==='bank.items.changed')field('Bank balance changes',(d.changes||[]).map(i=>`${Number(i.delta)>0?'+':''}${i.delta} ${itemCatalog[i.itemId]?.name||i.itemId}`).join('\n'));
  else if(event.kind.startsWith('dungeon.')){field('Dungeon',require('../assets/data/dungeons.json').find(row=>row.id===d.dungeonId)?.name||d.dungeonId,true);field('Party size',d.partySize,true);if(d.durationMs)field('Elapsed',Math.floor(d.durationMs/60000)+'m '+Math.floor(d.durationMs/1000)%60+'s',true);}
  else if(event.kind==='staff.command.invoked'){field('Command',d.command,true);field('Arguments',d.argumentCount,true);field('Status','Invocation recorded; completion is not implied');}else field('Details',event.summary);
  const reference=clean(event.eventId,80),transaction=clean(event.transactionId,80);
  fields.push({name:'Investigation reference',value:'Event: `'+reference+'`'+(transaction?'\nTransaction: `'+transaction+'`':'')});
  const result={title:titles[event.kind]||clean(event.kind.replace(/[._]/g,' '),100),description,color:event.kind==='integration.test'?0x70b897:colors[category],fields,footer:{text:event.kind==='integration.test'?'Rift Haven Audit · System test':'Rift Haven Audit · '+clean(event.outcome||'unknown',30)}};
  const time=new Date(Number(event.createdAt));if(Number.isFinite(time.getTime()))result.timestamp=time.toISOString();
  const icon=itemCatalog[d.itemId]?.icon;if(icon)result.thumbnail={url:'https://rift-haven.com/assets/images/'+icon+'.webp'};
  return result;
}
function batches(events){
  const groups=new Map();for(const event of events.slice(0,policy.delivery.maxEventsPerRun)){const category=categories.has(event.category)?event.category:'alerts';if(!groups.has(category))groups.set(category,[]);groups.get(category).push(event);}
  const messages=[];for(const [category,rows]of groups){let group=[],embeds=[],size=0;for(const event of rows){const panel=embed(event),length=panel.title.length+panel.description.length+panel.footer.text.length+panel.fields.reduce((n,f)=>n+f.name.length+f.value.length,0);if(group.length&&(group.length>=5||size+length>5500)){messages.push({channelId:policy.channels[category],events:group,content:'',embeds});group=[];embeds=[];size=0;}group.push(event);embeds.push(panel);size+=length;}if(group.length)messages.push({channelId:policy.channels[category],events:group,content:'',embeds});}return messages;
}
/** Sequential delivery. Persist Discord's receipt before advancing the outbox cursor.
 * A crash between Discord acceptance and acknowledgement may duplicate a batch;
 * stable event references make that visible. Never claim exactly-once delivery. */
async function deliver(events,{token,fetch:request=globalThis.fetch,acknowledge}){
  if(!token)throw new Error('Discord bot token is missing');
  let sent=0;
  for(const batch of batches(events)){
    const response=await request(`https://discord.com/api/v10/channels/${batch.channelId}/messages`,{
      method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({content:batch.content,embeds:batch.embeds,allowed_mentions:{parse:[],users:[],roles:[],replied_user:false}}),signal:AbortSignal.timeout(10000)
    });
    if(response.status===429){const limit=await response.json();return {sent,retryAfterSeconds:Math.max(1,Number(limit.retry_after)||5),global:limit.global===true};}
    if(!response.ok)throw new Error(`Discord delivery failed (${response.status})`);
    const receipt=await response.json();if(!receipt.id)throw new Error('Discord message receipt is missing');
    await acknowledge(batch.events.map(e=>e.eventId),receipt.id);sent+=batch.events.length;
  }
  return {sent,retryAfterSeconds:0};
}
function ephemeral(content){return {type:4,data:{content,flags:64,allowed_mentions:{parse:[]}}};}
async function interactionReply(interaction,search,flag){
  if(interaction.type===1)return {type:1};
  if(!authorized(interaction))return ephemeral('This command is restricted to Rift Haven staff in the staff server.');
  if(interaction.type!==2||!['audit','audit-case'].includes(interaction.data?.name))return ephemeral('Unknown audit command.');
  const options=interaction.data.options||[];
  const reference=String(options.find(o=>o.name==='reference')?.value||'');
  if(!/^[a-zA-Z0-9_ -]{1,80}$/.test(reference))return ephemeral('Provide an event or transaction reference.');
  if(interaction.data.name==='audit-case'){
    const reason=clean(options.find(o=>o.name==='reason')?.value,500);
    if(!reason.trim()||!flag)return ephemeral('Provide a reason for keeping this investigation.');
    return ephemeral(await flag(reference,reason)?'Case retained with its transaction evidence for 180 days. This is a review flag, not proof of abuse.':'No retained records match that reference.');
  }
  const records=await search(reference,10);
  return records.length?{type:4,data:{embeds:records.slice(0,5).map(embed),flags:64,allowed_mentions:{parse:[]}}}:ephemeral('No retained records match that reference.');
}
async function registerCommands(token,request=globalThis.fetch){
  for(const name of ['audit','audit-case']){
  const response=await request(`https://discord.com/api/v10/applications/${policy.applicationId}/guilds/${policy.guildId}/commands`,{
    method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({name,description:name==='audit'?'Look up an audit event, transaction or exact player name (staff only)':'Retain transaction evidence for a staff investigation (180 days)',type:1,options:[{name:'reference',description:'Event/transaction reference, or exact player name for /audit',type:3,required:true,min_length:1,max_length:80},...(name==='audit-case'?[{name:'reason',description:'Why staff should review this transaction',type:3,required:true,min_length:1,max_length:500}]:[])]}),signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw new Error(`Discord command registration failed (${response.status})`);
  await response.json();
  }
  return {registered:true};
}
module.exports={policy,authorized,verifyInteraction,batches,deliver,interactionReply,registerCommands,embed};
