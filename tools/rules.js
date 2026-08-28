// ===== CUBE ROLL — shared game core (no DOM) =====
// Level legend:
//  .  void      #  floor      S start (upright)   G goal (block must stand upright on it)
//  F  fragile / glass  (shatters if the block stands upright on it)
//  O  crumble  (one-use: collapses the moment you roll off it)
//  ^  ice      (you keep sliding the same way until you leave the ice)
//  P  pin      (a needle of rock: only holds the block standing upright)
//  T  portal   (pairs in reading order 1<->2, 3<->4; fires when you land upright)
//  *  star     (collectible, any contact)
//  X  star pad (a star you must claim standing upright)
//  1-4 soft switch (any contact)   5-8 hard switch (upright only)
//  a-f bridge tile, closed at start   A-E bridge tile, open at start
//  links: { '1': 'a' } => switch 1 toggles bridge group a (letters, case-insensitive)
//  lockGoal: true => the goal stays sealed until every star on the level is claimed
const DIRS = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };
const DIR_LIST = ['up','down','left','right'];

function parseLevel(def){
  const rows = def.map; const h = rows.length; const w = Math.max(...rows.map(r=>r.length));
  const tiles = []; let start=null, goal=null; const stars=[]; const groups={}; const switches={}; const crumbles=[]; const ports=[];
  for(let y=0;y<h;y++){ tiles[y]=[]; for(let x=0;x<w;x++){
    const c = rows[y][x] || '.'; let t={type:'void'};
    if(c==='#') t={type:'floor'};
    else if(c==='S'){ t={type:'floor'}; start={x,y}; }
    else if(c==='G'){ t={type:'goal'}; goal={x,y}; }
    else if(c==='F') t={type:'fragile'};
    else if(c==='O'){ t={type:'crumble', ci:crumbles.length}; crumbles.push({x,y}); }
    else if(c==='^') t={type:'ice'};
    else if(c==='P') t={type:'pin'};
    else if(c==='T'){ t={type:'port', pi:ports.length}; ports.push({x,y}); }
    else if(c==='*'){ t={type:'floor', star:true}; stars.push({x,y,pad:false}); }
    else if(c==='X'){ t={type:'starpad'}; stars.push({x,y,pad:true}); }
    else if(c>='1'&&c<='8'){ t={type:'switch', hard:c>='5', id:c}; switches[c]=(def.links||{})[c]||''; }
    else if(/[a-fA-F]/.test(c)){ const g=c.toLowerCase(); t={type:'bridge', group:g, openInit:c===c.toUpperCase()}; (groups[g]=groups[g]||[]).push({x,y,openInit:t.openInit}); }
    tiles[y][x]=t; }}
  if(!start||!goal) throw new Error('level missing S or G: '+def.name);
  if(crumbles.length>28) throw new Error('too many crumble tiles: '+def.name);
  if(stars.length>8) throw new Error('too many stars: '+def.name);
  const groupNames = Object.keys(groups).sort();
  let initMask=0; groupNames.forEach((g,i)=>{ if(groups[g][0].openInit) initMask|=(1<<i); });
  const lockGoal=!!def.lockGoal && stars.length>0;
  return { name:def.name, hint:def.hint||'', w,h,tiles,start,goal,stars,groups,groupNames,switches,initMask,crumbles,ports,lockGoal };
}

