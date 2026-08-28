const fs=require('fs');
Object.assign(global, eval(fs.readFileSync(__dirname+'/rules.js','utf8')+";({parseLevel,initialState,cellsOf,roll,tileAt,isSolid,step,key,keyS,solve,solveAllStars,DIRS,DIR_LIST})"));

function mulberry(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

const CH={floor:'#',fragile:'F',crumble:'O',ice:'^',pin:'P',port:'T',star:'*',starpad:'X'};

function carve(rng,w,h,steps){
  const cells=new Map(); // "x,y" -> true
  const uprights=[];
  let s={x:2+Math.floor(rng()*(w-4)),y:2+Math.floor(rng()*(h-4)),o:0};
  const mark=st=>{ for(const [x,y] of cellsOf(st)) cells.set(x+','+y,true); };
  mark(s); uprights.push({x:s.x,y:s.y,i:0});
  const start={x:s.x,y:s.y};
  for(let i=0;i<steps;i++){
    let tries=0,ok=false;
    while(tries++<12){
      const d=DIR_LIST[Math.floor(rng()*4)];
      const n=roll(s,d);
      const cs=cellsOf(n); let inb=true;
      for(const [x,y] of cs) if(x<0||y<0||x>=w||y>=h) inb=false;
      if(!inb) continue;
      // prefer fresh ground
      let fresh=0; for(const [x,y] of cs) if(!cells.has(x+','+y)) fresh++;
      if(fresh===0 && rng()>0.35) continue;
      s=n; mark(s); ok=true; break;
    }
    if(!ok) break;
    if(s.o===0) uprights.push({x:s.x,y:s.y,i:i+1});
  }
  return {cells,start,uprights};
}

function buildGrid(w,h,cells){ const g=[]; for(let y=0;y<h;y++){ g[y]=[]; for(let x=0;x<w;x++) g[y][x]= cells.has(x+','+y)?'#':'.'; } return g; }
function trim(g){
  let minx=1e9,maxx=-1,miny=1e9,maxy=-1;
  for(let y=0;y<g.length;y++)for(let x=0;x<g[y].length;x++) if(g[y][x]!=='.'){ if(x<minx)minx=x; if(x>maxx)maxx=x; if(y<miny)miny=y; if(y>maxy)maxy=y; }
  const out=[]; for(let y=miny;y<=maxy;y++) out.push(g[y].slice(minx,maxx+1));
  return {g:out,dx:minx,dy:miny};
}
function toMap(g){ return g.map(r=>r.join('')); }
function floorCells(g){ const a=[]; for(let y=0;y<g.length;y++)for(let x=0;x<g[y].length;x++) if(g[y][x]==='#') a.push({x,y}); return a; }

function pathCells(L,path){
  // count every cell the block passes over, mid-slide frames included
  let s=initialState(L); const set=new Set(); for(const [x,y] of cellsOf(s)) set.add(x+','+y);
  for(const d of path){ const r=step(L,s,d);
    for(const ev of r.events){ if(ev.type==='roll'){ for(const [x,y] of cellsOf(ev.to)) set.add(x+','+y); } }
    s=r.state; for(const [x,y] of cellsOf(s)) set.add(x+','+y); }
  return set;
}


// remove tiles the block can never actually occupy -> tight, readable maps
function reachableCells(L){
  const s0=initialState(L); const seen=new Set([keyS(s0)]); const q=[s0]; let qi=0; const cells=new Set();
  for(const [x,y] of cellsOf(s0)) cells.add(x+','+y);
  while(qi<q.length){ const s=q[qi++];
    for(const d of DIR_LIST){ const r=step(L,s,d); if(r.result==='fall'||r.result==='break') continue;
      const k=keyS(r.state); if(seen.has(k)) continue; seen.add(k);
      for(const ev of r.events){ if(ev.type==='roll'){ for(const [x,y] of cellsOf(ev.to)) cells.add(x+','+y); } }
      for(const [x,y] of cellsOf(r.state)) cells.add(x+','+y);
      if(r.result!=='win') q.push(r.state); } }
  return cells;
}
function prune(def){
  const L=parseLevel(def); const used=reachableCells(L);
  const g=def.map.map(r=>r.split(''));
  for(let y=0;y<g.length;y++)for(let x=0;x<g[y].length;x++){
    const c=g[y][x]; if(c==='.'||c==='S'||c==='G'||c==='*'||c==='X') continue;
    if(!used.has(x+','+y)) g[y][x]='.';
  }
  const t=trim(g);
  const out=Object.assign({},def,{map:toMap(t.g)});
  return out;
}

function evaluate(def,opt){
  let L; try{ L=parseLevel(def); }catch(e){ return null; }
  const p=solve(L); if(!p) return null;
  if(p.length<opt.minPar||p.length>opt.maxPar) return null;
  let sp=null;
  if(L.stars.length){ sp=solveAllStars(L); if(!sp) return null; if(sp.length>p.length*3+24) return null; }
  return {L,par:p.length,path:p,starPath:sp};
}

// Feature painters -----------------------------------------------------------
function paint(g,cells,ch){ for(const c of cells) g[c.y][c.x]=ch; }

function genLevel(seed,cfg){
  const rng=mulberry(seed);
  const {cells,start,uprights}=carve(rng,cfg.w,cfg.h,cfg.steps);
  if(uprights.length<6) return null;
  let g=buildGrid(cfg.w,cfg.h,cells);
  // sprinkle a few extra tiles so it does not read as a single corridor
  const extra=Math.floor(cfg.w*cfg.h*(cfg.noise||0.05));
  for(let i=0;i<extra;i++){
    const x=Math.floor(rng()*cfg.w), y=Math.floor(rng()*cfg.h);
    if(g[y][x]!=='.') continue;
    let n=0; for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const a=x+dx,b=y+dy; if(a>=0&&b>=0&&a<cfg.w&&b<cfg.h&&g[b][a]==='#') n++; }
    if(n>=1) g[y][x]='#';
  }
  // goal: an upright spot late in the walk, far from start
  const cand=uprights.filter(u=>Math.abs(u.x-start.x)+Math.abs(u.y-start.y)>=cfg.minSpan).sort((a,b)=>b.i-a.i);
  if(!cand.length) return null;
  const goal=cand[Math.floor(rng()*Math.min(5,cand.length))];
  if(goal.x===start.x&&goal.y===start.y) return null;
  g[start.y][start.x]='S'; g[goal.y][goal.x]='G';

  const tr=trim(g); g=tr.g;
  const W=g[0].length,H=g.length;
  if(W<3||H<3||W>cfg.w||H>cfg.h) { /* fine */ }

  // baseline must be solvable
  const base=evaluate({name:'x',map:toMap(g)},{minPar:cfg.minPar,maxPar:cfg.maxPar+30});
  if(!base) return null;

  const basePathCells=(()=>{ try{ const BL=parseLevel({name:'b',map:toMap(g)}); const bp=solve(BL); if(!bp) return []; const set=pathCells(BL,bp); const a=[]; for(const k of set){ const [x,y]=k.split(',').map(Number); if(g[y]&&g[y][x]==='#') a.push({x,y}); } return a; }catch(e){ return []; } })();
  let best=null;
  for(let attempt=0;attempt<cfg.attempts;attempt++){
    const gg=g.map(r=>r.slice());
    const links={};
    const spots=floorCells(gg);
    if(spots.length<cfg.feat.length*2) break;
    const shuffled=spots.slice().sort(()=>rng()-0.5);
    let si=0; const take=n=>shuffled.slice(si,si+=n);
    const onPath=basePathCells.slice().sort(()=>rng()-0.5); let pi=0;
    const takePath=n=>{ const out=[]; while(out.length<n&&pi<onPath.length){ const c=onPath[pi++]; if(gg[c.y][c.x]==='#') out.push(c); } return out; };
    let ok=true;
    for(const f of cfg.feat){
      const n=typeof f.n==='function'?f.n(rng):f.n;
      if(f.t==='switchbridge'){
        const bg=f.group||'a'; const br=take(f.span||3); if(br.length<(f.span||3)){ok=false;break;}
        // bridge cells in a row-ish cluster: just take contiguous-ish picks
        paint(gg,br,f.open?bg.toUpperCase():bg);
        const sw=take(1); if(!sw.length){ok=false;break;}
        gg[sw[0].y][sw[0].x]=f.hard?String(5+ (f.idx||0)) : String(1+(f.idx||0));
        links[f.hard?String(5+(f.idx||0)):String(1+(f.idx||0))]=f.toggles||bg;
      } else {
        const cs=f.onPath?takePath(n):take(n); if(cs.length<n){ok=false;break;}
        paint(gg,cs,CH[f.t]);
      }
    }
    if(!ok) continue;
    const def={name:'x',map:toMap(gg)}; if(Object.keys(links).length) def.links=links; if(cfg.lockGoal) def.lockGoal=true;
    let ev=evaluate(def,{minPar:cfg.minPar,maxPar:cfg.maxPar});
    if(!ev) continue;
    let pdef; try{ pdef=prune(def); }catch(e){ continue; }
    const pev=evaluate(pdef,{minPar:cfg.minPar,maxPar:cfg.maxPar});
    if(pev && pev.par===ev.par){ ev=pev; def.map=pdef.map; }
    // the finished map must still carry the tiles the theme is built around
    const flat=def.map.join('');
    const cnt=c=>flat.split(c).length-1;
    let keeps=true;
    for(const f of cfg.feat){
      if(f.t==='switchbridge'){ if((flat.match(/[1-8]/g)||[]).length<1||(flat.match(/[a-eA-E]/g)||[]).length<2) keeps=false; }
      else if(f.t==='port'){ const c=cnt('T'); if(c<2||c%2) keeps=false; }
      else if(f.t==='star'||f.t==='starpad'){ /* stars are sprinkled in a later pass */ }
      else { const want=cfg.relax?1:Math.max(2,Math.ceil((f.n||2)*0.5)); if(cnt(CH[f.t])<want) keeps=false; }
    }
    if(cfg.relax>=2) keeps=true;
    if(!keeps) continue;
    // score: longer is better, and the solution should actually touch the special tiles
    const pc=pathCells(ev.L,ev.path);
    let touched=0,special=0;
    for(let y=0;y<ev.L.h;y++)for(let x=0;x<ev.L.w;x++){ const t=ev.L.tiles[y][x].type;
      if(t==='fragile'||t==='crumble'||t==='ice'||t==='pin'||t==='port'||t==='bridge'||t==='switch'){ special++; if(pc.has(x+','+y)) touched++; } }
    if(special && touched < (cfg.relax?1:Math.max(1,Math.ceil(special*0.45)))) continue;
    const tgt=cfg.targetPar||((cfg.minPar+cfg.maxPar)/2);
    const score= touched*4 + special*2 + Math.min(12,(ev.par-base.par)) - Math.abs(ev.par-tgt)*3;
    if(!best||score>best.score) best={score,def,ev,touched,special};
  }
  return best;
}


