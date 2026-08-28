// A person cannot click what is off the side of the screen. Vertical overflow is
// fine (panels scroll), horizontal overflow in a hidden-scrollbar strip is not.
const path=require('path');
const {chromium,devices}=require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
(async()=>{
  const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=swiftshader']});
  const cases=[
    ['phone @412x839',{...devices['Pixel 7'],hasTouch:true,isMobile:true},process.argv[2]],
    ['phone @360x640',{viewport:{width:360,height:640},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:devices['Pixel 7'].userAgent},process.argv[2]],
    ['phone @320x568',{viewport:{width:320,height:568},deviceScaleFactor:2,isMobile:true,hasTouch:true,userAgent:devices['Pixel 7'].userAgent},process.argv[2]],
    ['desktop @1440x900',{viewport:{width:1440,height:900}},process.argv[3]],
    ['desktop @900x600',{viewport:{width:900,height:600}},process.argv[3]],
  ];
  let fail=0;
  for(const [label,opts,url] of cases){
    const ctx=await browser.newContext(opts); const page=await ctx.newPage();
    await page.goto('file://'+path.resolve(url)); await page.waitForTimeout(1000);
    const bad=[];
    for(const tab of ['play','levels','challenge','missions','skins','stats','help','settings']){
      const clipped=await page.evaluate(t=>{
        document.querySelectorAll('#menuTabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
        document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.id==='pane'+t));
        const out=[];
        for(const el of document.querySelectorAll('#ovMenu button, #ovMenu .lv, #ovMenu .skin')){
          const b=el.getBoundingClientRect();
          if(b.width<1||b.height<1) continue;
          if(getComputedStyle(el).display==='none') continue;
          if(b.left<-1||b.right>innerWidth+1)
            out.push((el.dataset.tab||el.id||el.textContent.trim().slice(0,18))+' x:'+Math.round(b.left)+'..'+Math.round(b.right));
        }
        return out;
      },tab);
      clipped.forEach(c=>bad.push('['+tab+'] '+c));
    }
    // also the in-game HUD
    await page.evaluate(()=>{document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show'));window.__game.loadLevel(0);});
    await page.waitForTimeout(900);
    const hud=await page.evaluate(()=>{
      const out=[];
      for(const el of document.querySelectorAll('#hud button, #dpad button, #touchbar button')){
        const b=el.getBoundingClientRect();
        if(b.width<1||getComputedStyle(el).display==='none') continue;
        if(b.left<-1||b.right>innerWidth+1||b.top<-1||b.bottom>innerHeight+1)
          out.push((el.id||el.dataset.d)+' ['+Math.round(b.left)+','+Math.round(b.top)+' '+Math.round(b.right)+','+Math.round(b.bottom)+']');
      }
      return out;
    });
    hud.forEach(h=>bad.push('[in-game] '+h));
    console.log('\n'+label+(bad.length?'  -- '+bad.length+' unreachable':'  -- ok'));
    bad.slice(0,14).forEach(b=>console.log('   '+b));
    if(bad.length) fail++;
    await ctx.close();
  }
  await browser.close();
  process.exit(fail?1:0);
})();
