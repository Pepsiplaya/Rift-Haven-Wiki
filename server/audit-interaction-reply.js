'use strict';
const unavailable=content=>({type:4,data:{content,flags:64,allowed_mentions:{parse:[]}}});
// D1 lookups normally complete quickly. Return their result in the initial Discord
// response rather than relying on an unchecked PATCH after a deferred response.
async function boundedReply(work,ctx,{timeoutMs=1700,log=console.error}={}){
  let timer;
  const pending=Promise.resolve().then(work).catch(()=>{
    log('Private audit lookup failed');
    return unavailable('Audit records are temporarily unavailable. Please try again shortly.');
  });
  const timeout=Symbol('timeout');
  try{
    const reply=await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(()=>resolve(timeout),timeoutMs);})]);
    if(reply!==timeout)return reply;
    ctx.waitUntil(pending.then(()=>{log('Private audit lookup exceeded initial response deadline');}));
    return unavailable('Audit lookup is taking longer than expected. Please try again shortly.');
  }finally{clearTimeout(timer);}
}
module.exports={boundedReply};
