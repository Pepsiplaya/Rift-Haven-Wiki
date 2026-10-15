(() => {
  let pending;
  const retired=new Set(['item:Ore_Thorium','item:Ore_Cobalt','item:Ingredient_Bar_Thorium','item:Ingredient_Bar_Cobalt','item:Ingredient_Ore_Thorium','item:Ingredient_Ore_Cobalt']);
  function currentMaterials(guide){const levels={'item:Ore_Copper':1,'item:Ore_Tin':1,'item:Ore_Iron':10,'item:Ore_Adamantite':20,'item:Ore_Mithril':30,'item:Ore_Onyxium':45};guide.articles=guide.articles.filter(a=>!retired.has(a.id));for(const a of guide.articles){a.links=(a.links||[]).filter(id=>!retired.has(id));a.blocks=(a.blocks||[]).filter(b=>!retired.has(b.link));for(const b of a.blocks){const level=levels[a.id]??levels[b.link];if(level!=null)b.text=String(b.text||'').replace(/Mining (?:level )?\d+/g,'Mining '+level);}}return guide;}
  async function json(url){const response=await fetch(url,{cache:'no-cache',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Guide unavailable');return response.json();}
  window.RiftGuideData={load:()=>pending??=Promise.all([
    json('/assets/data/guide.json').catch(()=>null),
    json(window.RIFT_CONFIG.apiBase+'/guide').catch(()=>null),
    json('/assets/data/guide-additions.json').catch(()=>({articles:[]}))
  ]).then(([current,live,additions])=>{
    if(!current&&!live)throw new Error('Guide unavailable');
    // A delayed game export must not replace the current published handbook.
    const articles=new Map((live?.articles||[]).map(a=>[a.id,a]));
    for(const article of current?.articles||[])articles.set(article.id,article);
    for(const article of additions.articles||[])if(!articles.has(article.id))articles.set(article.id,article);
    const base=currentMaterials({...live,...current,articles:[...articles.values()]});
    const ids=new Set(base.articles.map(a=>a.id));
    const classes=base.articles.find(a=>a.id==='classes');
    if(classes&&ids.has('class:druid')&&!classes.links.includes('class:druid')){classes.links.push('class:druid');classes.keywords+=' druid nature guardian briarwolf';}
    return base;
  }).catch(error=>{pending=null;throw error;})};
})();
