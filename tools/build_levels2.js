const fs=require('fs');
Object.assign(global, eval(fs.readFileSync(__dirname+'/rules.js','utf8')+";({parseLevel,initialState,cellsOf,roll,tileAt,isSolid,step,key,keyS,solve,solveAllStars,DIRS,DIR_LIST})"));
const {genLevel,growTiles,placeKeys,sprinkleStars,mulberry}=require('./gen.js');
const F=(t,n)=>({t,n});
const SB=(idx,hard,group,span)=>({t:'switchbridge',idx,hard,group,span});

// name, hint, base features, then how many launch pads / locks / keys / stars to grow on top
const PLAN=[
 {n:'Launch Pad',   h:'A spring throws you three tiles on, straight over the gap.',       t:15, J:2, base:[], size:[10,8,48], stars:2},
 {n:'Lock and Key', h:'The red gate is solid air until you are holding every key.',       t:16, K:1, LK:1, base:[], size:[10,8,50], stars:2},
 {n:'Long Jump',    h:'Two springs in a row cover nine tiles in two moves.',              t:17, J:3, base:[], size:[11,8,54], stars:2},
 {n:'Keyring',      h:'Two keys, one gate. Neither key is on the way to the other.',      t:19, K:2, LK:1, base:[], size:[11,9,56], stars:2},
 {n:'Spring Loaded',h:'Springs fire you over ground that would have crumbled anyway.',    t:20, J:2, base:[F('crumble',5)], size:[11,9,58], stars:3},
 {n:'Cold Storage', h:'Ice carries you; the gate decides where you are allowed to stop.', t:21, K:1, LK:1, base:[F('ice',3)], ice:3, size:[11,9,58], stars:3},
 {n:'Catapult',     h:'A spring can fire you straight into a portal. Chain them.',        t:22, J:2, base:[F('port',2)], size:[12,9,60], stars:3},
 {n:'Deadbolt',     h:'A bridge to reach the key, a key to open the gate.',               t:24, K:1, LK:1, base:[SB(0,false,'a',3)], size:[12,9,62], stars:3},
 {n:'Overshoot',    h:'Springs do not care what they land you on. Glass included.',       t:24, J:3, base:[F('fragile',4)], size:[12,9,62], stars:3},
 {n:'Strongroom',   h:'Every key, then every star, then the door.', lock:true,            t:26, K:2, LK:1, base:[], size:[12,9,62], stars:3, pads:2},
 {n:'Clockwork',    h:'Springs and switches. The bridge is only up while you are airborne.',t:27,J:2, base:[SB(0,false,'a',3)], size:[13,9,66], stars:3},
 {n:'Keystone',     h:'Pins hold you standing. The gate will not.',                       t:28, K:2, LK:2, base:[F('pin',4)], size:[13,10,68], stars:3},
 {n:'Vaulting',     h:'Ice into a spring. You will not get to choose when it fires.',     t:29, J:2, base:[F('ice',3)], ice:3, size:[13,10,68], stars:4},
 {n:'Tumblers',     h:'Glass, crumble and a locked gate. Take the key on the first pass.',t:30, K:2, LK:1, base:[F('fragile',3),F('crumble',5)], size:[13,10,70], stars:4},
 {n:'Escapement',   h:'Portals, springs and ground that will not survive a second visit.',t:31, J:2, base:[F('port',2),F('crumble',5)], size:[13,10,70], stars:4},
 {n:'The Warden',   h:'Two bridges guard the key. The key guards the way home.',          t:33, K:1, LK:2, base:[SB(0,false,'a',3),SB(1,true,'b',3)], size:[14,10,74], stars:4},
 {n:'Trebuchet',    h:'Springs over a pin field, with ice to set up the shot.',           t:34, J:3, base:[F('pin',4),F('ice',3)], ice:3, size:[14,10,74], stars:4},
 {n:'Lockdown',     h:'Keys behind glass, gates behind portals.',                         t:36, K:2, LK:2, base:[F('fragile',4),F('port',2)], size:[14,10,76], stars:4},
 {n:'The Works',    h:'Springs, gates, switches and one very long way round.',            t:38, J:2, K:1, LK:1, base:[SB(0,false,'a',3),F('crumble',5)], size:[15,10,80], stars:4},
 {n:'Terminus',     h:'The last island. It has kept every trick for you.', lock:true,     t:44, J:2, K:2, LK:2, base:[SB(0,false,'a',3),F('ice',3),F('crumble',5),F('port',2)], ice:3, size:[15,11,88], stars:3, pads:1},
];

const out=[];
for(let i=0;i<PLAN.length;i++){
  const p=PLAN[i];
  const [w,h,steps]=p.size;
  const cfg={w,h,steps,minSpan:Math.min(10,4+Math.floor(i/3)),minPar:Math.max(8,p.t-9),maxPar:p.t+10,attempts:60,noise:.05,relax:2,targetPar:Math.max(8,p.t-6),feat:p.base};
  let best=null; const t0=Date.now();
  for(let s=0;s<6000 && Date.now()-t0<70000;s++){
    let g=null; try{ g=genLevel(120000+i*641+s*23,cfg); }catch(e){ continue; }
    if(!g) continue;
    let def=g.def;
    if(p.ice){ const r=growTiles(def,'^',p.ice,mulberry(i*13+s),{maxPar:p.t+14}); if(r.placed<p.ice) continue; def=r.def; }
    if(p.J){ const r=growTiles(def,'J',p.J,mulberry(i*29+s+3),{maxPar:p.t+14}); if(r.placed<p.J) continue; def=r.def; }
    if(p.LK){ const r=growTiles(def,'L',p.LK,mulberry(i*37+s+7),{maxPar:p.t+14,critical:true}); if(r.placed<p.LK) continue; def=r.def;
              const k=placeKeys(def,p.K||1,mulberry(i*53+s+11),{maxPar:p.t+16,wantPar:p.t}); if(k.placed<(p.K||1)) continue; def=k.def; }
    if(p.lock) def=Object.assign({},def,{lockGoal:true});
    def=sprinkleStars(def,p.stars,mulberry(i*71+s+13),{pads:p.pads||0});
    let L,opt,sp;
    try{ L=parseLevel(def); opt=solve(L); }catch(e){ continue; }
    if(!opt) continue;
    sp=L.stars.length?solveAllStars(L):opt; if(!sp) continue;
    const score=-Math.abs(opt.length-p.t)*3 + L.stars.length*3 + (p.J||0)*3 + (p.LK||0)*3 + (p.ice||0)*2;
    if(!best||score>best.score) best={score,def,opt:opt.length,ns:L.stars.length};
    if(Math.abs(best.opt-p.t)<=2) break;
  }
  if(!best){ console.error('FAILED '+p.n); continue; }
  const lv={name:p.n,hint:p.h,par:best.opt+Math.floor(best.opt/12),map:best.def.map};
  if(best.def.links) lv.links=best.def.links;
  if(p.lock) lv.lockGoal=true;
  out.push(lv);
  const flat=best.def.map.join(''), c=ch=>flat.split(ch).length-1;
  console.error(`${51+i} ${p.n.padEnd(14)} par=${lv.par} (target ${p.t}) J${c('J')} K${c('K')} L${c('L')} ice${c('^')} ★${best.ns}`);
}
fs.writeFileSync(__dirname+'/newlevels2.json',JSON.stringify(out));
console.error('written '+out.length);
