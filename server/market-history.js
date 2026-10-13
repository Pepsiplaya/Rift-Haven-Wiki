'use strict';
const catalog=require('../assets/data/items.json');
const {integer,text}=require('./public-data');
function sale(row){let d;try{d=JSON.parse(row.details_json);}catch{return null;}
  if(!/^[A-Za-z0-9_.-]{1,128}$/.test(d.itemId||''))return null;
  const quantity=integer(d.quantity),price=integer(d.price);if(BigInt(quantity)<=0n||BigInt(price)<=0n)return null;
  const date=new Date(row.created_at);if(!Number.isFinite(date.getTime()))return null;
  const item=catalog[d.itemId]||{};return {itemId:d.itemId,name:item.name||text(d.itemName,160)||d.itemId.replace(/_/g,' '),icon:item.icon||'auction',quantity,price,rarity:item.rarity||null,soldAt:date.toISOString()};
}
async function history(db,{q='',item='',page=1}={}){
  const needle=text(q,64),id=/^[A-Za-z0-9_.-]{1,128}$/.test(item)?item:'',current=Math.min(500,Math.max(1,Math.floor(Number(page)||1))),since=Date.now()-30*86400000;
  const clauses=["kind='auction.purchase'","outcome='committed'",'created_at>=?'],values=[since];
  if(id){clauses.push("json_extract(details_json,'$.itemId')=?");values.push(id);}
  if(needle){const ids=Object.entries(catalog).filter(([k,v])=>(v.name+' '+k).toLowerCase().includes(needle.toLowerCase())).map(([k])=>k);if(!ids.length)return {sales:[],total:0,page:1,pages:1,windowDays:30,priceSample:null};clauses.push("json_extract(details_json,'$.itemId') IN (SELECT value FROM json_each(?))");values.push(JSON.stringify(ids));}
  const where=clauses.join(' AND '),count=await db.prepare('SELECT COUNT(*) AS total FROM audit_events WHERE '+where).bind(...values).first();
  const {results}=await db.prepare('SELECT created_at,details_json FROM audit_events WHERE '+where+' ORDER BY created_at DESC LIMIT 20 OFFSET ?').bind(...values,(current-1)*20).all();
  let priceSample=null;if(id){const sample=await db.prepare('SELECT created_at,details_json FROM audit_events WHERE '+where+' ORDER BY created_at DESC LIMIT 1000').bind(...values).all();const sales=sample.results.map(sale).filter(Boolean);if(sales.length){const quantity=sales.reduce((sum,s)=>sum+BigInt(s.quantity),0n),gold=sales.reduce((sum,s)=>sum+BigInt(s.price),0n);priceSample={sales:sales.length,quantity:quantity.toString(),averageUnitPrice:(gold/quantity).toString(),days:Object.entries(Object.groupBy(sales,s=>s.soldAt.slice(0,10))).sort(([a],[b])=>a.localeCompare(b)).map(([date,rows])=>({date,count:rows.length,quantity:rows.reduce((n,s)=>n+BigInt(s.quantity),0n).toString(),averageUnitPrice:(rows.reduce((n,s)=>n+BigInt(s.price),0n)/rows.reduce((n,s)=>n+BigInt(s.quantity),0n)).toString()}))};}}
  return {sales:results.map(sale).filter(Boolean),total:count.total,page:current,pages:Math.max(1,Math.ceil(count.total/20)),windowDays:30,priceSample};
}
module.exports={history,sale};
