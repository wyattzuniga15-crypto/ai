// Press every control and assert it had an effect. A button that is reachable
// but inert is still a broken button.
const path=require('path');
const {chromium,devices}=require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');

async function run(browser,opts,url,label,touch){
  const ctx=await browser.newContext(opts); const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push('pageerror: '+e.message));
  page.on('console',m=>{ if(m.type()==='error') errs.push('console: '+m.text()); });
  page.on('dialog',d=>d.dismiss().catch(()=>{}));
  await page.goto('file://'+path.resolve(url)); await page.waitForTimeout(1100);
  const bad=[];
  const hit=async sel=>{ if(touch) await page.tap(sel,{timeout:3000}); else await page.click(sel,{timeout:3000}); };
  const press=async (sel,name,check)=>{
    const before=await page.evaluate(check).catch(()=>null);
    try{ await hit(sel); }catch(e){ bad.push(name+': not clickable — '+e.message.split('\n')[0]); return; }
    await page.waitForTimeout(420);
    const after=await page.evaluate(check).catch(()=>null);
    if(JSON.stringify(before)===JSON.stringify(after)) bad.push(name+': click had no effect ('+JSON.stringify(before)+')');
  };
  const paneOf=()=>document.querySelector('.pane.on')?.id;

  for(const t of ['levels','challenge','missions','skins','stats','help','settings','play'])
    await press(`#menuTabs button[data-tab="${t}"]`,'tab '+t,paneOf);

  await press('#bPlayLevels','Play>Level select',paneOf);
  await press('#menuTabs button[data-tab="play"]','back to play',paneOf);
  await press('#bPlayChallenge','Play>Daily & Endless',paneOf);
  await press('#menuTabs button[data-tab="play"]','back to play 2',paneOf);
  await press('#bPlayMissions','Play>Missions',paneOf);

  // settings toggles
  await page.click('#menuTabs button[data-tab="settings"]'); await page.waitForTimeout(200);
  for(const [id,key] of [['setSound','sound'],['setCamRel','camRel'],['setShake','shake'],['setHintBtn','hintBtn'],['setTeach','teach'],['setMusic','music']]){
    const vis=await page.evaluate(i=>{const e=document.getElementById(i); if(!e) return false; const b=e.getBoundingClientRect(); return b.width>0&&b.height>0;},id);
    if(vis) await press('#'+id,'setting '+id,new Function('return window.__game.save().'+key));
  }
  for(const [id,key] of [['setHaptics','haptics'],['setHand','hand']]){
    const vis=await page.evaluate(i=>{const e=document.getElementById(i); if(!e) return false; const b=e.getBoundingClientRect(); return b.width>0&&b.height>0;},id);
    if(vis) await press('#'+id,'setting '+id,new Function('return window.__game.save().'+key));
  }
  await press('#setUnlockAll','Unlock every level',()=>window.__game.save().unlocked);

  // skins: equip one of each kind that is unlocked
  await page.click('#menuTabs button[data-tab="skins"]'); await page.waitForTimeout(250);
  for(const host of ['skinCube','skinTile','skinSky','skinTrail']){
    const sel=`#${host} .skin:not(.locked):not(.on)`;
    const n=await page.evaluate(s=>document.querySelectorAll(s).length,sel);
    if(n) await press(sel,'equip '+host,()=>JSON.stringify(window.__game.save().skin));
  }

  // level select: start a level from a card
  await page.click('#menuTabs button[data-tab="levels"]'); await page.waitForTimeout(250);
  await press('#lvGrid .lv:not(.locked)','level card',()=>!!window.__game.L);

  // in-game controls
  await page.waitForTimeout(700);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
  for(const [sel,name,check] of [
    ['#bSound','sound button',()=>window.__game.save().sound],
    ['#bHint','hint button',()=>document.getElementById('toast').style.opacity],
    ['#tHint','thumb hint',()=>document.getElementById('toast').style.opacity],
    ['#bUndo','undo button',()=>window.__game.moves],
    ['#tUndo','thumb undo',()=>window.__game.moves],
  ]){
    const vis=await page.evaluate(s=>{const e=document.querySelector(s); if(!e) return false; const b=e.getBoundingClientRect(); return b.width>0&&b.height>0;},sel);
    if(!vis) continue;
    if(name.includes('undo')){ await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500); }
    await press(sel,name,check);
  }
  for(const [sel,name] of [['#bReset','reset button'],['#tReset','thumb reset']]){
    const vis=await page.evaluate(s=>{const e=document.querySelector(s); if(!e) return false; const b=e.getBoundingClientRect(); return b.width>0&&b.height>0;},sel);
    if(!vis) continue;
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
    await press(sel,name,()=>window.__game.moves);
  }
  // d-pad
  const dvis=await page.evaluate(()=>{const e=document.getElementById('dpad'); if(!e) return false; const b=e.getBoundingClientRect(); return b.width>0&&b.height>0;});
  if(dvis) for(const d of ['up','down','left','right'])
    await press(`#dpad button[data-d="${d}"]`,'dpad '+d,()=>window.__game.save().totalMoves);

  await press('#bMenu','menu button',()=>document.getElementById('ovMenu').classList.contains('show'));

  // daily and endless
  await page.click('#menuTabs button[data-tab="challenge"]'); await page.waitForTimeout(250);
  await press('#bDaily','Daily',()=>window.__game.curDef()?.name);
  await page.evaluate(()=>window.__game.openMenu('challenge')); await page.waitForTimeout(400);
  await press('#bEndless','Endless',()=>window.__game.curDef()?.name);

  // win overlay
  await page.evaluate(()=>{document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show'));window.__game.loadLevel(0);});
  await page.waitForTimeout(900);
  await page.evaluate(async()=>{ const g=window.__game,s=ms=>new Promise(r=>setTimeout(r,ms));
    g.save().camRel=false; let n=0;
    while(!g.won&&n++<80){ if(g.busy){await s(20);continue;} const p=g.solve(); if(!p||!p.length)break; g.tryMove(p[0]); await s(30); } });
  await page.waitForTimeout(1600);
  const winShown=await page.evaluate(()=>document.getElementById('ovWin').classList.contains('show'));
  if(!winShown) bad.push('win overlay never appeared');
  else {
    await press('#bNext','win > Next level',()=>window.__game.curDef()?.name);
    await page.evaluate(()=>window.__game.loadLevel(0));
  }
  await ctx.close();
  return {label,bad,errs};
}

(async()=>{
  const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=swiftshader']});
  const cases=[
    ['phone build, tapped @Pixel7',{...devices['Pixel 7'],hasTouch:true,isMobile:true},process.argv[2],true],
    ['phone build, tapped @360',{viewport:{width:360,height:640},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:devices['Pixel 7'].userAgent},process.argv[2],true],
    ['desktop build, clicked @1440',{viewport:{width:1440,height:900}},process.argv[3],false],
    ['auto build, clicked @1440',{viewport:{width:1440,height:900}},process.argv[4],false],
  ];
  let fail=0;
  for(const [label,opts,url,touch] of cases){
    const r=await run(browser,opts,url,label,touch);
    const all=[...r.bad,...r.errs];
    console.log('\n'+label+(all.length?'  -- '+all.length+' PROBLEM(S)':'  -- every control works'));
    all.slice(0,20).forEach(p=>console.log('   '+p));
    if(all.length) fail++;
  }
  await browser.close();
  process.exit(fail?1:0);
})();