// state: {x,y,o,mask,stars,crumb}  o: 0 upright, 1 lying along x (x,x+1), 2 lying along y (y,y+1)
function initialState(L){ return {x:L.start.x,y:L.start.y,o:0,mask:L.initMask,stars:0,crumb:0}; }
function cellsOf(s){ if(s.o===0) return [[s.x,s.y]]; if(s.o===1) return [[s.x,s.y],[s.x+1,s.y]]; return [[s.x,s.y],[s.x,s.y+1]]; }
function roll(s,dir){
  const {x,y,o}=s;
  switch(o){
    case 0: if(dir==='left') return {x:x-2,y,o:1}; if(dir==='right') return {x:x+1,y,o:1}; if(dir==='up') return {x,y:y-2,o:2}; return {x,y:y+1,o:2};
    case 1: if(dir==='left') return {x:x-1,y,o:0}; if(dir==='right') return {x:x+2,y,o:0}; if(dir==='up') return {x,y:y-1,o:1}; return {x,y:y+1,o:1};
    default: if(dir==='up') return {x,y:y-1,o:0}; if(dir==='down') return {x,y:y+2,o:0}; if(dir==='left') return {x:x-1,y,o:2}; return {x:x+1,y,o:2};
  }
}
function tileAt(L,x,y){ if(y<0||y>=L.h||x<0||x>=L.w) return {type:'void'}; return L.tiles[y][x]; }
function isSolid(L,t,s){
  if(t.type==='void') return false;
  if(t.type==='bridge'){ const i=L.groupNames.indexOf(t.group); return !!(s.mask&(1<<i)); }
  if(t.type==='crumble') return !(s.crumb&(1<<t.ci));
  return true;
}
// returns {state, result:'ok'|'fall'|'break'|'win', events:[]}
function step(L,s,dir){
  const ev=[]; let cur=s; let guard=0;
  for(;;){
    const n=roll(cur,dir); n.mask=cur.mask; n.stars=cur.stars; n.crumb=cur.crumb;
    // tiles we just rolled off: crumble tiles collapse behind us
    for(const [cx,cy] of cellsOf(cur)){ const t=tileAt(L,cx,cy); if(t.type==='crumble' && !(n.crumb&(1<<t.ci))){ n.crumb|=(1<<t.ci); ev.push({type:'crumble',x:cx,y:cy}); } }
    const cells=cellsOf(n);
    for(const [cx,cy] of cells){ if(!isSolid(L,tileAt(L,cx,cy),n)) return {state:n,result:'fall',events:ev}; }
    if(n.o===0 && tileAt(L,n.x,n.y).type==='fragile') return {state:n,result:'break',events:ev};
    if(n.o!==0){ for(const [cx,cy] of cells){ if(tileAt(L,cx,cy).type==='pin') return {state:n,result:'fall',events:ev}; } }
    ev.push({type:'roll',to:{x:n.x,y:n.y,o:n.o}});
    // stars
    for(const [cx,cy] of cells){ const si=L.stars.findIndex(p=>p.x===cx&&p.y===cy&&(!p.pad||n.o===0)); if(si>=0 && !(n.stars&(1<<si))){ n.stars|=(1<<si); ev.push({type:'star',i:si}); } }
    // switches
    let toggle=0;
    for(const [cx,cy] of cells){ const t=tileAt(L,cx,cy); if(t.type==='switch' && (!t.hard || n.o===0)){ ev.push({type:'switch',id:t.id,x:cx,y:cy}); for(const g of (L.switches[t.id]||'')){ const i=L.groupNames.indexOf(g.toLowerCase()); if(i>=0) toggle|=(1<<i); } } }
    if(toggle){ n.mask^=toggle; ev.push({type:'toggle',bits:toggle,mask:n.mask}); }
    // portals fire only under a standing block
    if(n.o===0){ const t=tileAt(L,n.x,n.y); if(t.type==='port'){ const dest=L.ports[t.pi^1]; if(dest){ ev.push({type:'port',fx:n.x,fy:n.y,tx:dest.x,ty:dest.y}); n.x=dest.x; n.y=dest.y; } } }
    // goal
    if(n.o===0 && n.x===L.goal.x && n.y===L.goal.y){
      if(!L.lockGoal || n.stars===(1<<L.stars.length)-1) return {state:n,result:'win',events:ev};
      ev.push({type:'sealed'});
    }
    // ice keeps you moving
    const slick=cellsOf(n).some(([cx,cy])=>tileAt(L,cx,cy).type==='ice');
    if(slick && guard++<24){ ev.push({type:'slide'}); cur=n; continue; }
    return {state:n,result:'ok',events:ev};
  }
}
function key(s){ return s.x+','+s.y+','+s.o+','+s.mask+','+s.crumb; }
function keyS(s){ return key(s)+','+s.stars; }
// BFS: shortest solution. Star state is tracked only when the level needs it.
function solve(L, from){
  const kf = L.lockGoal ? keyS : key;
  const s0 = from ? {x:from.x,y:from.y,o:from.o,mask:from.mask,stars:from.stars||0,crumb:from.crumb||0} : initialState(L);
  const prev=new Map(); prev.set(kf(s0),null); const q=[s0]; let qi=0;
  while(qi<q.length){ const s=q[qi++];
    for(const d of DIR_LIST){ const r=step(L,s,d); if(r.result==='fall'||r.result==='break') continue; const k=kf(r.state);
      if(prev.has(k)) continue; prev.set(k,{k:kf(s),d});
      if(r.result==='win'){ const path=[]; let cur=k; while(prev.get(cur)){ const p=prev.get(cur); path.push(p.d); cur=p.k; } return path.reverse(); }
      q.push(r.state); } }
  return null;
}
// BFS collecting every star and then the goal. Returns path or null.
function solveAllStars(L, from){
  if(!L.stars.length) return solve(L, from);
  const s0 = from ? {x:from.x,y:from.y,o:from.o,mask:from.mask,stars:from.stars||0,crumb:from.crumb||0} : initialState(L);
  const all=(1<<L.stars.length)-1;
  const prev=new Map(); prev.set(keyS(s0),null); const q=[s0]; let qi=0;
  while(qi<q.length){ const s=q[qi++];
    for(const d of DIR_LIST){ const r=step(L,s,d); if(r.result==='fall'||r.result==='break') continue; const k=keyS(r.state);
      if(prev.has(k)) continue; prev.set(k,{k:keyS(s),d});
      if(r.result==='win'){ if(r.state.stars===all){ const path=[]; let cur=k; while(prev.get(cur)){ const p=prev.get(cur); path.push(p.d); cur=p.k; } return path.reverse(); } continue; }
      q.push(r.state); } }
  return null;
}
