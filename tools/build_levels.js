const fs=require('fs');
Object.assign(global, eval(fs.readFileSync(__dirname+'/rules.js','utf8')+";({parseLevel,initialState,cellsOf,roll,tileAt,isSolid,step,key,keyS,solve,solveAllStars,DIRS,DIR_LIST})"));
const {genLevel,sprinkleStars,mulberry}=require('./gen.js');

const F=(t,n)=>({t,n});
const SB=(idx,hard,group,span,open)=>({t:'switchbridge',idx,hard,group,span,open});

// name, hint, generator config
const PLAN=[
 {name:'Crumbling Path', hint:'Pale cracked tiles hold you once. Step off and they are gone forever.',
  cfg:{w:9,h:8,steps:44,minSpan:5,minPar:10,maxPar:20,attempts:120,noise:.06,feat:[F('crumble',5)]}},
 {name:'Claim It', stars:3, pads:3, hint:'A star pad only pays out when the block is standing upright on it.',
  cfg:{w:9,h:8,steps:46,minSpan:5,minPar:11,maxPar:22,attempts:1,noise:.06,feat:[]}},
 {name:'Slipstream', hint:'Ice will not let you stop. You keep rolling the same way until you leave it.',
  cfg:{w:10,h:8,steps:48,minSpan:5,minPar:10,maxPar:22,attempts:140,noise:.05,feat:[F('ice',3)]}},
 {name:'Needlepoint', hint:'A pin is a spire of rock — it holds you standing, never lying down.',
  cfg:{w:10,h:8,steps:48,minSpan:5,minPar:11,maxPar:22,attempts:140,noise:.06,feat:[F('pin',4)]}},
 {name:'Wormhole', hint:'Land upright on a portal and it throws you to its twin.',
  cfg:{w:11,h:8,steps:52,minSpan:6,minPar:11,maxPar:24,attempts:160,noise:.05,feat:[F('port',2)]}},
 {name:'One Way Down', hint:'Every crumble tile is a door that locks behind you. Order matters.',
  cfg:{w:10,h:9,steps:56,minSpan:6,minPar:14,maxPar:26,attempts:140,noise:.05,feat:[F('crumble',7)]}},
 {name:'Frostbite', hint:'Glass under ice. You will not get the chance to stop and think.',
  cfg:{w:11,h:9,steps:56,minSpan:6,minPar:14,maxPar:26,attempts:160,noise:.05,feat:[F('ice',3),F('fragile',3)]}},
 {name:'Pinwheel', hint:'Pins force you upright; glass forbids it. Read the ground before you roll.',
  cfg:{w:11,h:9,steps:56,minSpan:6,minPar:14,maxPar:26,attempts:160,noise:.06,feat:[F('pin',4),F('fragile',3)]}},
 {name:'Gate and Gone', hint:'The bridge is one trip only if you burn the crumble tiles getting there.',
  cfg:{w:12,h:9,steps:60,minSpan:7,minPar:16,maxPar:30,attempts:180,noise:.05,feat:[SB(0,false,'a',3),F('crumble',5)]}},
 {name:'Constellation', stars:3, pads:1, hint:'The goal is sealed. Claim every star on the island before it opens.',
  lockGoal:true,
  cfg:{w:10,h:9,steps:56,minSpan:5,minPar:12,maxPar:26,attempts:160,noise:.06,lockGoal:true,feat:[F('fragile',3)]}},
 {name:'Thin Air', hint:'Glass and crumble share one rule: never linger.',
  cfg:{w:11,h:9,steps:58,minSpan:6,minPar:16,maxPar:30,attempts:180,noise:.05,feat:[F('fragile',4),F('crumble',5)]}},
 {name:'Cold Snap', hint:'A slide across ice can burn a crumble tile you were saving.',
  cfg:{w:11,h:9,steps:58,minSpan:6,minPar:15,maxPar:30,attempts:180,noise:.05,feat:[F('ice',3),F('crumble',5)]}},
 {name:'Skywire', hint:'Pins hold a standing block. Portals move one. Chain them.',
  cfg:{w:12,h:9,steps:60,minSpan:7,minPar:15,maxPar:30,attempts:180,noise:.05,feat:[F('pin',4),F('port',2)]}},
 {name:'Twin Gates', hint:'Two switches, two bridges, and only one order that gets you home.',
  cfg:{w:13,h:9,steps:66,minSpan:8,minPar:18,maxPar:34,attempts:200,noise:.05,feat:[SB(0,false,'a',3),SB(1,false,'b',3)]}},
 {name:'Collector', stars:3, pads:2, hint:'Star pads demand your full weight, and the goal will not open without them.',
  lockGoal:true,
  cfg:{w:11,h:9,steps:58,minSpan:6,minPar:15,maxPar:30,attempts:180,noise:.06,lockGoal:true,feat:[F('ice',3)]}},
 {name:'Glacier', hint:'A wide sheet of ice. Find the one lane that does not run out.',
  cfg:{w:12,h:10,steps:64,minSpan:7,minPar:16,maxPar:32,attempts:200,noise:.05,feat:[F('ice',5)]}},
 {name:'Ashfall', hint:'Half the island is one-use. There is no walking it back.',
  cfg:{w:12,h:10,steps:64,minSpan:7,minPar:18,maxPar:34,attempts:200,noise:.05,feat:[F('crumble',8)]}},
 {name:'Pincushion', hint:'Stand on pins, lie across glass. Get it backwards and you are gone.',
  cfg:{w:12,h:10,steps:64,minSpan:7,minPar:17,maxPar:32,attempts:200,noise:.06,feat:[F('pin',5),F('fragile',4)]}},
 {name:'Relay', hint:'A portal is a shortcut and a trap — it only fires when you land upright.',
  cfg:{w:13,h:10,steps:68,minSpan:8,minPar:18,maxPar:34,attempts:200,noise:.05,feat:[F('port',4),SB(0,true,'a',3)]}},
 {name:'The Vault', stars:3, pads:1, hint:'Stars first, bridge second, goal last. No shortcuts.',
  lockGoal:true,
  cfg:{w:13,h:10,steps:68,minSpan:8,minPar:18,maxPar:36,attempts:200,noise:.05,lockGoal:true,feat:[SB(0,false,'a',3)]}},
 {name:'Shatterline', hint:'Glass over crumble over void. Nothing here forgives a second visit.',
  cfg:{w:12,h:10,steps:68,minSpan:7,minPar:18,maxPar:34,attempts:220,noise:.05,feat:[F('fragile',5),F('crumble',6)]}},
 {name:'Black Ice', hint:'You cannot stop on ice and you cannot lie down on a pin.',
  cfg:{w:12,h:10,steps:68,minSpan:7,minPar:18,maxPar:34,attempts:220,noise:.05,feat:[F('ice',4),F('pin',4)]}},
 {name:'Waypoint', hint:'Portals rearrange the island. Crumble tiles make sure you only get one look.',
  cfg:{w:13,h:10,steps:70,minSpan:8,minPar:18,maxPar:36,attempts:220,noise:.05,feat:[F('port',2),F('crumble',6)]}},
 {name:'Lattice', hint:'Two bridges, a heavy switch and a floor made of glass.',
  cfg:{w:14,h:10,steps:74,minSpan:8,minPar:20,maxPar:38,attempts:220,noise:.05,feat:[SB(0,false,'a',3),SB(1,true,'b',3),F('fragile',3)]}},
 {name:'Stardust', stars:4, pads:2, hint:'Two kinds of star, one sealed door. Take every one.',
  lockGoal:true,
  cfg:{w:13,h:10,steps:72,minSpan:8,minPar:18,maxPar:38,attempts:220,noise:.06,lockGoal:true,feat:[F('port',2)]}},
 {name:'Freefall', hint:'The island eats itself behind you. Commit to a route.',
  cfg:{w:13,h:10,steps:74,minSpan:8,minPar:20,maxPar:38,attempts:240,noise:.05,feat:[F('crumble',9)]}},
 {name:'Mirror Halls', hint:'Four portals and a gate. Map the pairs before you move.',
  cfg:{w:14,h:10,steps:76,minSpan:9,minPar:20,maxPar:40,attempts:240,noise:.05,feat:[F('port',4),SB(0,false,'a',3)]}},
 {name:'Deep Freeze', hint:'Ice, glass and crumble in the same breath. Slow down — you cannot.',
  cfg:{w:14,h:10,steps:76,minSpan:9,minPar:22,maxPar:40,attempts:240,noise:.05,feat:[F('ice',4),F('fragile',4),F('crumble',5)]}},
 {name:'The Machine', hint:'Three gates, a pin field and a star you will have to earn twice over.',
  cfg:{w:15,h:10,steps:80,minSpan:9,minPar:24,maxPar:44,attempts:260,noise:.05,feat:[SB(0,false,'a',3),SB(1,true,'b',3),F('pin',4)]}},
 {name:'Endgame', stars:3, pads:1, hint:'Everything the islands taught you, in one long breath. Good luck.',
  lockGoal:true,
  cfg:{w:15,h:11,steps:88,minSpan:10,minPar:26,maxPar:50,attempts:300,noise:.05,lockGoal:true,feat:[SB(0,false,'a',3),F('ice',3),F('crumble',5),F('fragile',3),F('port',2)]}},
];