// Stars are added last: on ground the block can reach but the fastest line skips,
// so collecting them is a genuine detour rather than free.
function sprinkleStars(def,n,rng,opt){
  opt=opt||{};
  let L; try{ L=parseLevel(def); }catch(e){ return def; }
  const base=solve(L); if(!base) return def;
  const onPath=pathCells(L,base);
  const reach=reachableCells(L);
  const uprightCells=uprightReachable(L);
  const g=def.map.map(r=>r.split(''));
  const cands=[];
  for(const k of reach){ const [x,y]=k.split(',').map(Number); if(g[y]&&g[y][x]==='#') cands.push({x,y,off:onPath.has(k)?0:1,up:uprightCells.has(k)}); }
  cands.sort((a,b)=>(b.off-a.off)||(rng()-0.5));
  const picks=[];
  for(const c of cands){ if(picks.length>=n) break; if(picks.some(o=>Math.abs(o.x-c.x)+Math.abs(o.y-c.y)<3)) continue; picks.push(c); }
  const padEvery=opt.pads||0;
  let out=def, placed=0;
  for(let take=picks.length;take>=1;take--){
    const gg=def.map.map(r=>r.split(''));
    picks.slice(0,take).forEach((c,i)=>{ gg[c.y][c.x]=(i<padEvery&&c.up)?'X':'*'; });
    const cand=Object.assign({},def,{map:toMap(gg)});
    let CL; try{ CL=parseLevel(cand); }catch(e){ continue; }
    const p2=solve(CL); if(!p2) continue;
    const sp=solveAllStars(CL); if(!sp) continue;
    if(sp.length> base.length*2.6+22) continue;
    out=cand; placed=take; break;
  }
  return out;
}
function uprightReachable(L){
  const s0=initialState(L); const seen=new Set([keyS(s0)]); const q=[s0]; let qi=0; const cells=new Set();
  if(s0.o===0) cells.add(s0.x+','+s0.y);
  while(qi<q.length){ const s=q[qi++];
    for(const d of DIR_LIST){ const r=step(L,s,d); if(r.result==='fall'||r.result==='break') continue;
      const k=keyS(r.state); if(seen.has(k)) continue; seen.add(k);
      if(r.state.o===0) cells.add(r.state.x+','+r.state.y);
      if(r.result!=='win') q.push(r.state); } }
  return cells;
}

