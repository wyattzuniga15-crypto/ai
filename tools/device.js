// Layout + input checks on an emulated phone and an emulated desktop.
const path=require('path');
const {chromium,devices}=require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
const file=f=>'file://'+path.resolve(f);

// Synthetic input is delivered asynchronously and software GL is slow, so wait
// for the effect rather than guessing how long it takes.
const until=async (page,fn,ms=2500)=>{ const t0=Date.now(); while(Date.now()-t0<ms){ if(await page.evaluate(fn)) return true; await page.waitForTimeout(60); } return false; };
const settle=async page=>{ for(let i=0;i<60;i++){ if(!(await page.evaluate(()=>window.__game.busy))) return; await page.waitForTimeout(50); } };
async function run(browser,ctxOpts,url,label,expectPlatform,shots){
  const ctx=await browser.newContext(ctxOpts);
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(label+': '+e.message));
  page.on('console',m=>{ if(m.type()==='error') errs.push(label+' console: '+m.text()); });
  await page.goto(url); await page.waitForTimeout(1100);
  const info=await page.evaluate(()=>{
    const r=el=>{ const b=el.getBoundingClientRect(); return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}; };
    const vis=id=>{ const el=document.getElementById(id); return el?getComputedStyle(el).display!=='none':false; };
    return {
      platform:document.documentElement.dataset.platform,
      build:document.documentElement.dataset.build,
      dpad:vis('dpad'), touchbar:vis('touchbar'), deskHelp:vis('deskHelp'),
      pixelRatio:window.__game.renderInfo().pixelRatio, shadow:window.__game.renderInfo().shadow,
      panel:r(document.querySelector('#ovMenu .panel')),
      vw:innerWidth, vh:innerHeight,
      phoneRows:document.querySelectorAll('.phoneOnly').length,
      phoneRowsVisible:[...document.querySelectorAll('.phoneOnly')].filter(e=>getComputedStyle(e).display!=='none').length,
    };
  });
  // no horizontal overflow anywhere in the menu
  const overflow=await page.evaluate(()=>{
    const p=document.querySelector('#ovMenu .panel');
    const tabs=[...document.querySelectorAll('#menuTabs button')].map(b=>b.dataset.tab);
    const bad=[];
    for(const t of tabs){
      document.querySelectorAll('#menuTabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
      document.querySelectorAll('.pane').forEach(x=>x.classList.toggle('on',x.id==='pane'+t));
      if(p.scrollWidth>p.clientWidth+2) bad.push(t+' +'+(p.scrollWidth-p.clientWidth));
      if(document.documentElement.scrollWidth>innerWidth+2) bad.push(t+' doc-overflow');
    }
    return bad;
  });
  await page.screenshot({path:shots});
  await page.waitForTimeout(450);   // let any resize-triggered reframe settle before measuring input
  // start a level and drive it with the platform's own input
  const play=await page.evaluate(async()=>{
    const g=window.__game, sleep=ms=>new Promise(r=>setTimeout(r,ms));
    document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show'));
    g.save().camRel=false; g.loadLevel(0); await sleep(700);
    return {loaded:!!g.L, dist:Math.round(g.cam().tDist)};
  });
  const cv=await page.$('canvas');
  const box=await cv.boundingBox();
  const cx=box.x+box.width/2, cy=box.y+box.height/2;
  let gestures={};
  if(expectPlatform==='phone'){
    await settle(page);
    const before=await page.evaluate(()=>window.__game.cam().tDist);
    // pinch out with two fingers -> zoom in
    await page.touchscreen.tap(cx,cy).catch(()=>{});
    await page.evaluate(({cx,cy})=>{
      const cv=document.querySelector('canvas');
      const send=(type,pts)=>pts.forEach(p=>cv.dispatchEvent(new PointerEvent(type,{pointerId:p.id,pointerType:'touch',clientX:p.x,clientY:p.y,bubbles:true,isPrimary:p.id===1})));
      send('pointerdown',[{id:1,x:cx-40,y:cy},{id:2,x:cx+40,y:cy}]);
      send('pointermove',[{id:1,x:cx-140,y:cy},{id:2,x:cx+140,y:cy}]);
      send('pointerup',[{id:1,x:cx-140,y:cy},{id:2,x:cx+140,y:cy}]);
    },{cx,cy});
    await until(page,`window.__game.cam().tDist < ${before} - 0.5`);
    const after=await page.evaluate(()=>window.__game.cam().tDist);
    gestures.pinchZoomedIn = after < before - 0.5; gestures._zoom=before.toFixed(2)+'->'+after.toFixed(2);
    // quick flick -> a move
    await settle(page);
    const m0=await page.evaluate(()=>window.__game.save().totalMoves);
    await page.evaluate(({cx,cy})=>{
      const cv=document.querySelector('canvas');
      const ev=(type,x,y)=>cv.dispatchEvent(new PointerEvent(type,{pointerId:9,pointerType:'touch',clientX:x,clientY:y,bubbles:true,isPrimary:true}));
      ev('pointerdown',cx,cy); ev('pointermove',cx+50,cy); ev('pointermove',cx+95,cy); ev('pointerup',cx+95,cy);
    },{cx,cy});
    await until(page,`window.__game.save().totalMoves > ${'${m0}'}`.replace('${m0}',m0)); await settle(page);
    const m0b=await page.evaluate(()=>window.__game.save().totalMoves);
    gestures.swipeMoved = m0b > m0; gestures._swipe=m0+'->'+m0b;
    // the d-pad is opt-in now; swiping the island is the control
    gestures.dpadOffByDefault = await page.evaluate(()=>document.getElementById('dpad').getBoundingClientRect().width===0);
  } else {
    const th0=await page.evaluate(()=>window.__game.cam().tTheta);
    await page.mouse.move(cx,cy); await page.mouse.down(); await page.mouse.move(cx+120,cy,{steps:6}); await page.mouse.up();
    gestures.mouseOrbited = await until(page,`Math.abs(window.__game.cam().tTheta - (${th0})) > 0.1`);
    await page.mouse.move(cx,cy);
    const d0=await page.evaluate(()=>window.__game.cam().tDist);
    await page.mouse.wheel(0,-300);
    gestures.wheelZoomed = await until(page,`window.__game.cam().tDist !== ${d0}`);
    const d1=await page.evaluate(()=>window.__game.cam().tDist);
    gestures._wheel=d0.toFixed(2)+'->'+d1.toFixed(2);
    const m0=await page.evaluate(()=>window.__game.save().totalMoves);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
    gestures.keyMoved = (await page.evaluate(()=>window.__game.save().totalMoves)) > m0;
    await page.keyboard.press('?');
    gestures.shortcutSheet = await until(page,"document.getElementById('ovKeys').classList.contains('show')");
  }
  await ctx.close();
  return {label,info,overflow,play,gestures,errs};
}