const TARGET=[12,13,13,14,15,16,17,18,19,18, 20,21,21,23,20, 24,25,24,26,25, 27,27,28,29,26, 30,31,32,34,38];
const out=[];
let seedBase=1000;
for(let i=0;i<PLAN.length;i++){
  const p=PLAN[i]; let best=null;
  p.cfg.targetPar = TARGET[i];
  for(const pass of [{relax:0,ms:26000},{relax:1,ms:16000},{relax:2,ms:14000}]){
    if(best) break;
    p.cfg.relax=pass.relax;
    const t0=Date.now();
    for(let s=0;s<1400 && Date.now()-t0<pass.ms;s++){
      let r=null;
      try{ r=genLevel(seedBase+i*977+s*13, p.cfg); }catch(e){ continue; }
      if(!r) continue;
      if(!best||r.score>best.score) best=r;
      if(best.score>=28) break;
    }
    if(best&&pass.relax>0) console.error('  (relaxed pass '+pass.relax+' for '+p.name+')');
  }
  if(!best){ console.error('FAILED to generate: '+p.name); process.exit(1); }
  let def=best.def;
  if(p.lockGoal) def.lockGoal=true;
  const want=p.stars!==undefined?p.stars:(i<6?2:i<16?3:4);
  def=sprinkleStars(def,want,mulberry(4242+i),{pads:p.pads||0});
  const L2=parseLevel(def); const opt=solve(L2);
  const par=opt.length + Math.floor(opt.length/12);
  const lv={name:p.name,hint:p.hint,par,map:def.map};
  if(def.links) lv.links=def.links;
  if(p.lockGoal) lv.lockGoal=true;
  out.push(lv);
  best.ev={par:opt.length,L:L2};
  console.error(`${(21+i).toString().padStart(2)} ${p.name.padEnd(16)} par=${par} opt=${best.ev.par} ${def.map[0].length}x${def.map.length} stars=${best.ev.L.stars.length} score=${best.score}`);
}
fs.writeFileSync(__dirname+'/newlevels.json',JSON.stringify(out,null,0));
console.error('written '+out.length);
