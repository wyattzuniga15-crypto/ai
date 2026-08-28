const path=require('path');
const {chromium}=require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
(async()=>{
  const file='file://'+path.resolve(process.argv[2]);
  const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=swiftshader']});
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errs=[];
  page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
  page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await page.goto(file);
  await page.waitForTimeout(1200);
  // menu present?
  const menu=await page.evaluate(()=>({
    tabs:[...document.querySelectorAll('#menuTabs button')].map(b=>b.dataset.tab),
    tally:document.getElementById('menuTally').textContent.replace(/\s+/g,' ').trim(),
    missions:document.querySelectorAll('#missionList .mission').length,
    skins:document.querySelectorAll('#paneskins .skin').length,
    levels:document.querySelectorAll('#lvGrid .lv').length,
    hasGame:!!window.__game
  }));
  console.log('menu:',JSON.stringify(menu));
  // click every tab
  for(const t of menu.tabs){ await page.click(`#menuTabs button[data-tab="${t}"]`); await page.waitForTimeout(120); }
  // unlock all and auto-play every level with the solver
  const report=await page.evaluate(async()=>{
    const g=window.__game; const out=[];
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    document.getElementById('setUnlockAll').click();
    g.save().camRel=false;   // screen dirs == world dirs, so the solver's path maps 1:1
    const N=window.LEVELS?window.LEVELS.length:50;
    for(let i=0;i<N;i++){
      document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show'));
      g.loadLevel(i); await sleep(60);
      let guard=0;
      while(!g.won && guard<400){
        if(g.busy){ await sleep(12); continue; }
        guard++;
        const p=g.solve(); if(!p||!p.length) break;
        g.tryMove(p[0]); await sleep(14);
      }
      out.push({i,won:g.won,moves:g.moves});
      await sleep(60);
    }
    return out;
  });
  const failed=report.filter(r=>!r.won);
  console.log('levels played:',report.length,'failed:',failed.length, failed.slice(0,5));
  await page.waitForTimeout(600);
  // Daily challenge and three endless islands, forged and solved in the page
  const extra=await page.evaluate(async()=>{
    const g=window.__game, sleep=ms=>new Promise(r=>setTimeout(r,ms));
    g.save().camRel=false;
    const play=async()=>{ let guard=0;
      while(!g.won && guard++<600){ if(g.busy){ await sleep(10); continue; }
        const p=g.solve(); if(!p||!p.length) break;
        let sd=null; for(const d of ['up','down','left','right']) if(g.camDir(d)===p[0]) sd=d;
        g.tryMove(sd||p[0]); await sleep(12); }
      return g.won; };
    const out={};
    document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show'));
    const t0=Date.now(); g.loadDaily(); out.dailyForgeMs=Date.now()-t0;
    await sleep(120); out.dailyName=g.L?window.__game.curDef().name:null; out.daily=await play();
    await sleep(1100);
    const runs=[];
    for(let i=0;i<3;i++){
      document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show'));
      const s0=Date.now(); g.loadEndless(); await sleep(260);
      runs.push({ms:Date.now()-s0,won:await play()});
      await sleep(1100);
    }
    out.endless=runs; out.streak=g.save().endless.run; out.teachSeen=g.save().seen.length;
    return out;
  });
  console.log('extra:',JSON.stringify(extra));
  const st=await page.evaluate(()=>window.__game.stats());
  console.log('stats after autoplay:',JSON.stringify(st));
  await page.screenshot({path:process.argv[3]||'/tmp/shot.png'});
  if(errs.length) console.log('ERRORS:\n'+errs.slice(0,20).join('\n'));
  await browser.close();
  process.exit(errs.length||failed.length?1:0);
})();
