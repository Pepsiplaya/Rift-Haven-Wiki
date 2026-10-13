'use strict';
const {policy}=require('./audit-bot');
function project(row){
  let details;try{details=JSON.parse(row.details_json);}catch{details={};}
  let summary='';
  if(row.kind==='wallet.change')summary=`gold ${details.before} → ${details.after} (delta ${details.delta})`;
  if(row.kind==='auction.purchase')summary=`${details.itemId} x${details.quantity}; price ${details.price}; seller ${details.sellerName}; listing ${details.listingId}; claims ${details.itemClaimId}/${details.goldClaimId}`;
  if(row.kind==='bank.items.changed')summary=`${(details.changes||[]).map(i=>`${i.itemId} ${Number(i.delta)>0?'+':''}${i.delta}`).join('; ')}; receipt ${details.receipt}`;
  if(!summary)summary=Object.entries(details).filter(([key])=>!key.endsWith('Id')).map(([key,value])=>`${key}: ${String(value).slice(0,100)}`).join('; ');
  return {eventId:row.event_id,transactionId:row.transaction_id,createdAt:Number(row.created_at),category:row.category,kind:row.kind,outcome:row.outcome,actorName:row.actor_name,summary,details};
}
class AuditStore{
  constructor(db,group='mmo'){if(!/^[a-z0-9_]{1,32}$/.test(group))throw new Error('Invalid audit group');this.db=db;this.table='`audit_outbox_'+group+'`';}
  async pending(){const [rows]=await this.db.execute(`SELECT event_id,transaction_id,created_at,category,kind,outcome,actor_name,details_json FROM ${this.table} WHERE delivered_at IS NULL ORDER BY sequence_id LIMIT 100`);return rows.map(project);}
  async search(reference,limit=10){const [rows]=await this.db.execute(`SELECT event_id,transaction_id,created_at,category,kind,outcome,actor_name,details_json FROM ${this.table} WHERE event_id=? OR transaction_id=? ORDER BY sequence_id LIMIT ${Math.max(1,Math.min(10,Number(limit)||10))}`,[reference,reference]);return rows.map(project);}
  async acknowledge(ids,messageId){if(!ids.length||ids.length>10||ids.some(id=>! /^[a-f0-9-]{36}$/i.test(id))||!/^\d{1,32}$/.test(messageId))throw new Error('Invalid delivery receipt');await this.db.execute(`UPDATE ${this.table} SET delivered_at=?,discord_message_id=? WHERE delivered_at IS NULL AND event_id IN (${ids.map(()=>'?').join(',')})`,[Date.now(),messageId,...ids]);}
  async prune(now=Date.now()){
    // Never prune undelivered records or any pre-existing recording/telemetry table.
    await this.db.execute(`DELETE FROM ${this.table} WHERE delivered_at IS NOT NULL AND category<>'alerts' AND created_at<? LIMIT 500`,[now-policy.retention.detailedDays*86400000]);
    await this.db.execute(`DELETE FROM ${this.table} WHERE delivered_at IS NOT NULL AND category='alerts' AND created_at<? LIMIT 500`,[now-policy.retention.suspiciousCaseDays*86400000]);
  }
}
module.exports={AuditStore,project};