// Some tiles (ice above all) are fatal wherever they are not deliberate: a random
// slide walks you off the island. Grow them one at a time instead, keeping only
// placements that leave the level solvable AND land on the optimal route.
function growTiles(def,ch,n,rng,opt){
  opt=opt||{};
  let cur=def, placed=0;
  for(let k=0;k<n;k++){
    const g=cur.map.map(r=>r.split(''));
    let cells=[];
    for(let y=0;y<g.length;y++)for(let x=0;x<g[y].length;x++) if(g[y][x]==='#') cells.push({x,y});
    cells.sort(()=>rng()-0.5);
    if(opt.critical){
      // only ground the block cannot route around: cut it out and the level dies
      cells=cells.filter(c=>{ const gg=cur.map.map(r=>r.split('')); gg[c.y][c.x]='.';
        try{ return !solve(parseLevel(Object.assign({},cur,{map:toMap(gg)}))); }catch(e){ return false; } });
    }
    let took=false;
    for(const c of cells){
      const gg=cur.map.map(r=>r.split('')); gg[c.y][c.x]=ch;
      const trial=Object.assign({},cur,{map:toMap(gg)});
      let L; try{ L=parseLevel(trial); }catch(e){ continue; }
      const p=solve(L); if(!p) continue;
      if(opt.maxPar&&p.length>opt.maxPar) continue;
      const pc=pathCells(L,p);
      let allUsed=true;
      for(let y=0;y<L.h&&allUsed;y++)for(let x=0;x<L.w;x++){ if(trial.map[y][x]===ch&&!pc.has(x+','+y)){ allUsed=false; break; } }
      if(!allUsed) continue;
      cur=trial; placed++; took=true; break;
    }
    if(!took) break;
  }
  return {def:cur,placed};
}
module.exports={genLevel,evaluate,toMap,mulberry,prune,sprinkleStars,growTiles};
if(require.main===module){
  const cfg={w:11,h:9,steps:60,minSpan:6,minPar:14,maxPar:30,attempts:60,noise:.05,feat:[{t:'crumble',n:6},{t:'star',n:2}]};
  for(let s=1;s<40;s++){ const r=genLevel(s,cfg); if(r){ console.log(s,r.ev.par,r.score); console.log(r.def.map.join('\n')); break; } }
}
