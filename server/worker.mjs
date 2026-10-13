import routeModule from './routes.js';
import botModule from './audit-bot.js';
import snapshotModule from './snapshot-data.js';
import d1Module from './d1-audit-store.js';
import ingestModule from './ingest.js';
const {publicApi}=routeModule,{verifyInteraction,interactionReply,deliver}=botModule;
const {SnapshotData}=snapshotModule,{D1AuditStore}=d1Module;
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function discord(request,env,ctx){
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(Number(request.headers.get('content-length'))>16384)return json({error:'Body too large'},413);
  const body=await request.text();if(body.length>16384)return json({error:'Body too large'},413);
  if(!verifyInteraction(body,request.headers.get('x-signature-ed25519'),request.headers.get('x-signature-timestamp'),env.DISCORD_PUBLIC_KEY))return json({error:'Invalid signature'},401);
  let interaction;try{interaction=JSON.parse(body);}catch{return json({error:'Invalid JSON'},400);}
  if(interaction.type===1)return json({type:1});
  // Defer only after the role check; a DB connection cannot delay Discord's 3-second acknowledgement.
  if(!botModule.authorized(interaction))return json(await interactionReply(interaction,()=>[]));
  ctx.waitUntil((async()=>{let db;try{
    const store=new D1AuditStore(env.DATA);const reply=await interactionReply(interaction,(ref)=>store.search(ref),(ref,reason)=>store.flag(ref,interaction.member.user.id,reason));
    await fetch(`https://discord.com/api/v10/webhooks/${botModule.policy.applicationId}/${interaction.token}/messages/@original`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(reply.data),signal:AbortSignal.timeout(10000)});
  }catch{
    console.error('Private audit search failed');
    await fetch(`https://discord.com/api/v10/webhooks/${botModule.policy.applicationId}/${interaction.token}/messages/@original`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'Audit records are temporarily unavailable. Please try again shortly.',allowed_mentions:{parse:[]}}),signal:AbortSignal.timeout(10000)}).catch(()=>{});
  }finally{if(db)await db.end();}})());
  return json({type:5,data:{flags:64}});
}
export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/internal/test-preview'){
      if(request.method!=='POST')return json({error:'Method not allowed'},405);const body=await request.text();
      if(body.length>512||!ingestModule.verify(body,request.headers.get('x-rift-time'),request.headers.get('x-rift-signature'),env.RIFT_SYNC_SECRET))return json({error:'Invalid signature'},401);
      let reference;try{reference=JSON.parse(body).reference;}catch{return json({error:'Invalid reference'},400);}
      const row=await env.DATA.prepare("SELECT * FROM audit_events WHERE event_id=? AND kind='integration.test' AND discord_message_id IS NOT NULL").bind(String(reference)).first();if(!row)return json({error:'Delivered system test not found'},404);
      const event=(await new D1AuditStore(env.DATA).search(reference))[0];const response=await fetch(`https://discord.com/api/v10/channels/${botModule.policy.channels.alerts}/messages/${row.discord_message_id}`,{method:'PATCH',headers:{Authorization:`Bot ${env.DISCORD_BOT_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({content:'',embeds:[botModule.embed(event)],allowed_mentions:{parse:[]}}),signal:AbortSignal.timeout(10000)});return json({updated:response.ok,status:response.status},response.ok?200:502);
    }
    if(url.pathname==='/internal/setup'){
      if(request.method!=='POST'||!ingestModule.verify('',request.headers.get('x-rift-time'),request.headers.get('x-rift-signature'),env.RIFT_SYNC_SECRET))return json({error:'Invalid signature'},401);
      return env.AUDIT_DISPATCHER.get(env.AUDIT_DISPATCHER.idFromName('rift-haven-audit')).fetch('https://dispatcher/setup');
    }
    if(url.pathname==='/internal/status'){
      if(request.method!=='GET'||!ingestModule.verify('',request.headers.get('x-rift-time'),request.headers.get('x-rift-signature'),env.RIFT_SYNC_SECRET))return json({error:'Invalid signature'},401);
      if(!env.DISCORD_BOT_TOKEN)return json({botSecret:false});
      const headers={Authorization:`Bot ${env.DISCORD_BOT_TOKEN}`};
      const bot=await fetch('https://discord.com/api/v10/users/@me',{headers});
      if(!bot.ok)return json({botSecret:true,botAuthentication:false,status:bot.status});
      const user=await bot.json(),channels=[];
      for(const [category,id]of Object.entries(botModule.policy.channels)){
        const response=await fetch(`https://discord.com/api/v10/channels/${id}`,{headers});
        const channel=response.ok?await response.json():{};channels.push({category,accessible:response.ok&&channel.guild_id===botModule.policy.guildId,status:response.status});
      }
      const commands=await fetch(`https://discord.com/api/v10/applications/${botModule.policy.applicationId}/guilds/${botModule.policy.guildId}/commands`,{headers});
      return json({botSecret:true,botAuthentication:true,applicationMatches:user.id===botModule.policy.applicationId,channels,commands:commands.ok?(await commands.json()).map(c=>c.name):[]});
    }
    if(url.pathname==='/internal/sync'){
      if(request.method!=='POST')return json({error:'Method not allowed'},405);
      if(Number(request.headers.get('content-length'))>2097152)return json({error:'Batch too large'},413);
      const body=await request.text();if(body.length>2097152)return json({error:'Batch too large'},413);
      if(!ingestModule.verify(body,request.headers.get('x-rift-time'),request.headers.get('x-rift-signature'),env.RIFT_SYNC_SECRET))return json({error:'Invalid signature'},401);
      try{return json(await ingestModule.ingest(JSON.parse(body),env.DATA));}catch{return json({error:'Invalid batch or storage unavailable'},503);}
    }
    if(url.pathname==='/discord/interactions')return discord(request,env,ctx);
    if(!url.pathname.startsWith('/api/'))return json({error:'Not found'},404);
    if(request.method!=='GET')return json({error:'Read-only endpoint'},405);
    const origin=request.headers.get('origin');
    if(origin&&origin!=='https://rift-haven.com'&&origin!=='https://www.rift-haven.com')return json({error:'Origin not allowed'},403);
    if(url.pathname==='/api/guide'){
      const row=await env.DATA.prepare("SELECT data_json FROM public_snapshots WHERE id='guide'").first();const response=json(row?JSON.parse(row.data_json):{error:'Guide sync pending'},row?200:404);if(origin)response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Cache-Control','public, max-age=300');return response;
    }
    const cacheKey=new Request(url.toString(),{method:'GET'}),cache=caches.default;
    let cached=origin?null:await cache.match(cacheKey);if(cached)return cached;
    let db;try{
      const snapshot=await env.DATA.prepare("SELECT data_json,generated_at FROM public_snapshots WHERE id='world'").first();
      if(!snapshot)return json({error:'Public records are waiting for the first server sync'},503);
      const publicData=JSON.parse(snapshot.data_json);
      if(url.pathname==='/api/dungeons'){
        const {results}=await env.DATA.prepare('SELECT * FROM dungeon_rollups').all();const rollups=new Map(results.map(r=>[r.dungeon_id,r]));
        publicData.dungeons=publicData.dungeons.map(d=>({...d,bestTimeMs:rollups.get(d.id)?.best_time_ms??null,runsStarted:rollups.get(d.id)?.started??0,runsCompleted:rollups.get(d.id)?.completed??0}));
      }
      const payload=await publicApi(url,new SnapshotData({...publicData,generatedAt:snapshot.generated_at}));
      const response=json(payload);response.headers.set('Cache-Control','public, max-age=30');
      if(origin){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Vary','Origin');}
      // Cache responses independently of Origin so an allowed origin never inherits another origin's header.
      if(!origin)ctx.waitUntil(cache.put(cacheKey,response.clone()));
      return response;
    }catch(error){return json({error:error.status===404?'Not found':'Public records temporarily unavailable'},error.status||503);}
    finally{if(db)await db.end();}
  },
  async scheduled(controller,env,ctx){
    if(env.DISCORD_BOT_TOKEN)ctx.waitUntil(env.AUDIT_DISPATCHER.get(env.AUDIT_DISPATCHER.idFromName('rift-haven-audit')).fetch('https://dispatcher/setup'));
    if(!env.AUDIT_DELIVERY_ENABLED||env.AUDIT_DELIVERY_ENABLED!=='true')return;
    // A durable singleton lease prevents overlapping cron invocations; failed delivery leaves rows pending.
    ctx.waitUntil(env.AUDIT_DISPATCHER.get(env.AUDIT_DISPATCHER.idFromName('rift-haven-audit')).fetch('https://dispatcher/run'));
  }
};
export class AuditDispatcher{
  constructor(state,env){this.state=state;this.env=env;}
  async fetch(request){
    if(new URL(request.url).pathname==='/setup'){
      return this.state.blockConcurrencyWhile(async()=>{
        if(await this.state.storage.get('commandsVersion')===3)return json({registered:true});
        try{await botModule.registerCommands(this.env.DISCORD_BOT_TOKEN);await this.state.storage.put('commandsVersion',3);return json({registered:true});}
        catch{return json({error:'Bot installation or token is not ready'},503);}
      });
    }
    const acquired=await this.state.blockConcurrencyWhile(async()=>{
      const lease=await this.state.storage.get('leaseUntil')||0;
      if(Date.now()<lease)return false;
      await this.state.storage.put('leaseUntil',Date.now()+300000);return true;
    });
    if(!acquired)return json({busy:true});
    try{
      const retryAt=await this.state.storage.get('retryAt')||0;if(Date.now()<retryAt)return json({deferred:true});
      let db;try{
        const store=new D1AuditStore(this.env.DATA);
        const result=await deliver(await store.pending(),{token:this.env.DISCORD_BOT_TOKEN,acknowledge:(ids,id)=>store.acknowledge(ids,id)});
        await this.state.storage.put('retryAt',Date.now()+result.retryAfterSeconds*1000);
        // Prune hourly rather than on every minute's poll.
        const prunedAt=await this.state.storage.get('prunedAt')||0;if(Date.now()-prunedAt>3600000){await store.prune();await this.state.storage.put('prunedAt',Date.now());}
        return json({sent:result.sent});
      }catch{console.error('Audit delivery deferred; records remain pending');return json({error:'Delivery deferred'},503);}
      finally{if(db)await db.end();}
    }finally{await this.state.storage.delete('leaseUntil');}
  }
}
