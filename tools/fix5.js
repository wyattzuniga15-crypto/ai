const fs=require('fs');
Object.assign(global, eval(fs.readFileSync(__dirname+'/rules.js','utf8')+";({parseLevel,initialState,cellsOf,roll,tileAt,isSolid,step,key,keyS,solve,solveAllStars,DIRS,DIR_LIST})"));
const {genLevel,growTiles,placeKeys,sprinkleStars,mulberry,countEvents}=require('./gen.js');
const F=(t,n)=>({t,n}); const SB=(idx,hard,group,span)=>({t:'switchbridge',idx,hard,group,span});
const out=JSON.parse(fs.readFileSync(__dirname+'/newlevels2.json','utf8'));

// keep the last chapter climbing: these three sit below the island before them
const JOBS=[
 {k:6,  n:'Catapult',   h:'A spring can fire you straight into a portal. Chain them.', t:24, min:22, J:2, base:[F('port',2)], size:[12,9,62], stars:3},
 {k:14, n:'Escapement', h:'Portals, springs and ground that will not survive a second visit.', t:33, min:32, J:2, base:[F('port',2),F('crumble',5)], size:[13,10,72], stars:4},
 {k:19, n:'Terminus',   h:'The last island. It has kept every trick for you.', lock:true, t:45, min:42, J:2, K:2, LK:2, ice:3,
   base:[SB(0,false,'a',3),F('crumble',5),F('port',2)], size:[15,11,92], stars:3, pads:1},
];
for(const p of JOBS){
  const [w,h,steps]=p.size;
  let best=null; const t0=Date.now();
  const cfg={w,h,steps,minSpan:9,minPar:p.min-6,maxPar:p.t+14,attempts:70,noise:.05,relax:2,targetPar:p.t-4,feat:p.base};
  for(let s=0;s<12000 && Date.now()-t0<150000;s++){
    let g=null; try{ g=genLevel(900000+p.k*1013+s*37,cfg); }catch(e){ continue; }
    if(!g) continue;
    let def=g.def;
    if(p.ice){ const r=growTiles(def,'^',p.ice,mulberry(p.k*13+s),{maxPar:p.t+18}); if(r.placed<p.ice) continue; def=r.def; }
    const r=growTiles(def,'J',p.J,mulberry(p.k*29+s+3),{maxPar:p.t+18,mustFire:'launch'});
    if(r.placed<p.J) continue; def=r.def;
    if(p.LK){ const l=growTiles(def,'L',p.LK,mulberry(p.k*37+s+7),{maxPar:p.t+18,critical:true}); if(l.placed<p.LK) continue; def=l.def;
              const kk=placeKeys(def,p.K,mulberry(p.k*53+s+11),{maxPar:p.t+20,wantPar:p.t}); if(kk.placed<p.K) continue; def=kk.def; }
    if(p.lock) def=Object.assign({},def,{lockGoal:true});
    const ws=sprinkleStars(def,p.stars,mulberry(p.k*71+s+13),{pads:p.pads||0});
    let L,optp; try{ L=parseLevel(ws); optp=solve(L); }catch(e){ continue; }
    if(!optp||optp.length<p.min) continue;
    if(countEvents(L,optp,'launch')<p.J) continue;
    if(L.stars.length&&!solveAllStars(L)) continue;
    const score=-Math.abs(optp.length-p.t)*3+L.stars.length*2;
    if(!best||score>best.score) best={score,def:ws,opt:optp.length,ns:L.stars.length};
    if(Math.abs(best.opt-p.t)<=3) break;
  }
  if(!best){ console.error('FAILED '+p.n+' (keeping old)'); continue; }
  const lv={name:p.n,hint:p.h,par:best.opt+Math.floor(best.opt/12),map:best.def.map};
  if(best.def.links) lv.links=best.def.links;
  if(p.lock) lv.lockGoal=true;
  out[p.k]=lv;
  const flat=lv.map.join(''),c=ch=>flat.split(ch).length-1;
  console.error(`${51+p.k} ${p.n.padEnd(12)} par=${lv.par} J${c('J')} K${c('K')} L${c('L')} ice${c('^')} O${c('O')} T${c('T')} ★${best.ns}${p.lock?' LOCK':''}`);
}
fs.writeFileSync(__dirname+'/newlevels2.json',JSON.stringify(out));
console.error('saved');
