(() => {
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const link=(href,label,cls='')=>`<a href="${href}" data-route class="${cls}">${label}</a>`;
  const professions=[['mining','Mining'],['foraging','Foraging'],['farming','Farming'],['fishing','Fishing'],['hunter','Hunter'],['smithing','Smithing'],['weapon-crafting','Weapon crafting'],['leatherworking','Leatherworking'],['weaving','Weaving'],['alchemy','Alchemy'],['cooking','Cooking'],['jewelcrafting','Jewelcrafting']];
  const symbols={'Getting Started':'rift','Professions':'crafting','Items & Materials':'gear','Quests & Adventure':'dungeon','Classes & Combat':'sword','Town & Trading':'gold','Collections & Controls':'party'};
  const image=(id,cls='')=>`<img src="/assets/images/${id}.webp" alt="" class="${cls}" loading="lazy">`;
  const professionIcon=id=>'profession-'+(id==='weapon-crafting'?'weaponsmithing':id);
  const pretty=text=>escape(text).replace(/\s+([.,;:])/g,'$1').replace(/\/([a-z][a-z-]*)\b/g,'<code>/$1</code>');
  function paragraphs(text){
    const sentences=String(text).split(/(?<=[.!?])\s+(?=[A-Z])/),parts=[];let part='';
    for(const sentence of sentences){if(part.length>230){parts.push(part);part='';}part+=(part?' ':'')+sentence;}
    if(part)parts.push(part);return parts.map(p=>`<p>${pretty(p)}</p>`).join('');
  }
  function side(data,selected){return `<aside class="guide-sidebar"><p class="eyebrow">Explore the guide</p>${link('/guide','All topics','guide-side-home')}<nav aria-label="Guide categories">${data.categories.map(c=>link('/guide?category='+encodeURIComponent(c),`${image(symbols[c]||'rift')}<span>${escape(c)}</span>`,selected===c?'selected':'')).join('')}</nav><div class="guide-side-help"><p>Take it into Haven</p><span>Open <code>/guide</code> in game for help and destination tracking.</span></div></aside>`;}
  function card(article){
    const icon=professions.some(p=>p[0]===article.id)?professionIcon(article.id):symbols[article.category]||'rift';
    return link('/guide/'+encodeURIComponent(article.id),`${image(icon,'guide-topic-icon')}<div><p class="eyebrow">${escape(article.category)}</p><h2>${escape(article.title)}</h2><p>${pretty(article.summary)}</p><span class="guide-card-action">Read the guide <span aria-hidden="true">↗</span></span></div>`,'guide-topic-card');
  }
  function professionOverview(data,article){
    const intro=article.blocks.slice(0,article.blocks.findIndex(b=>b.heading&&b.text==='Mining'));
    const groups=[['Gathering & growing',['mining','foraging','farming','fishing']],['Crafting & supplies',['smithing','weapon-crafting','leatherworking','weaving','alchemy','cooking','jewelcrafting']],['Hunting & contracts',['hunter']]];
    return `<div class="guide-callout">${intro.filter(b=>!b.heading).map(b=>paragraphs(b.text)).join('')}</div>${groups.map(([heading,ids],i)=>`<section class="guide-section" id="section-${i}"><div class="guide-section-heading"><span>0${i+1}</span><h2>${heading}</h2></div><div class="profession-guide-grid">${ids.map(id=>data.articles.find(a=>a.id===id)).filter(Boolean).map(a=>link('/guide/'+a.id,`${image(professionIcon(a.id))}<h3>${escape(a.title)}</h3><p>${pretty(a.summary)}</p><span>Getting started <span aria-hidden="true">↗</span></span>`,'profession-guide-card')).join('')}</div></section>`).join('')}<section class="guide-section" id="section-3"><h2>Make a profession your own</h2><p>Fishing and Farming supply Cooking. Gathering provides materials for equipment and other crafts. Open each profession’s guide to find its starter materials and station.</p>${article.blocks.slice(article.blocks.findIndex(b=>b.heading&&b.text==='Choose profession perks')+1).map(b=>paragraphs(b.text)).join('')}</section>`;
  }
  function sections(article){let index=-1;return article.blocks.map(block=>{if(block.heading){index++;return `<h2 id="section-${index}">${escape(block.text)}</h2>`;}return paragraphs(block.text);}).join('');}
  function render({data,articleId,params,main,navigate}){
    const article=data.articles.find(a=>a.id===articleId);
    if(article){
      document.title=article.title+' — Rift Haven Guide';
      const headings=article.id==='professions'?['Gathering & growing','Crafting & supplies','Hunting & contracts','Profession perks']:article.blocks.filter(b=>b.heading).map(b=>b.text);
      const related=(article.links||[]).map(id=>data.articles.find(a=>a.id===id)).filter(Boolean);
      main.innerHTML=`<div class="portal guide-portal"><div class="guide-article-layout">${side(data,article.category)}<article class="guide-document"><div class="guide-breadcrumb">${link('/guide','Player guide')}<span>/</span>${escape(article.category)}</div><header class="guide-document-header">${image(professions.some(p=>p[0]===article.id)?professionIcon(article.id):symbols[article.category]||'rift','guide-header-icon')}<div><p class="eyebrow">${escape(article.category)}</p><h1>${escape(article.title)}</h1><p>${pretty(article.summary)}</p></div></header><div class="guide-document-body">${article.id==='professions'?professionOverview(data,article):sections(article)}</div>${related.length?`<section class="guide-related"><p class="eyebrow">Keep exploring</p><div>${related.map(a=>link('/guide/'+encodeURIComponent(a.id),escape(a.title)+' ↗')).join('')}</div></section>`:''}</article><aside class="guide-toc"><p class="eyebrow">On this page</p>${headings.map((h,i)=>`<a href="#section-${i}">${escape(h)}</a>`).join('')}<button class="guide-top" type="button">Back to top ↑</button></aside></div></div>`;
      main.querySelector('.guide-top').addEventListener('click',()=>window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
      return;
    }
    const q=params.get('q')||'',category=params.get('category')||'';
    const articles=data.articles.filter(a=>(q||!a.id.includes(':')||a.id.startsWith('browse:'))&&(!category||a.category===category)&&(!q||[a.title,a.summary,a.keywords,...a.blocks.map(b=>b.text)].join(' ').toLowerCase().includes(q.toLowerCase())));
    main.innerHTML=`<div class="portal guide-portal"><div class="guide-index-header"><p class="eyebrow">Your next chapter starts here</p><h1>Your guide to Haven.</h1><p>Find your first steps, learn your class, and discover how the world fits together.</p><form id="guide-search" class="guide-search"><label for="guide-query" class="sr-only">Search the player guide</label><input id="guide-query" name="q" placeholder="What would you like to discover?" value="${escape(q)}"><button type="submit">Search ↗</button></form></div><div class="guide-index-layout">${side(data,category)}<section><div class="guide-index-summary"><h2>${escape(category||'Explore the essentials')}</h2><span>${articles.length} guides</span></div><div class="guide-topic-grid">${articles.map(card).join('')||'<div class="guide-callout">No topics match this search. Try a profession, class, or item name.</div>'}</div></section></div></div>`;
    document.getElementById('guide-search').addEventListener('submit',event=>{event.preventDefault();navigate('/guide?'+new URLSearchParams({q:new FormData(event.target).get('q'),category}));});
  }
  window.RiftGuide={render};
})();
