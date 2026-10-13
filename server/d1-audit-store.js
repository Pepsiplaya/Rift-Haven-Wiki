'use strict';
const {policy}=require('./audit-bot'),{project}=require('./audit-store');
class D1AuditStore{
  constructor(db){this.db=db;}
  async pending(){const {results}=await this.db.prepare('SELECT * FROM audit_events WHERE delivered_at IS NULL ORDER BY created_at,event_id LIMIT 100').all();return results.map(project);}
  async search(reference){const {results}=await this.db.prepare('SELECT * FROM audit_events WHERE event_id=? OR transaction_id=? OR actor_name=? ORDER BY created_at DESC LIMIT 10').bind(reference,reference,reference).all();if(results.length)return results.map(project);const preserved=await this.db.prepare('SELECT evidence_json FROM audit_cases WHERE reference=?').bind(reference).first();return preserved?JSON.parse(preserved.evidence_json).slice(0,10).map(project):[];}
  async acknowledge(ids,messageId){if(!ids.length||ids.length>10)throw new Error('Invalid receipt size');await this.db.batch(ids.map(id=>this.db.prepare('UPDATE audit_events SET delivered_at=?,discord_message_id=? WHERE event_id=? AND delivered_at IS NULL').bind(Date.now(),messageId,id)));}
  async prune(now=Date.now()){
    for(let batch=0;batch<20;batch++){const result=await this.db.prepare('DELETE FROM audit_events WHERE event_id IN (SELECT event_id FROM audit_events WHERE delivered_at IS NOT NULL AND created_at<? LIMIT 500)').bind(now-policy.retention.detailedDays*86400000).run();if((result.meta?.changes||0)<500)break;}
    await this.db.prepare('DELETE FROM audit_cases WHERE reference IN (SELECT reference FROM audit_cases WHERE created_at<? LIMIT 100)').bind(now-policy.retention.suspiciousCaseDays*86400000).run();
  }
  async flag(reference,staffId,reason){
    const {results}=await this.db.prepare('SELECT * FROM audit_events WHERE transaction_id=(SELECT transaction_id FROM audit_events WHERE event_id=? OR transaction_id=? LIMIT 1) ORDER BY created_at LIMIT 128').bind(reference,reference).all();
    if(!results.length)return false;
    await this.db.prepare('INSERT INTO audit_cases(reference,created_at,opened_by,reason,evidence_json) VALUES(?,?,?,?,?) ON CONFLICT(reference) DO NOTHING').bind(reference,Date.now(),staffId,reason,JSON.stringify(results)).run();return true;
  }
}
module.exports={D1AuditStore};