(async()=>{
  const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=swiftshader']});
  const results=[];
  const phoneCtx={...devices['Pixel 7'],hasTouch:true,isMobile:true};
  const smallPhone={viewport:{width:360,height:640},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:devices['Pixel 7'].userAgent};
  const desk={viewport:{width:1440,height:900},deviceScaleFactor:2};
  results.push(await run(browser,phoneCtx,file(process.argv[2]),'phone-build @Pixel7','phone',process.argv[5]+'/dev-phone.png'));
  results.push(await run(browser,smallPhone,file(process.argv[2]),'phone-build @360x640','phone',process.argv[5]+'/dev-phone-small.png'));
  results.push(await run(browser,desk,file(process.argv[3]),'desktop-build @1440','desktop',process.argv[5]+'/dev-desktop.png'));
  results.push(await run(browser,phoneCtx,file(process.argv[4]),'auto-build @Pixel7','phone',process.argv[5]+'/dev-auto-phone.png'));
  results.push(await run(browser,desk,file(process.argv[4]),'auto-build @1440','desktop',process.argv[5]+'/dev-auto-desktop.png'));
  await browser.close();
  let fail=0;
  for(const r of results){
    const g=Object.entries(r.gestures).filter(([k,v])=>!k.startsWith('_')&&!v).map(([k])=>k);
    const bad=[...r.errs, ...(r.overflow.length?['overflow: '+r.overflow.join(', ')]:[]), ...(g.length?['gesture failed: '+g.join(', ')]:[])];
    console.log(`\n${r.label}`);
    console.log('  platform=%s build=%s dpad=%s touchbar=%s deskHelp=%s dpr=%s shadow=%s phoneRows=%d/%d',
      r.info.platform,r.info.build,r.info.dpad,r.info.touchbar,r.info.deskHelp,r.info.pixelRatio,r.info.shadow,r.info.phoneRowsVisible,r.info.phoneRows);
    console.log('  viewport=%dx%d panel=%dx%d camDist=%s', r.info.vw,r.info.vh,r.info.panel.w,r.info.panel.h,r.play.dist);
    console.log('  gestures:',JSON.stringify(r.gestures));
    if(bad.length){ fail++; console.log('  PROBLEMS:'); bad.forEach(b=>console.log('    - '+b)); }
  }
  console.log('\n'+(fail?fail+' context(s) with problems':'all contexts clean'));
  process.exit(fail?1:0);
})();
