// The point of the boot guard: when the game cannot run, the page must SAY so.
const path=require('path');
const {chromium,devices}=require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
(async()=>{
  const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=swiftshader']});
  const cases=[
    ['WebGL2 unavailable', ()=>{
       const g=HTMLCanvasElement.prototype.getContext;
       HTMLCanvasElement.prototype.getContext=function(t,...a){ return /webgl2/i.test(t)?null:g.call(this,t,...a); };
     }],
    ['WebGL2 getContext throws', ()=>{
       HTMLCanvasElement.prototype.getContext=function(){ throw new Error('GPU process crashed'); };
     }],
    ['a menu section throws', ()=>{
       // break stats() indirectly: make Array.prototype.filter blow up once inside missions
       window.__breakMissions=true;
     }],
  ];
  let fail=0;
  for(const [label,setup] of cases){
    const ctx=await browser.newContext({...devices['Pixel 7'],hasTouch:true,isMobile:true});
    const page=await ctx.newPage();
    await page.addInitScript(setup);
    await page.goto('file://'+path.resolve(process.argv[2]));
    await page.waitForTimeout(2200);
    const r=await page.evaluate(()=>{
      const banner=[...document.querySelectorAll('div')].find(d=>/could not start/i.test(d.textContent||''));
      return { game:!!window.__game, banner:!!banner,
               text:banner?banner.textContent.replace(/\s+/g,' ').slice(0,220):'' };
    });
    const ok = r.game ? true : r.banner;          // either it runs, or it explains itself
    console.log(`\n${label}: ${ok?'handled':'SILENT FAILURE'}`);
    console.log('   game started:',r.game,' banner shown:',r.banner);
    if(r.banner) console.log('   says: '+r.text);
    if(!ok) fail++;
    await ctx.close();
  }
  await browser.close();
  console.log('\n'+(fail?fail+' silent failure(s) remain':'no silent failures'));
  process.exit(fail?1:0);
})();
