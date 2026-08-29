// Swipe is now the only way to move on a phone, so it has to hold up to the way
// a thumb actually behaves: slow drags, long drags, and lifting off a pinch.
const path=require('path');
const {chromium,devices}=require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');

const touch = `(function(){
  const cv=document.querySelector('canvas');
  window.__t=(type,id,x,y)=>cv.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',clientX:x,clientY:y,bubbles:true,isPrimary:id===1}));
})()`;

(async()=>{
  const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=swiftshader']});
  const ctx=await browser.newContext({...devices['Pixel 7'],hasTouch:true,isMobile:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('file://'+path.resolve(process.argv[2]));
  await page.waitForTimeout(1300);
  await page.evaluate(()=>{ const s=window.__game.save(); s.teach=false; s.camRel=false; s.unlocked=70; });
  await page.evaluate(()=>{ document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show')); window.__game.loadLevel(24); });
  await page.waitForTimeout(1100);
  await page.evaluate(touch);
  const moves=()=>page.evaluate(()=>window.__game.save().totalMoves);
  const settle=async()=>{ for(let i=0;i<50;i++){ if(!(await page.evaluate(()=>window.__game.busy))) return; await page.waitForTimeout(50); } };
  const results={};

  const swipe=async(dx,dy,steps,gapMs)=>{
    const {cx,cy}=await page.evaluate(()=>({cx:innerWidth/2,cy:innerHeight/2}));
    await page.evaluate(([x,y])=>window.__t('pointerdown',7,x,y),[cx,cy]);
    for(let i=1;i<=steps;i++){
      await page.evaluate(([x,y])=>window.__t('pointermove',7,x,y),[cx+dx*i/steps, cy+dy*i/steps]);
      if(gapMs) await page.waitForTimeout(gapMs);
    }
    await page.evaluate(([x,y])=>window.__t('pointerup',7,x,y),[cx+dx,cy+dy]);
  };

  // a quick flick
  await settle(); let a=await moves();
  await swipe(90,0,3,0); await page.waitForTimeout(400); await settle();
  results.flick = (await moves())-a;

  // the same distance, dragged slowly over ~1.5s — the old code called this "orbit"
  await settle(); a=await moves();
  await swipe(90,0,10,150); await page.waitForTimeout(400); await settle();
  results.slowDrag = (await moves())-a;

  // a short, gentle nudge that never reaches the main threshold
  await settle(); a=await moves();
  await swipe(20,0,4,40); await page.waitForTimeout(400); await settle();
  results.gentleNudge = (await moves())-a;

  // a long, generous drag must still cost exactly one move
  await settle(); a=await moves();
  await swipe(0,300,12,60); await page.waitForTimeout(900); await settle();
  results.longDragRolls = (await moves())-a;

  // a tap must not move anything
  await settle(); a=await moves();
  const c=await page.evaluate(()=>({cx:innerWidth/2,cy:innerHeight/2}));
  await page.evaluate(([x,y])=>{window.__t('pointerdown',8,x,y);window.__t('pointerup',8,x,y);},[c.cx,c.cy]);
  await page.waitForTimeout(400); await settle();
  results.tapDoesNothing = (await moves())-a;

  // two fingers turn the camera and must not roll, including on the way up
  await settle(); a=await moves();
  const th0=await page.evaluate(()=>window.__game.cam().tTheta);
  const d0=await page.evaluate(()=>window.__game.cam().tDist);
  await page.evaluate(([cx,cy])=>{
    window.__t('pointerdown',1,cx-60,cy); window.__t('pointerdown',2,cx+60,cy);
    window.__t('pointermove',1,cx-10,cy-30); window.__t('pointermove',2,cx+170,cy-30);   // midpoint moves sideways
    window.__t('pointerup',1,cx-10,cy-30); window.__t('pointerup',2,cx+170,cy-30);
  },[c.cx,c.cy]);
  await page.waitForTimeout(500); await settle();
  results.twoFingerRolled = (await moves())-a;
  results.twoFingerTurned = Math.abs((await page.evaluate(()=>window.__game.cam().tTheta))-th0)>0.05;
  results.twoFingerZoomed = (await page.evaluate(()=>window.__game.cam().tDist))!==d0;
  results.cameraStillFinite = await page.evaluate(()=>{const c=window.__game.cam();
    return [c.tTheta,c.tPhi,c.tDist,c.theta,c.phi,c.dist].every(v=>isFinite(v));});

  // d-pad: hidden by default, works when switched on
  results.dpadHiddenByDefault = await page.evaluate(()=>{const e=document.getElementById('dpad');const b=e.getBoundingClientRect();return b.width===0;});
  await page.evaluate(()=>{ window.__game.save().dpad=true; document.documentElement.dataset.dpad='on'; });
  await page.waitForTimeout(200);
  await settle(); a=await moves();
  await page.tap('#dpad button[data-d="down"]').catch(e=>results.dpadErr=e.message.split('\n')[0]);
  await page.waitForTimeout(400); await settle();
  results.dpadWorksWhenOn = (await moves())-a;

  await ctx.close(); await browser.close();

  const want={flick:1,slowDrag:1,gentleNudge:1,longDragRolls:1,tapDoesNothing:0,twoFingerRolled:0,
              twoFingerTurned:true,twoFingerZoomed:true,dpadHiddenByDefault:true,dpadWorksWhenOn:1,cameraStillFinite:true};
  const bad=[];
  for(const k of Object.keys(want)){
    const got=results[k], w=want[k];
    const ok = w==='>1' ? got>1 : got===w;
    if(!ok) bad.push(`${k}: expected ${w}, got ${JSON.stringify(got)}`);
  }
  console.log(JSON.stringify(results,null,1));
  errs.forEach(e=>bad.push('pageerror: '+e));
  console.log(bad.length?('\nFAIL\n  '+bad.join('\n  ')):'\nswipe control behaves correctly');
  process.exit(bad.length?1:0);
})();
