const fs=require('fs');
Object.assign(global, eval(fs.readFileSync(__dirname+'/rules.js','utf8')+";({parseLevel,initialState,cellsOf,roll,tileAt,isSolid,step,key,keyS,solve,solveAllStars,DIRS,DIR_LIST})"));
const {genLevel,sprinkleStars,mulberry}=require('./gen.js');
const F=(t,n,onPath)=>({t,n,onPath});
const levels=JSON.parse(fs.readFileSync(__dirname+'/newlevels.json','utf8'));

// 1) regenerate the three levels whose ice did not survive
const REGEN=[
 {i:2, stars:2, pads:0, targetPar:14,
  cfg:{w:10,h:8,steps:48,minSpan:5,minPar:11,maxPar:20,attempts:200,noise:.05,feat:[F('ice',3,true)]}},
 {i:14, stars:2, pads:2, lockGoal:true, targetPar:22,
  cfg:{w:11,h:9,steps:58,minSpan:6,minPar:14,maxPar:26,attempts:220,noise:.06,lockGoal:true,feat:[F('ice',3,true)]}},
 {i:15, stars:3, pads:0, targetPar:24,
  cfg:{w:12,h:10,steps:64,minSpan:7,minPar:16,maxPar:30,attempts:240,noise:.05,feat:[F('ice',5,true)]}},
];
for(const r of REGEN){
  r.cfg.targetPar=r.targetPar; let best=null;
  for(const pass of [{relax:0,ms:50000},{relax:1,ms:25000}]){
    if(best) break; r.cfg.relax=pass.relax; const t0=Date.now();
    for(let s=0;s<3000&&Date.now()-t0<pass.ms;s++){
      let g=null; try{ g=genLevel(70000+r.i*811+s*17,r.cfg); }catch(e){ continue; }
      if(!g) continue;
      if((g.def.map.join('').split('^').length-1)<2) continue;
      if(!best||g.score>best.score) best=g;
      if(best.score>=26) break;
    }
  }
  if(!best){ console.error('could not repair index '+r.i); continue; }
  let def=best.def; if(r.lockGoal) def.lockGoal=true;
  def=sprinkleStars(def,r.stars,mulberry(999+r.i),{pads:r.pads});
  const opt=solve(parseLevel(def));
  const old=levels[r.i];
  levels[r.i]={name:old.name,hint:old.hint,par:opt.length+Math.floor(opt.length/12),map:def.map};
  if(def.links) levels[r.i].links=def.links;
  if(r.lockGoal) levels[r.i].lockGoal=true;
  console.error('repaired '+(21+r.i)+' '+old.name+' par='+levels[r.i].par+' ice='+(def.map.join('').split('^').length-1));
}

// 2) sealed-goal levels drifted long once stars were added - re-sprinkle with a smaller budget
const RESTAR=[{i:9,n:2,pads:1},{i:19,n:2,pads:1},{i:24,n:3,pads:2}];
for(const r of RESTAR){
  const d=levels[r.i];
  const stripped=Object.assign({},d,{map:d.map.map(row=>row.replace(/[*X]/g,'#'))});
  const def=sprinkleStars(stripped,r.n,mulberry(31337+r.i),{pads:r.pads});
  const opt=solve(parseLevel(def));
  if(!opt) { console.error('re-star failed '+(21+r.i)); continue; }
  const before=d.par;
  levels[r.i]=Object.assign({},d,{map:def.map,par:opt.length+Math.floor(opt.length/12)});
  console.error('re-starred '+(21+r.i)+' '+d.name+' par '+before+' -> '+levels[r.i].par);
}
fs.writeFileSync(__dirname+'/newlevels.json',JSON.stringify(levels));
console.error('saved');
