const fs=require('fs');
Object.assign(global, eval(fs.readFileSync(__dirname+'/rules.js','utf8')+";({parseLevel,initialState,cellsOf,roll,tileAt,isSolid,step,key,keyS,solve,solveAllStars,DIRS,DIR_LIST})"));
const {genLevel,growTiles,placeKeys,sprinkleStars,mulberry,firedAt,countEvents}=require('./gen.js');
const F=(t,n)=>({t,n}); const SB=(idx,hard,group,span)=>({t:'switchbridge',idx,hard,group,span});
const out=JSON.parse(fs.readFileSync(__dirname+'/newlevels2.json','utf8'));

// only the spring-themed islands: a pad has to actually fire on the optimal route
const JOBS=[
 {k:0,  n:'Launch Pad',   h:"A spring throws you three tiles on, straight over the gap.",       t:15, J:2, base:[], size:[10,8,48], stars:2},
 {k:2,  n:'Long Jump',    h:'Two springs in a row cover nine tiles in two moves.',              t:18, J:3, base:[], size:[11,8,54], stars:2},
 {k:4,  n:'Spring Loaded',h:'Springs fire you over ground that would have crumbled anyway.',    t:21, J:2, base:[F('crumble',5)], size:[11,9,58], stars:3},
 {k:6,  n:'Catapult',     h:'A spring can fire you straight into a portal. Chain them.',        t:23, J:2, base:[F('port',2)], size:[12,9,60], stars:3},
 {k:8,  n:'Overshoot',    h:'Springs do not care what they land you on. Glass included.',       t:25, J:2, base:[F('fragile',4)], size:[12,9,62], stars:3},
 {k:10, n:'Clockwork',    h:'Springs and switches: the bridge has to be up before you fire.',   t:28, J:2, base:[SB(0,false,'a',3)], size:[13,9,66], stars:3},
 {k:12, n:'Vaulting',     h:'Ice into a spring. You will not get to choose when it fires.',     t:30, J:2, ice:3, base:[], size:[13,10,68], stars:4},
 {k:14, n:'Escapement',   h:'Portals, springs and ground that will not survive a second visit.',t:32, J:2, base:[F('port',2),F('crumble',5)], size:[13,10,70], stars:4},
 {k:16, n:'Trebuchet',    h:'Springs over a pin field, with ice to set up the shot.',           t:35, J:2, ice:3, base:[F('pin',4)], size:[14,10,74], stars:4},
 {k:18, n:'The Works',    h:'Springs, gates, switches and one very long way round.',            t:38, J:2, K:1, LK:1, base:[SB(0,false,'a',3),F('crumble',5)], size:[15,10,80], stars:4},
 {k:19, n:'Terminus',     h:'The last island. It has kept every trick for you.', lock:true,     t:44, J:2, K:2, LK:2, ice:3, base:[SB(0,false,'a',3),F('crumble',5),F('port',2)], size:[15,11,88], stars:3, pads:1},
];

for(const p of JOBS){
  const [w,h,steps]=p.size;
  let best=null;
  for(const relaxJ of [false,true]){
    if(best) break;
    const cfg={w,h,steps,minSpan:8,minPar:Math.max(8,p.t-10),maxPar:p.t+12,attempts:60,noise:.05,relax:2,targetPar:Math.max(8,p.t-7),feat:p.base};
    const t0=Date.now();
    for(let s=0;s<9000 && Date.now()-t0<95000;s++){
      let g=null; try{ g=genLevel(500000+p.k*971+s*31,cfg); }catch(e){ continue; }
      if(!g) continue;
      let def=g.def;
      if(p.ice){ const r=growTiles(def,'^',p.ice,mulberry(p.k*13+s),{maxPar:p.t+16}); if(r.placed<p.ice) continue; def=r.def; }
      const want=relaxJ?1:p.J;
      const r=growTiles(def,'J',want,mulberry(p.k*29+s+3),{maxPar:p.t+16,mustFire:'launch'});
      if(r.placed<want) continue; def=r.def;
      if(p.LK){ const l=growTiles(def,'L',p.LK,mulberry(p.k*37+s+7),{maxPar:p.t+16,critical:true}); if(l.placed<p.LK) continue; def=l.def;
                const kk=placeKeys(def,p.K,mulberry(p.k*53+s+11),{maxPar:p.t+18,wantPar:p.t}); if(kk.placed<p.K) continue; def=kk.def; }
      if(p.lock) def=Object.assign({},def,{lockGoal:true});
      const withStars=sprinkleStars(def,p.stars,mulberry(p.k*71+s+13),{pads:p.pads||0});
      let L,optp; try{ L=parseLevel(withStars); optp=solve(L); }catch(e){ continue; }
      if(!optp) continue;
      // stars can reroute the optimum, so re-confirm the springs still fire
      const fires=countEvents(L,optp,'launch');
      if(fires<want) continue;
      if(L.stars.length&&!solveAllStars(L)) continue;
      const score=-Math.abs(optp.length-p.t)*3 + fires*6 + L.stars.length*2;
      if(!best||score>best.score) best={score,def:withStars,opt:optp.length,ns:L.stars.length,fires};
      if(Math.abs(best.opt-p.t)<=3 && best.fires>=p.J) break;
    }
  }
  if(!best){ console.error('FAILED '+p.n+' (keeping old)'); continue; }
  const lv={name:p.n,hint:p.h,par:best.opt+Math.floor(best.opt/12),map:best.def.map};
  if(best.def.links) lv.links=best.def.links;
  if(p.lock) lv.lockGoal=true;
  out[p.k]=lv;
  const flat=lv.map.join(''),c=ch=>flat.split(ch).length-1;
  console.error(`${51+p.k} ${p.n.padEnd(14)} par=${lv.par} fires=${best.fires} J${c('J')} K${c('K')} L${c('L')} ice${c('^')} ★${best.ns}`);
}
fs.writeFileSync(__dirname+'/newlevels2.json',JSON.stringify(out));
console.error('saved '+out.length);
