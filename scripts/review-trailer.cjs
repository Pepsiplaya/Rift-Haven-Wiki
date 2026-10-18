/* Exercise media behavior in a real browser before publishing. */
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const output = path.resolve(__dirname, '../../output/trailer/review/website');
  fs.mkdirSync(output, {recursive:true});
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  const base = process.env.TRAILER_REVIEW_URL || 'http://127.0.0.1:8093/';
  const reports=[];
  for (const [label,width,height,reduced] of [['desktop',1440,900,false],['phone',390,844,false],['reduced-motion',1440,900,true]]) {
    const context=await browser.newContext({viewport:{width,height},reducedMotion:reduced?'reduce':'no-preference'});
    const page=await context.newPage();const errors=[],media=[];
    page.on('pageerror', error=>errors.push(error.message));
    page.on('request',request=>{if(request.url().includes('/assets/media/'))media.push(request.url());});
    await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('[data-watch-trailer]').waitFor();
    if (!reduced) await page.waitForFunction(()=>document.querySelector('.hero-film')?.currentTime>0.2);
    const initial=await page.evaluate(()=>{
      const v=document.querySelector('.hero-film'),hero=document.querySelector('.hero').getBoundingClientRect(),header=document.querySelector('.site-header').getBoundingClientRect();
      return {muted:v.muted,paused:v.paused,source:v.querySelector('source')?.src,heroHeight:hero.height,heroBottom:hero.bottom,headerHeight:header.height,viewport:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,fullTrailerLoaded:!!document.querySelector('#trailer-dialog source').getAttribute('src')};
    });
    if(initial.overflow||initial.fullTrailerLoaded||!initial.muted)throw new Error(label+': bad initial media state '+JSON.stringify(initial));
    if(Math.abs(initial.heroBottom-height)>2)throw new Error(label+': hero does not fill viewport '+JSON.stringify(initial));
    if(reduced&&(!initial.paused||initial.source))throw new Error('Reduced motion loaded background');
    await page.screenshot({path:path.join(output,label+'.png')});
    await page.locator('[data-hero-playback]').click();
    if(reduced)await page.waitForFunction(()=>document.querySelector('.hero-film').currentTime>0.2);
    else if(!await page.locator('.hero-film').evaluate(v=>v.paused))throw new Error('Pause button failed');
    await page.locator('[data-watch-trailer]').click();
    await page.waitForFunction(()=>document.querySelector('#trailer-dialog video').currentTime>0.1);
    if(!await page.locator('.hero-film').evaluate(v=>v.paused))throw new Error('Background playing under trailer');
    await page.screenshot({path:path.join(output,label+'-player.png')});
    await page.keyboard.press('Escape');
    if(!await page.locator('#trailer-dialog video').evaluate(v=>v.paused))throw new Error('Trailer audio continued after closing');
    await page.locator('.hero-guide-link').evaluate(a=>a.click());
    await page.waitForFunction(()=>!document.querySelector('.hero-film'));
    await page.locator('.site-header .brand').click();
    await page.locator('[data-watch-trailer]').waitFor();
    if(!reduced)await page.waitForFunction(()=>document.querySelector('.hero-film').currentTime>0.1);
    if(errors.length)throw new Error(label+': '+errors.join('; '));
    reports.push({label,initial,mediaRequests:media.length,errors,controlsPassed:true,navigationPassed:true});
    await context.close();
  }
  await browser.close();fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));
})().catch(error=>{console.error(error);process.exit(1);});

