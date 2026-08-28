// The page has to survive the conditions a downloaded file actually meets.
const path=require('path');
const {chromium,devices}=require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
const file=f=>'file://'+path.resolve(f);

async function probe(browser,label,url,setup,opts){
  const ctx=await browser.newContext({...(opts||{})});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push('pageerror: '+e.message));
  page.on('console',m=>{ if(m.type()==='error') errs.push('console: '+m.text()); });
  if(setup) await page.addInitScript(setup);
  const t0=Date.now();
  await page.goto(url); 
  // how long until the game is actually usable?
  let ready=-1;
  for(let i=0;i<80;i++){ if(await page.evaluate(()=>!!window.__game).catch(()=>false)){ ready=Date.now()-t0; break; } await page.waitForTimeout(100); }
  const state=await page.evaluate(()=>({
    game:!!window.__game,
    tally:(document.getElementById('menuTally')||{}).textContent||'',
    grid:document.querySelectorAll('#lvGrid .lv').length,
    missions:document.querySelectorAll('#missionList .mission').length,
    skins:document.querySelectorAll('#paneskins .skin').length,
    daily:(document.getElementById('dailyCard')||{}).textContent||'',
    contBtn:(document.getElementById('bContinue')||{}).textContent||'',
  })).catch(e=>({err:String(e)}));
  // does Continue actually start a level?
  let started=false;
  try{ await page.click('#bContinue',{timeout:2500}); await page.waitForTimeout(1200);
       started=await page.evaluate(()=>!!(window.__game&&window.__game.L)); }catch(e){}
  await ctx.close();
  return {label,ready,state,started,errs};
}

(async()=>{
  const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=swiftshader']});
  const url=file(process.argv[2]);
  const phone={...devices['Pixel 7'],hasTouch:true,isMobile:true};
  const cases=[
    ['baseline', null, phone],
    ['localStorage throws on read/write', ()=>{
        const bad={getItem(){throw new Error('SecurityError')},setItem(){throw new Error('SecurityError')},removeItem(){throw new Error('SecurityError')}};
        try{ Object.defineProperty(window,'localStorage',{get(){return bad}}); }catch(e){}
      }, phone],
    ['localStorage getter itself throws', ()=>{
        try{ Object.defineProperty(window,'localStorage',{get(){throw new Error('SecurityError: storage disabled')}}); }catch(e){}
      }, phone],
    ['no AudioContext', ()=>{ delete window.AudioContext; delete window.webkitAudioContext; }, phone],
    ['no matchMedia', ()=>{ try{ Object.defineProperty(window,'matchMedia',{get(){return undefined}}); }catch(e){} }, phone],
    ['corrupt save', ()=>{ try{ localStorage.setItem('cuberoll.v3','{"best":{"0":{"moves":3}},"unlocked":999}'); }catch(e){} }, phone],
    ['save from v2 with no daily/endless', ()=>{ try{ localStorage.setItem('cuberoll.v2','{"best":{"0":{"moves":3,"rating":3}},"unlocked":5,"skin":{"cube":"amber"}}'); }catch(e){} }, phone],
  ];
  let fail=0;
  for(const [label,setup,opts] of cases){
    const r=await probe(browser,label,url,setup,opts);
    const broken = !r.state.game || !r.started || r.errs.length;
    console.log(`\n${label}  -- ${broken?'BROKEN':'ok'}  (ready in ${r.ready}ms)`);
    console.log('   game=%s started=%s grid=%s missions=%s skins=%s', r.state.game,r.started,r.state.grid,r.state.missions,r.state.skins);
    console.log('   continue button text: %j', r.state.contBtn.trim());
    r.errs.slice(0,4).forEach(e=>console.log('   '+e));
    if(broken) fail++;
  }
  await browser.close();
  console.log('\n'+(fail?fail+' hostile condition(s) break the page':'survives every condition'));
})();
