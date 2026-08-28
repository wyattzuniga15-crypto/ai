const fs=require('fs');
Object.assign(global, eval(fs.readFileSync(__dirname+'/rules.js','utf8')+";({parseLevel,initialState,cellsOf,roll,tileAt,isSolid,step,key,keyS,solve,solveAllStars,DIRS,DIR_LIST})"));
const {genLevel,growTiles,sprinkleStars,mulberry}=require('./gen.js');
const levels=JSON.parse(fs.readFileSync(__dirname+'/newlevels.json','utf8'));
const F=(t,n)=>({t,n});

const JOBS=[
 {i:2,  ice:3, stars:2, pads:0, targetPar:14, growMax:22,
  cfg:{w:10,h:8,steps:46,minSpan:5,minPar:9,maxPar:18,attempts:30,noise:.05,relax:2,feat:[]}},
 {i:14, ice:3, stars:2, pads:2, lockGoal:true, targetPar:22, growMax:30,
  cfg:{w:11,h:9,steps:56,minSpan:6,minPar:12,maxPar:22,attempts:30,noise:.06,relax:2,feat:[]}},
 {i:15, ice:5, stars:3, pads:0, targetPar:24, growMax:34,
  cfg:{w:12,h:10,steps:64,minSpan:7,minPar:14,maxPar:26,attempts:30,noise:.05,relax:2,feat:[]}},
];

for(const j of JOBS){
  j.cfg.targetPar=j.targetPar;
  let best=null;
  const t0=Date.now();
  for(let s=0;s<4000 && Date.now()-t0<60000;s++){
    let g=null; try{ g=genLevel(80000+j.i*733+s*19,j.cfg); }catch(e){ continue; }
    if(!g) continue;
    const r=growTiles(g.def,'^',j.ice,mulberry(j.i*97+s),{maxPar:j.growMax});
    if(r.placed<j.ice) continue;
    let def=r.def; if(j.lockGoal) def=Object.assign({},def,{lockGoal:true});
    def=sprinkleStars(def,j.stars,mulberry(555+j.i+s),{pads:j.pads});
    let L,opt; try{ L=parseLevel(def); opt=solve(L); }catch(e){ continue; }
    if(!opt) continue;
    const sp=L.stars.length?solveAllStars(L):opt; if(!sp) continue;
    const nstars=L.stars.length;
    const score = -Math.abs(opt.length-j.targetPar)*3 + nstars*4 + j.ice*2;
    if(!best||score>best.score) best={score,def,opt:opt.length,nstars};
    if(score>=nstars*4+j.ice*2) break;
  }
  if(!best){ console.error('STILL FAILED '+(21+j.i)); continue; }
  const old=levels[j.i];
  levels[j.i]={name:old.name,hint:old.hint,par:best.opt+Math.floor(best.opt/12),map:best.def.map};
  if(best.def.links) levels[j.i].links=best.def.links;
  if(j.lockGoal) levels[j.i].lockGoal=true;
  console.error('rebuilt '+(21+j.i)+' '+old.name+' par='+levels[j.i].par+' ice='+(best.def.map.join('').split('^').length-1)+' stars='+best.nstars);
}
fs.writeFileSync(__dirname+'/newlevels.json',JSON.stringify(levels));
console.error('saved');
