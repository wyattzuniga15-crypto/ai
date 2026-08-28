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
    const N=window.LEVELS?window.LEVELS.length:50;
    for(let i=0;i<N;i++){
      document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show'));
      g.loadLevel(i); await sleep(60);
      let guard=0;
      while(!g.won && guard++<400){
        if(g.busy){ await sleep(12); continue; }
        const p=g.solve(); if(!p||!p.length) break;
        // solver returns world dirs; undo camera mapping by testing all 4 screen dirs
        let sd=null; for(const d of ['up','down','left','right']) if(g.camDir(d)===p[0]) sd=d;
        g.tryMove(sd||p[0]); await sleep(14);
      }
      out.push({i,won:g.won,moves:g.moves});
      if(!g.won) break;
      await sleep(60);
    }
    return out;
  });
  const failed=report.filter(r=>!r.won);
  console.log('levels played:',report.length,'failed:',failed.length, failed.slice(0,5));
  await page.waitForTimeout(600);
  const st=await page.evaluate(()=>window.__game.stats());
  console.log('stats after autoplay:',JSON.stringify(st));
  await page.screenshot({path:process.argv[3]||'/tmp/shot.png'});
  if(errs.length) console.log('ERRORS:\n'+errs.slice(0,20).join('\n'));
  await browser.close();
  process.exit(errs.length||failed.length?1:0);
})();
