'use strict';
const items=require('../assets/data/items.json');
const clean=(value,max=5000)=>String(value??'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').slice(0,max);
function projectGuide(raw){
  if(!Array.isArray(raw.articles)||raw.articles.length>6000)throw new Error('Invalid guide');
  const categories=['Getting Started','Professions','Items & Materials','Quests & Adventure','Classes & Combat','Town & Trading','Collections & Controls'];
  const articles=raw.articles.map(a=>({id:clean(a.id,160),title:clean(a.title,160),category:categories.includes(a.category)?a.category:'Getting Started',summary:clean(a.summary,1500),keywords:clean(a.keywords,1500),icon:items[a.icon]?.icon||null,blocks:(a.blocks||[]).slice(0,500).map(b=>({text:clean(b.text),heading:b.heading===true,icon:items[b.icon]?.icon||null,link:clean(b.link,160)})),links:(a.links||[]).slice(0,500).map(v=>clean(v,160))}));
  const ids=new Set(articles.map(a=>a.id));if(ids.size!==articles.length||ids.has(''))throw new Error('Duplicate guide article');
  for(const article of articles){article.links=article.links.filter(id=>ids.has(id));for(const block of article.blocks)if(!ids.has(block.link))block.link='';}
  const guide={categories,articles};if(Buffer.byteLength(JSON.stringify(guide))>1048576)throw new Error('Guide too large');return guide;
}
module.exports={projectGuide};
