(() => {
  let pending;
  async function json(url){const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Guide unavailable');return response.json();}
  window.RiftGuideData={load:()=>pending??=Promise.all([json(window.RIFT_CONFIG.apiBase+'/guide').catch(()=>json('/assets/data/guide.json')),json('/assets/data/guide-additions.json').catch(()=>({articles:[]}))]).then(([base,additions])=>{const ids=new Set(base.articles.map(a=>a.id));for(const article of additions.articles||[])if(!ids.has(article.id)){base.articles.push(article);ids.add(article.id);}const classes=base.articles.find(a=>a.id==='classes');if(classes&&ids.has('class:druid')&&!classes.links.includes('class:druid')){classes.links.push('class:druid');classes.keywords+=' druid nature guardian briarwolf';}return base;}).catch(error=>{pending=null;throw error;})};
})();
