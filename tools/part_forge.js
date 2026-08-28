// ===== Forge — builds fresh islands in the browser for Daily and Endless =====
// Same rules module the campaign uses, so anything it hands back is provably
// solvable and its par is the true optimum.
const Forge=(function(){
function mulberry(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const ADJ=['Amber','Broken','Cold','Drifting','Empty','Fallow','Grey','Hollow','Iron','Jagged','Kindled','Long','Middle','Narrow','Old','Pale','Quiet','Rusted','Sunken','Thin','Upper','Vacant','Wandering','Yellow'];
const NOUN=['Spire','Landing','Terrace','Causeway','Shelf','Quarry','Gallery','Ridge','Vault','Bridgehead','Basin','Steps','Reach','Yard','Crossing','Perch','Hollow','Bastion','Anvil','Furrow'];
function nameFor(rng){ return ADJ[Math.floor(rng()*ADJ.length)]+' '+NOUN[Math.floor(rng()*NOUN.length)]; }

function pathCells(L,path){
  let s=initialState(L); const set=new Set(); for(const [x,y] of cellsOf(s)) set.add(x+','+y);
  for(const d of path){ const r=step(L,s,d);
    for(const ev of r.events) if(ev.type==='roll') for(const [x,y] of cellsOf(ev.to)) set.add(x+','+y);
    s=r.state; for(const [x,y] of cellsOf(s)) set.add(x+','+y); }
  return set;
}
function carve(rng,w,h,steps){
  const cells=new Map(), uprights=[];
  let s={x:2+Math.floor(rng()*Math.max(1,w-4)),y:2+Math.floor(rng()*Math.max(1,h-4)),o:0};
  const mark=st=>{ for(const [x,y] of cellsOf(st)) cells.set(x+','+y,1); };
  mark(s); const start={x:s.x,y:s.y}; uprights.push({x:s.x,y:s.y,i:0});
  for(let i=0;i<steps;i++){
    let ok=false;
    for(let t=0;t<12;t++){
      const d=DIR_LIST[Math.floor(rng()*4)], n=roll(s,d), cs=cellsOf(n);
      let inb=true; for(const [x,y] of cs) if(x<0||y<0||x>=w||y>=h) inb=false;
      if(!inb) continue;
      let fresh=0; for(const [x,y] of cs) if(!cells.has(x+','+y)) fresh++;
      if(!fresh && rng()>0.35) continue;
      s=n; mark(s); ok=true; break;
    }
    if(!ok) break;
    if(s.o===0) uprights.push({x:s.x,y:s.y,i:i+1});
  }
  return {cells,start,uprights};
}
function trim(rows){
  let a=1e9,b=-1,c=1e9,d=-1;
  for(let y=0;y<rows.length;y++)for(let x=0;x<rows[y].length;x++) if(rows[y][x]!=='.'){ if(x<a)a=x; if(x>b)b=x; if(y<c)c=y; if(y>d)d=y; }
  if(b<0) return null;
  const out=[]; for(let y=c;y<=d;y++) out.push(rows[y].slice(a,b+1).join(''));
  return out;
}
function tierPlan(tier){
  const t=Math.min(tier,14);
  return {
    w:8+Math.round(t*0.48), h:7+Math.round(t*0.30), steps:34+t*4,
    feats:1+Math.round(t*0.55),
    kinds: t<2?['F','O'] : t<5?['F','O','^'] : t<8?['F','O','^','P'] : t<11?['F','O','^','P','J']:['F','O','^','P','J','T'],
    stars: t<3?1:t<8?2:3,
    minPar:6+Math.round(t*1.1), maxPar:20+t*3.2
  };
}
// One island. Returns {name,hint,par,map} or null if this seed did not work out.
function make(seed,tier){
  const plan=tierPlan(tier);
  for(let attempt=0;attempt<44;attempt++){
    const rng=mulberry(seed*7919+attempt*131+tier*17);
    const {cells,start,uprights}=carve(rng,plan.w,plan.h,plan.steps);
    if(uprights.length<5) continue;
    const rows=[]; for(let y=0;y<plan.h;y++){ rows[y]=[]; for(let x=0;x<plan.w;x++) rows[y][x]=cells.has(x+','+y)?'#':'.'; }
    for(let i=0;i<Math.round(plan.w*plan.h*0.05);i++){
      const x=Math.floor(rng()*plan.w), y=Math.floor(rng()*plan.h);
      if(rows[y][x]!=='.') continue;
      let n=0; for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const a=x+dx,b=y+dy; if(a>=0&&b>=0&&a<plan.w&&b<plan.h&&rows[b][a]==='#') n++; }
      if(n) rows[y][x]='#';
    }
    const far=uprights.filter(u=>Math.abs(u.x-start.x)+Math.abs(u.y-start.y)>=Math.max(4,Math.round(plan.w*0.4))).sort((a,b)=>b.i-a.i);
    if(!far.length) continue;
    const goal=far[Math.floor(rng()*Math.min(4,far.length))];
    if(goal.x===start.x&&goal.y===start.y) continue;
    rows[start.y][start.x]='S'; rows[goal.y][goal.x]='G';
    let map=trim(rows); if(!map) continue;

    let L,p;
    try{ L=parseLevel({name:'f',map}); p=solve(L); }catch(e){ continue; }
    if(!p||p.length<Math.max(5,plan.minPar-8)) continue;

    // features, one at a time, each kept only if the island survives it
    const H=map.length, W=map[0].length;
    let floor=[]; for(let y=0;y<H;y++)for(let x=0;x<W;x++) if(map[y][x]==='#') floor.push({x,y});
    floor.sort(()=>rng()-0.5);
    let placed=0, fi=0;
    for(let k=0;k<plan.feats*4 && placed<plan.feats && fi<floor.length;k++){
      const kind=plan.kinds[Math.floor(rng()*plan.kinds.length)];
      const need=kind==='T'?2:1;
      const spots=floor.slice(fi,fi+need); fi+=need;
      if(spots.length<need) break;
      const g=map.map(r=>r.split('')); spots.forEach(c=>g[c.y][c.x]=kind);
      const cand=g.map(r=>r.join(''));
      let CL,cp; try{ CL=parseLevel({name:'f',map:cand}); cp=solve(CL); }catch(e){ continue; }
      if(!cp||cp.length>plan.maxPar) continue;
      if(kind==='^'||kind==='J'){ const pc=pathCells(CL,cp); if(!spots.every(c=>pc.has(c.x+','+c.y))) continue; }
      map=cand; placed++;
    }
    try{ L=parseLevel({name:'f',map}); p=solve(L); }catch(e){ continue; }
    if(!p||p.length<plan.minPar||p.length>plan.maxPar) continue;

    // stars, off the fastest line where possible
    const onPath=pathCells(L,p);
    let cand=[]; for(let y=0;y<map.length;y++)for(let x=0;x<map[y].length;x++) if(map[y][x]==='#') cand.push({x,y,off:onPath.has(x+','+y)?0:1});
    cand.sort((a,b)=>(b.off-a.off)||(rng()-0.5));
    const picks=[];
    for(const c of cand){ if(picks.length>=plan.stars) break; if(picks.some(o=>Math.abs(o.x-c.x)+Math.abs(o.y-c.y)<3)) continue; picks.push(c); }
    for(let take=picks.length;take>=1;take--){
      const g=map.map(r=>r.split('')); picks.slice(0,take).forEach(c=>g[c.y][c.x]='*');
      const cm=g.map(r=>r.join(''));
      try{ const CL=parseLevel({name:'f',map:cm}); if(solve(CL)&&solveAllStars(CL)){ map=cm; break; } }catch(e){}
    }
    try{ L=parseLevel({name:'f',map}); p=solve(L); }catch(e){ continue; }
    if(!p) continue;
    return {name:nameFor(rng), hint:'A freshly forged island — nobody has a best score here but you.', par:p.length+Math.floor(p.length/10), map, forged:true};
  }
  return null;
}
// Never hand the caller nothing: step the difficulty down until an island lands.
function forge(seed,tier){ for(let t=tier;t>=0;t--){ const d=make(seed+t*101,t); if(d) return {def:d,tier:t}; } return {def:make(seed,0)||make(seed+1,0),tier:0}; }
return {make,forge,mulberry,tierPlan};
})();
