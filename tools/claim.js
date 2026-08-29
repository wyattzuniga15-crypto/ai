// A swipe on the board must be consumed by the game, not left for the host to
// act on. A swipe in the menu must still scroll it.
const path=require('path');
const {chromium,devices}=require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
(async()=>{
  const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=swiftshader']});
  const ctx=await browser.newContext({...devices['Pixel 7'],hasTouch:true,isMobile:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('file://'+path.resolve(process.argv[2]));
  await page.waitForTimeout(1300);
  const bad=[];

  // menu first: the panel must still be scrollable by touch
  const menuScroll=await page.evaluate(()=>{
    const p=document.querySelector('#ovMenu .panel');
    return {touchAction:getComputedStyle(p).touchAction, scrollable:p.scrollHeight>p.clientHeight};
  });
  if(!/pan-y|auto/.test(menuScroll.touchAction)) bad.push('menu panel touch-action blocks scrolling: '+menuScroll.touchAction);

  await page.evaluate(()=>{ const s=window.__game.save(); s.teach=false; s.camRel=false;
    document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show')); window.__game.loadLevel(24); });
  await page.waitForTimeout(1000);

  // does a touch on the board get consumed?
  const consumed=await page.evaluate(()=>{
    const cv=document.querySelector('canvas');
    const mk=(t,x,y)=>{ const tt=[new Touch({identifier:1,target:cv,clientX:x,clientY:y})];
      return new TouchEvent(t,{cancelable:true,bubbles:true,touches:tt,targetTouches:tt,changedTouches:tt}); };
    const cx=innerWidth/2, cy=innerHeight/2;
    const down=mk('touchstart',cx,cy); cv.dispatchEvent(down);
    const move=mk('touchmove',cx,cy+90); cv.dispatchEvent(move);
    return {start:down.defaultPrevented, move:move.defaultPrevented,
            canvasTouchAction:getComputedStyle(cv).touchAction,
            rootTouchAction:getComputedStyle(document.documentElement).touchAction};
  });
  if(!consumed.start) bad.push('touchstart on the board was left for the host to act on');
  if(!consumed.move)  bad.push('touchmove on the board was left for the host to act on');
  if(consumed.canvasTouchAction!=='none') bad.push('canvas touch-action is '+consumed.canvasTouchAction);

  // and swiping still rolls, in every direction
  const dirs={};
  for(const [name,dx,dy] of [['down',0,90],['up',0,-90],['left',-90,0],['right',90,0]]){
    for(let i=0;i<40;i++){ if(!(await page.evaluate(()=>window.__game.busy))) break; await page.waitForTimeout(50); }
    const a=await page.evaluate(()=>window.__game.save().totalMoves);
    await page.evaluate(([dx,dy])=>{
      const cv=document.querySelector('canvas'); const cx=innerWidth/2, cy=innerHeight/2;
      const ev=(t,x,y)=>cv.dispatchEvent(new PointerEvent(t,{pointerId:5,pointerType:'touch',clientX:x,clientY:y,bubbles:true,isPrimary:true}));
      ev('pointerdown',cx,cy); ev('pointermove',cx+dx*0.6,cy+dy*0.6); ev('pointermove',cx+dx,cy+dy); ev('pointerup',cx+dx,cy+dy);
    },[dx,dy]);
    await page.waitForTimeout(500);
    dirs[name]=(await page.evaluate(()=>window.__game.save().totalMoves))-a;
    if(dirs[name]!==1) bad.push('swipe '+name+' produced '+dirs[name]+' moves, expected 1');
  }

  await ctx.close(); await browser.close();
  console.log('board consumes touches:',JSON.stringify(consumed));
  console.log('menu panel:',JSON.stringify(menuScroll));
  console.log('swipes per direction:',JSON.stringify(dirs));
  errs.forEach(e=>bad.push('pageerror: '+e));
  console.log(bad.length?('\nFAIL\n  '+bad.join('\n  ')):'\nthe board owns its gestures; the menu still scrolls');
  process.exit(bad.length?1:0);
})();
