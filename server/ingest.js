'use strict';
const crypto=require('node:crypto');const {sanitizeSnapshot}=require('./snapshot-data');
function verify(body,time,signature,secret,now=Date.now()){
  if(!secret||!/^\d{13}$/.test(time||'')||Math.abs(now-Number(time))>300000||!/^[a-f0-9]{64}$/i.test(signature||''))return false;
  const expected=crypto.createHmac('sha256',secret).update(time+'.').update(body).digest();return crypto.timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
async function ingest(payload,db){
  const statements=[];const accepted=[];
  if(payload.guide){const guide=require('./guide-data').projectGuide(payload.guide),generatedAt=Number(payload.generatedAt);if(!Number.isSafeInteger(generatedAt))throw new Error('Missing guide time');statements.push(db.prepare("INSERT INTO public_snapshots(id,data_json,generated_at) VALUES('guide',?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,generated_at=excluded.generated_at WHERE excluded.generated_at>public_snapshots.generated_at").bind(JSON.stringify(guide),generatedAt));}
  if(payload.snapshot){const snapshot=sanitizeSnapshot(payload.snapshot);const generatedAt=Number(payload.generatedAt);if(!Number.isSafeInteger(generatedAt))throw new Error('Missing snapshot time');
    // Older publishers have no equipment/presence fields. Keep explicitly dated saved
    // equipment instead of interpreting a missing field as a player unequipping it.
    const previous=await db.prepare("SELECT data_json FROM public_snapshots WHERE id='world'").first();
    if(previous){const old=JSON.parse(previous.data_json),byName=new Map((old.players||[]).map(p=>[p.name,p]));for(const player of snapshot.players){const saved=byName.get(player.name);if(!saved)continue;if(player.equipment==null&&saved.equipment!=null){player.equipment=saved.equipment;player.equipmentUpdatedAt=saved.equipmentUpdatedAt;}if(player.talents==null&&saved.talents!=null)player.talents=saved.talents;}if(!snapshot.presence&&old.presence)snapshot.presence=old.presence;}
    statements.push(db.prepare("INSERT INTO public_snapshots(id,data_json,generated_at) VALUES('world',?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,generated_at=excluded.generated_at WHERE excluded.generated_at>public_snapshots.generated_at").bind(JSON.stringify(snapshot),generatedAt));
  }
  if(!Array.isArray(payload.events)||payload.events.length>100)throw new Error('Invalid event batch');
  for(const e of payload.events){
    if(!/^[a-f0-9-]{36}$/i.test(e.eventId||'')||!/^[a-f0-9-]{36}$/i.test(e.transactionId||'')||!Object.hasOwn(require('./audit-policy.json').channels,e.category)||!Number.isSafeInteger(Number(e.createdAt))||typeof e.details!=='object')throw new Error('Invalid audit event');
    const details=JSON.stringify(e.details);if(details.length>4096)throw new Error('Audit event too large');
    statements.push(db.prepare('INSERT INTO audit_events(event_id,transaction_id,created_at,category,kind,actor_name,actor_id,outcome,details_json) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING').bind(e.eventId,e.transactionId,Number(e.createdAt),e.category,String(e.kind).slice(0,64),String(e.actorName||'').slice(0,64),String(e.actorId||'').slice(0,64),['committed','observed','attempt','aborted','recovered'].includes(e.outcome)?e.outcome:'unknown',details));accepted.push(e.eventId);
  }
  if(statements.length)await db.batch(statements);
  return {accepted};
}
module.exports={verify,ingest};
