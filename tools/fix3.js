const fs=require('fs');
Object.assign(global, eval(fs.readFileSync(__dirname+'/rules.js','utf8')+";({parseLevel,initialState,cellsOf,roll,tileAt,isSolid,step,key,keyS,solve,solveAllStars,DIRS,DIR_LIST})"));
const {genLevel,growTiles,placeKeys,sprinkleStars,mulberry}=require('./gen.js');
const F=(t,n)=>({t,n}); const SB=(idx,hard,group,span)=>({t:'switchbridge',idx,hard,group,span});
const out=JSON.parse(fs.readFileSync(__dirname+'/newlevels2.json','utf8'));
// Terminus: the finale. Try progressively lighter feature sets until one lands.
const TRIES=[
 {J:2,K:2,LK:2,ice:3,lock:true,base:[SB(0,false,'a',3),F('crumble',5),F('port',2)]},
 {J:2,K:1,LK:1,ice:3,lock:true,base:[SB(0,false,'a',3),F('crumble',5),F('port',2)]},
 {J:2,K:1,LK:1,ice:0,lock:true,base:[SB(0,false,'a',3),F('crumble',5),F('port',2)]},
 {J:2,K:1,LK:1,ice:0,lock:true,base:[SB(0,false,'a',3),F('crumble',5)]},
 {J:1,K:1,LK:1,ice:0,lock:false,base:[SB(0,false,'a',3),F('fragile',3)]},
];
let best=null;
for(const p of TRIES){
  if(best) break;
  const cfg={w:15,h:11,steps:88,minSpan:10,minPar:28,maxPar:60,attempts:70,noise:.05,relax:2,targetPar:40,feat:p.base};
  const t0=Date.now();
  for(let s=0;s<9000 && Date.now()-t0<110000;s++){
    let g=null; try{ g=genLevel(310000+s*29,cfg); }catch(e){ continue; }
    if(!g) continue;
    let def=g.def;
    if(p.ice){ const r=growTiles(def,'^',p.ice,mulberry(s+3),{maxPar:58}); if(r.placed<p.ice) continue; def=r.def; }
    if(p.J){ const r=growTiles(def,'J',p.J,mulberry(s+9),{maxPar:58}); if(r.placed<p.J) continue; def=r.def; }
    if(p.LK){ const r=growTiles(def,'L',p.LK,mulberry(s+17),{maxPar:58,critical:true}); if(r.placed<p.LK) continue; def=r.def;
              const k=placeKeys(def,p.K,mulberry(s+23),{maxPar:60,wantPar:42}); if(k.placed<p.K) continue; def=k.def; }
    if(p.lock) def=Object.assign({},def,{lockGoal:true});
    def=sprinkleStars(def,3,mulberry(s+31),{pads:1});
    let L,opt; try{ L=parseLevel(def); opt=solve(L); }catch(e){ continue; }
    if(!opt||opt.length<32) continue;
    if(L.stars.length&&!solveAllStars(L)) continue;
    const score=-Math.abs(opt.length-44)*2+L.stars.length*3;
    if(!best||score>best.score) best={score,def,opt:opt.length,ns:L.stars.length,lock:p.lock};
    if(Math.abs(best.opt-44)<=3) break;
  }
}
if(!best){ console.error('Terminus still failed'); process.exit(1); }
const lv={name:'Terminus',hint:'The last island. It has kept every trick for you.',par:best.opt+Math.floor(best.opt/12),map:best.def.map};
if(best.def.links) lv.links=best.def.links;
if(best.lock) lv.lockGoal=true;
out.push(lv);
fs.writeFileSync(__dirname+'/newlevels2.json',JSON.stringify(out));
const flat=lv.map.join(''),c=ch=>flat.split(ch).length-1;
console.error('Terminus par='+lv.par+' J'+c('J')+' K'+c('K')+' L'+c('L')+' ice'+c('^')+' O'+c('O')+' T'+c('T')+' ★'+best.ns+(best.lock?' LOCK':''));
console.error('total '+out.length);
