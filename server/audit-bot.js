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
  const outcome=['committed','attempt','aborted','recovered','unknown'].includes(event.outcome)?event.outcome:'unknown';
  const time=new Date(Number(event.createdAt));
  return `${Number.isFinite(time.getTime())?time.toISOString():'Unknown time'} | ${category} | ${clean(event.kind)} | ${outcome} | ${clean(event.actorName,64)||'system'} | ${clean(event.summary,320)} | ref ${clean(event.eventId)} | tx ${clean(event.transactionId)}`;
}
function batches(events){
  const groups=new Map();
  for(const event of events.slice(0,policy.delivery.maxEventsPerRun)){
    const category=categories.has(event.category)?event.category:'alerts';
    if(!groups.has(category))groups.set(category,[]);groups.get(category).push(event);
  }
  const messages=[];
  for(const [category,rows]of groups){let group=[],content='';
    for(const event of rows){const next=line(event);
      if(group.length && (group.length>=policy.delivery.maxEventsPerMessage || content.length+next.length+1>policy.delivery.maxContentLength)){
        messages.push({channelId:policy.channels[category],events:group,content});group=[];content='';
      }
      group.push(event);content+=(content?'\n':'')+next;
    }
    if(group.length)messages.push({channelId:policy.channels[category],events:group,content});
  }
  return messages;
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
      body:JSON.stringify({content:batch.content,allowed_mentions:{parse:[],users:[],roles:[],replied_user:false}}),signal:AbortSignal.timeout(10000)
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
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(reference))return ephemeral('Provide an event or transaction reference.');
  if(interaction.data.name==='audit-case'){
    const reason=clean(options.find(o=>o.name==='reason')?.value,500);
    if(!reason.trim()||!flag)return ephemeral('Provide a reason for keeping this investigation.');
    return ephemeral(await flag(reference,reason)?'Case retained with its transaction evidence for 180 days. This is a review flag, not proof of abuse.':'No retained records match that reference.');
  }
  const records=await search(reference,10);
  return ephemeral(records.length?records.map(line).join('\n').slice(0,1900):'No retained records match that reference.');
}
async function registerCommands(token,request=globalThis.fetch){
  for(const name of ['audit','audit-case']){
  const response=await request(`https://discord.com/api/v10/applications/${policy.applicationId}/guilds/${policy.guildId}/commands`,{
    method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({name,description:name==='audit'?'Look up a retained Rift Haven audit event or transaction (staff only)':'Retain transaction evidence for a staff investigation (180 days)',type:1,options:[{name:'reference',description:'Event or transaction reference from an audit log',type:3,required:true,min_length:1,max_length:80},...(name==='audit-case'?[{name:'reason',description:'Why staff should review this transaction',type:3,required:true,min_length:1,max_length:500}]:[])]}),signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw new Error(`Discord command registration failed (${response.status})`);
  await response.json();
  }
  return {registered:true};
}
module.exports={policy,authorized,verifyInteraction,batches,deliver,interactionReply,registerCommands};
