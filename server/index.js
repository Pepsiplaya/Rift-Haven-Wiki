'use strict';
const http=require('node:http');const fs=require('node:fs/promises');const path=require('node:path');const {createDatabase}=require('./database');const {PublicData}=require('./public-data');const {publicApi}=require('./routes');
const root=path.resolve(__dirname,'..'),host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT)||8092;
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
const allowedPage=/^\/(?:home|profiles|profile\/[^/]+|market|guilds|rankings|dungeons|guide(?:\/[^/]+)?|news(?:\/[^/]+)?)\/?$/;
let db,data;const rateLimits=new Map();
function limited(key){const now=Date.now();let bucket=rateLimits.get(key);if(!bucket||bucket.until<now){bucket={until:now+60000,count:0};rateLimits.set(key,bucket);}if(rateLimits.size>10000)for(const [k,v]of rateLimits)if(v.until<now)rateLimits.delete(k);return ++bucket.count>120;}
function json(response,status,body){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':status===200?'public, max-age=15':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(body));}
async function initialize(){try{db=await createDatabase();const load=async file=>{try{return JSON.parse(await fs.readFile(path.join(root,'assets/data',file),'utf8'));}catch{return {};}};data=new PublicData(db,{group:process.env.RIFT_DB_GROUP||'mmo',items:await load('items.json'),dungeons:await load('dungeons.json')});console.log('Public records connected with verified database TLS.');}catch(error){console.error('Public records unavailable:',error.code||error.name);}}
const server=http.createServer(async(request,response)=>{
  response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  let url;try{url=new URL(request.url,'http://localhost');}catch{return json(response,400,{error:'Invalid request'});}
  if(!['GET','HEAD'].includes(request.method))return json(response,405,{error:'Read-only endpoint'});
  if(url.pathname.startsWith('/api/')){
    if(limited(request.socket.remoteAddress||'local')){response.setHeader('Retry-After','60');return json(response,429,{error:'Please try again shortly'});}
    if(!data)return json(response,503,{error:'Public records temporarily unavailable'});
    try{return json(response,200,await publicApi(url,data));}catch(error){if(!error.status)console.error('Public API read failed:',error.code||error.name);return json(response,error.status||503,{error:error.status===404?'Not found':'Public records temporarily unavailable'});}
  }
  let target;if(url.pathname==='/'||url.pathname==='/index.html'||allowedPage.test(url.pathname))target=path.join(root,'index.html');
  else if(url.pathname.startsWith('/assets/')){try{const decoded=decodeURIComponent(url.pathname),resolved=path.resolve(root,'.'+decoded);if(!resolved.startsWith(path.join(root,'assets')+path.sep))return json(response,403,{error:'Forbidden'});target=resolved;}catch{return json(response,400,{error:'Invalid path'});}}
  else return json(response,404,{error:'Not found'});
  try{const body=await fs.readFile(target);response.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});response.end(request.method==='HEAD'?undefined:body);}catch{return json(response,404,{error:'Not found'});}
});
initialize().finally(()=>server.listen(port,host,()=>console.log(`Rift Haven preview: http://${host}:${port}`)));
async function shutdown(){server.close();if(db)await db.end();process.exit(0);}process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
