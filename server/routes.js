'use strict';
async function publicApi(url,data){
  const path=url.pathname.replace(/^\/api/,'').split('/').filter(Boolean).map(part=>decodeURIComponent(part));const params=Object.fromEntries(url.searchParams);
  if(path[0]==='health')return {status:'ok'};
  if(path[0]==='overview'&&path.length===1)return data.overview();
  if(path[0]==='status'&&path.length===1)return data.status();
  if(path[0]==='players'&&path.length===1)return data.players(params);
  if(path[0]==='players'&&path.length===2){const profile=await data.profile(path[1]);if(!profile){const error=new Error('Character not found');error.status=404;throw error;}return profile;}
  if(path[0]==='market'&&path.length===1)return data.market(params);
  if(path[0]==='guilds'&&path.length===1)return data.guilds(params);
  if(path[0]==='rankings'&&path.length===1)return data.rankings(params);
  if(path[0]==='dungeons'&&path.length===1)return data.dungeons();
  const error=new Error('Not found');error.status=404;throw error;
}
module.exports={publicApi};
