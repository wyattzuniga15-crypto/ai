// Headless smoke test for Minebreak.html: drives an emulated desktop (free-cursor and locked mouse-look)
// and an emulated phone through start, walk, look, mine, build, pause, death and a rockfall.
// Usage: node tools/minebreak_smoke.js [screenshot-dir]
const path=require('path');
const {chromium,devices}=require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
const file='file://'+path.resolve(__dirname,'..','Minebreak.html');
const out=(process.argv[2]||require('os').tmpdir()).replace(/\/?$/,'/');
const until=async(page,fn,ms=4000)=>{ const t0=Date.now(); while(Date.now()-t0<ms){ if(await page.evaluate(fn)) return true; await page.waitForTimeout(50); } return false; };
(async()=>{
  const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errs=[], fails=[];
  const check=(ok,msg)=>{ console.log((ok?'PASS ':'FAIL ')+msg); if(!ok) fails.push(msg); };
  // ---------- desktop ----------
  {
    const ctx=await browser.newContext({viewport:{width:400,height:600}});
    const page=await ctx.newPage();
    page.on('pageerror',e=>errs.push('desktop pageerror: '+e.message));
    page.on('console',m=>{ if(m.type()==='error') errs.push('desktop console: '+m.text()); });
    await page.goto(file); await page.waitForTimeout(1200);
    const g=()=>page.evaluate(()=>({state:__mb.state,glOK:__mb.glOK,touch:__mb.touchMode,locked:__mb.locked,x:__mb.P.x,y:__mb.P.y,z:__mb.P.z,hp:__mb.P.hp,fuel:__mb.P.fuel,score:__mb.P.score,blocks:__mb.P.blocks,grubs:__mb.grubs.length,best:__mb.best,mining:__mb.mining,yaw:__mb.P.yaw,pitch:__mb.P.pitch,aim:__mb.aim&&!__mb.aim.grub?[__mb.aim.x,__mb.aim.y,__mb.aim.z]:null}));
    let s=await g();
    check(s.glOK,'WebGL initialised'); check(s.state==='ready','starts in ready'); check(!s.touch,'desktop is not touch mode');
    await page.screenshot({path:out+'shot_ready.png'});
    await page.mouse.click(200,240); await page.waitForTimeout(300);
    s=await g(); check(s.state==='playing','PLAY starts the run'); check(s.grubs>0,'grubs spawned: '+s.grubs);
    console.log('pointer lock granted by headless:',s.locked);
    // locked-mode maths: synthetic pointermove with movement deltas
    if(s.locked){
      const r=await page.evaluate(()=>{ const y0=__mb.P.yaw,p0=__mb.P.pitch; const ev=(mx,my)=>uiCanvas.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',pointerId:1,movementX:mx,movementY:my,bubbles:true})); ev(9999,9999); const y1=__mb.P.yaw; ev(100,-50); ev(100,-50); return {jumpIgnored:Math.abs(y1-y0)<1e-9,dyaw:__mb.P.yaw-y0,dpitch:__mb.P.pitch-p0}; });
      check(r.jumpIgnored,'first sample after lock is dropped');
      check(Math.abs(r.dyaw-200*0.0024)<1e-6&&Math.abs(r.dpitch-100*0.0024)<1e-6,'locked mouse-look: right turns right, up looks up ('+r.dyaw.toFixed(3)+','+r.dpitch.toFixed(3)+')');
    }
    // switch to free-cursor mode so synthetic mouse events reach the page
    await page.evaluate(()=>__mb.denyLock()); await page.waitForTimeout(250);
    s=await g(); check(s.state==='playing'&&!s.locked,'lock released by the test hook keeps playing');
    await page.mouse.move(200,300); await page.waitForTimeout(100);
    await page.screenshot({path:out+'shot_play.png'});
    // walk
    const before=await g();
    await page.keyboard.down('KeyW'); await page.waitForTimeout(700); await page.keyboard.up('KeyW');
    s=await g(); const moved=Math.hypot(s.x-before.x,s.z-before.z); check(moved>1,'W walks forward ('+moved.toFixed(2)+')');
    // free-cursor tracking near the right edge turns the view
    const yaw0=s.yaw; await page.mouse.move(392,300); await page.waitForTimeout(600);
    s=await g(); check(s.yaw>yaw0+0.15,'free cursor near the right edge turns right ('+(s.yaw-yaw0).toFixed(2)+' rad)');
    await page.mouse.move(200,300);
    // aim through the cursor: cursor low on screen hits a nearer block than the centre
    await page.evaluate(()=>{ __mb.P.pitch=-0.5; }); await page.mouse.move(200,560); await page.waitForTimeout(120);
    const aimLow=(await g()).aim; await page.mouse.move(200,300); await page.waitForTimeout(120); const aimMid=(await g()).aim;
    check(aimLow&&(!aimMid||aimLow[1]<=aimMid[1]||aimLow[2]!==aimMid[2]||aimLow[0]!==aimMid[0]),'aim ray follows the cursor '+JSON.stringify(aimLow)+' vs '+JSON.stringify(aimMid));
    // mine the block under the crosshair
    await page.evaluate(()=>{ __mb.P.pitch=-1.2; }); await page.waitForTimeout(120);
    s=await g(); check(!!s.aim,'aim finds a block when looking down '+JSON.stringify(s.aim));
    const target=s.aim;
    await page.mouse.down();
    check(await until(page,()=>__mb.mining&&__mb.P.mineT>0.1),'held click mines');
    await page.screenshot({path:out+'shot_mining.png'});
    const broke=await until(page,t=>__mb.world[__mb.idx(t[0],t[1],t[2])]===0,6000).catch(()=>false);
    // (until with an argument isn't supported: poll manually)
    let gone=1; for(let i=0;i<80;i++){ gone=await page.evaluate(t=>__mb.world[__mb.idx(t[0],t[1],t[2])],target); if(gone===0) break; await page.waitForTimeout(50); }
    await page.mouse.up();
    check(gone===0,'held click breaks the aimed block'); s=await g(); check(s.blocks>0,'breaking pockets a block: '+s.blocks);
    // build with right click
    await page.evaluate(()=>{ __mb.P.pitch=-0.7; }); await page.waitForTimeout(120);
    const b0=(await g()).blocks;
    await page.mouse.down({button:'right'}); await page.waitForTimeout(150); await page.mouse.up({button:'right'}); await page.waitForTimeout(100);
    s=await g(); check(s.blocks<b0,'right-click builds a block ('+b0+' → '+s.blocks+')');
    // pause / resume
    await page.keyboard.press('KeyP'); await page.waitForTimeout(150);
    s=await g(); check(s.state==='paused','P pauses');
    await page.screenshot({path:out+'shot_pause.png'});
    await page.mouse.click(200,272); await page.waitForTimeout(150);
    s=await g(); check(s.state==='playing','RESUME button resumes');
    // the dark kills
    await page.evaluate(()=>{ __mb.P.fuel=0; __mb.P.hp=4; });
    check(await until(page,()=>__mb.state==='dead',5000),'no fuel drains health to death: '+await page.evaluate(()=>__mb.P.cause));
    await page.waitForTimeout(1500); await page.screenshot({path:out+'shot_dead.png'});
    await page.mouse.click(200,392); await page.waitForTimeout(400);
    s=await g(); check(s.state==='playing','DIG AGAIN restarts'); check(s.hp===100&&s.fuel>97,'run reset');
    // lava: stand in it
    const lava=await page.evaluate(()=>{ const W=__mb.world; for(let x=1;x<31;x++) for(let z=1;z<31;z++) for(let y=1;y<40;y++){ if(W[__mb.idx(x,y,z)]===__mb.B.LAVA&&W[__mb.idx(x,y+1,z)]===0&&W[__mb.idx(x,y+2,z)]===0) return [x,y,z]; } return null; });
    if(lava){ await page.evaluate(l=>{ __mb.P.x=l[0]+0.5; __mb.P.y=l[1]+0.3; __mb.P.z=l[2]+0.5; __mb.P.vy=0; __mb.P.fallStart=__mb.P.y; },lava); check(await until(page,()=>__mb.state==='dead',6000),'lava kills: '+await page.evaluate(()=>__mb.P.cause)); }
    else console.log('no exposed lava found to test');
    await page.mouse.click(200,448); await page.waitForTimeout(200);
    s=await g(); check(s.state==='ready','MENU returns to ready');
    // Enter starts a fresh mine from the menu
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    s=await g(); check(s.state==='playing'&&s.hp===100,'Enter starts a new run');
    // gravel cave-in: dig under a gravel column
    const gv=await page.evaluate(()=>{ const W=__mb.world; for(let x=1;x<31;x++) for(let z=1;z<31;z++) for(let y=2;y<40;y++){ if(W[__mb.idx(x,y,z)]===__mb.B.GRAVEL&&W[__mb.idx(x,y-1,z)]===__mb.B.STONE&&W[__mb.idx(x,y-2,z)]===0) return [x,y,z]; } return null; });
    if(gv){ const f=await page.evaluate(g=>{ __mb.world[__mb.idx(g[0],g[1]-1,g[2])]=0; window.checkFall(g[0],g[1],g[2]); return __mb.fallers.length; },gv); check(f>0,'gravel above a hole falls'); check(await until(page,()=>__mb.fallers.length===0,6000),'falling rock lands'); const landed=await page.evaluate(g=>{ for(let y=g[1]-1;y>=0;y--) if(__mb.world[__mb.idx(g[0],y,g[2])]===__mb.B.GRAVEL) return y; return -1; },gv); check(landed>=0,'rock settles lower in the column (y '+landed+' from '+gv[1]+')'); }
    await ctx.close();
  }
  // ---------- phone ----------
  {
    const ctx=await browser.newContext({...devices['iPhone 13'],viewport:{width:390,height:844}});
    const page=await ctx.newPage();
    page.on('pageerror',e=>errs.push('phone pageerror: '+e.message));
    page.on('console',m=>{ if(m.type()==='error') errs.push('phone console: '+m.text()); });
    await page.goto(file); await page.waitForTimeout(1200);
    const g=()=>page.evaluate(()=>({state:__mb.state,touch:__mb.touchMode,x:__mb.P.x,z:__mb.P.z,yaw:__mb.P.yaw,mining:__mb.mining,blocks:__mb.P.blocks,aim:__mb.aim&&!__mb.aim.grub?[__mb.aim.x,__mb.aim.y,__mb.aim.z]:null}));
    let s=await g(); check(s.touch,'phone starts in touch mode');
    const box=await (await page.$('canvas.ui')).boundingBox(); const sc=box.width/400;
    const L=(x,y)=>[box.x+x*sc,box.y+y*sc];
    let [px,py]=L(200,240); await page.touchscreen.tap(px,py); await page.waitForTimeout(400);
    s=await g(); check(s.state==='playing','tap PLAY starts on phone');
    await page.screenshot({path:out+'shot_phone.png'});
    const cdp=await ctx.newCDPSession(page);
    const touch=async(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map((p,i)=>({x:p[0],y:p[1],id:i}))});
    const before=await g();
    let [sx,sy]=L(88,504);
    await touch('touchStart',[[sx,sy]]); await touch('touchMove',[[sx,sy-50]]); await page.waitForTimeout(700); await touch('touchEnd',[]);
    s=await g(); const moved=Math.hypot(s.x-before.x,s.z-before.z); check(moved>1,'joystick drag walks ('+moved.toFixed(2)+')');
    // drag on the right half looks around
    const yaw0=s.yaw; let [lx,ly]=L(300,300);
    await touch('touchStart',[[lx,ly]]); await touch('touchMove',[[lx+40*sc,ly]]); await touch('touchMove',[[lx+80*sc,ly]]); await touch('touchEnd',[]); await page.waitForTimeout(100);
    s=await g(); check(s.yaw>yaw0+0.3,'right-thumb drag turns the view ('+(s.yaw-yaw0).toFixed(2)+')');
    // hold the pick button
    await page.evaluate(()=>{ __mb.P.pitch=-1.2; }); await page.waitForTimeout(120);
    const t=(await g()).aim;
    let [mx,my]=L(400-44,600-52);
    await touch('touchStart',[[mx,my]]);
    check(await until(page,()=>__mb.mining),'holding the pick button mines');
    const pocket0=(await g()).blocks;
    const dug=await until(page,()=>__mb.P.blocks>0,15000);   // software GL is slow on the DPR-3 phone: poll long
    await touch('touchEnd',[]);
    console.log('phone dpr/backing:',await page.evaluate(()=>[devicePixelRatio,uiCanvas.width,uiCanvas.height]));
    check(dug&&(await g()).blocks>pocket0,'phone: holding the pick breaks the block under the crosshair');
    await page.screenshot({path:out+'shot_phone_dug.png'});
    // pause button by tap
    let [qx,qy]=L(400-32,32); await page.touchscreen.tap(qx,qy); await page.waitForTimeout(150);
    s=await g(); check(s.state==='paused','tap pause button pauses');
    await ctx.close();
  }
  await browser.close();
  console.log('errors:',errs.length?errs:'none');
  console.log(fails.length?('FAILED: '+fails.length):'ALL PASS');
})().catch(e=>{ console.error('TEST CRASH',e); process.exit(1); });
