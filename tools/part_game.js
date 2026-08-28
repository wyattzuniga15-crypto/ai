(function(){
'use strict';
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const easeOut=t=>1-Math.pow(1-t,3), easeInOut=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;

// ---------- audio ----------
const Snd={ctx:null,on:true,
  init(){ if(this.ctx) return; try{ this.ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} },
  tone(f,dur,type,vol,slide){ if(!this.on||!this.ctx) return; const c=this.ctx; const o=c.createOscillator(), g=c.createGain(); o.type=type||'sine'; o.frequency.setValueAtTime(f,c.currentTime); if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(20,slide),c.currentTime+dur); g.gain.setValueAtTime(vol||.15,c.currentTime); g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+dur); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime+dur+.02); },
  noise(dur,vol,cut){ if(!this.on||!this.ctx) return; const c=this.ctx; const b=c.createBuffer(1,Math.max(1,c.sampleRate*dur),c.sampleRate); const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2); const s=c.createBufferSource(); s.buffer=b; const g=c.createGain(); g.gain.value=vol||.2; const f=c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=cut||900; s.connect(f); f.connect(g); g.connect(c.destination); s.start(); },
  roll(){ this.tone(140,.12,'triangle',.18,90); this.noise(.06,.08); },
  slide(){ this.tone(320,.18,'sine',.07,520); this.noise(.12,.05,3000); },
  fall(){ this.tone(500,.7,'sawtooth',.12,60); },
  crack(){ this.noise(.25,.35); this.tone(1200,.15,'square',.06,300); },
  crumble(){ this.noise(.3,.22,500); this.tone(180,.3,'triangle',.07,70); },
  port(){ [520,780,1040].forEach((f,i)=>setTimeout(()=>this.tone(f,.18,'sine',.09,f*1.6),i*45)); },
  launch(){ this.tone(220,.35,'triangle',.16,900); this.noise(.1,.06,2200); },
  keyGet(){ [1046,1318,1568].forEach((f,i)=>setTimeout(()=>this.tone(f,.22,'triangle',.11),i*70)); },
  sw(){ this.tone(660,.12,'square',.08); setTimeout(()=>this.tone(880,.15,'square',.08),70); },
  star(){ [880,1100,1320,1760].forEach((f,i)=>setTimeout(()=>this.tone(f,.25,'sine',.12),i*60)); },
  win(){ [523,659,784,1047,1319].forEach((f,i)=>setTimeout(()=>this.tone(f,.5,'triangle',.14),i*90)); },
  unlock(){ [659,880,1175,1568].forEach((f,i)=>setTimeout(()=>this.tone(f,.45,'sine',.13),i*110)); },
  bridge(up){ this.tone(up?220:440,.3,'sine',.12,up?440:220); },
  click(){ this.tone(900,.05,'square',.05); }
};

// A slow three-voice pad. Deliberately quiet and off by default.
const Music={nodes:null,timer:null,
  wanted(){ return save.music===true && save.sound!==false; },
  sync(){ if(this.wanted()) this.start(); else this.stop(); },
  start(){ Snd.init(); const c=Snd.ctx; if(!c||this.nodes) return;
    const g=c.createGain(); g.gain.value=0; g.connect(c.destination);
    const f=c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=620; f.Q.value=.7; f.connect(g);
    const oscs=[]; for(let i=0;i<3;i++){ const o=c.createOscillator(); o.type=i===2?'triangle':'sine'; o.frequency.value=110; o.connect(f); o.start(); oscs.push(o); }
    this.nodes={g,f,oscs}; g.gain.linearRampToValueAtTime(.045,c.currentTime+4);
    this.step(); this.timer=setInterval(()=>this.step(),11000); },
  step(){ if(!this.nodes||!Snd.ctx) return; const c=Snd.ctx;
    const CH=[[110,164.81,110],[98,146.83,98],[123.47,185,123.47],[87.31,130.81,87.31],[130.81,196,130.81]];
    const ch=CH[Math.floor(Math.random()*CH.length)];
    this.nodes.oscs.forEach((o,i)=>o.frequency.linearRampToValueAtTime(ch[i]*(i===2?2.005:1),c.currentTime+5));
    this.nodes.f.frequency.linearRampToValueAtTime(420+Math.random()*520,c.currentTime+7); },
  stop(){ if(!this.nodes) return; const c=Snd.ctx, n=this.nodes; this.nodes=null; clearInterval(this.timer);
    try{ n.g.gain.linearRampToValueAtTime(0,c.currentTime+1.5); }catch(e){}
    setTimeout(()=>{ try{ n.oscs.forEach(o=>o.stop()); }catch(e){} },1900); }
};

// ---------- save ----------
const SAVE_KEY='cuberoll.v3';
const DEF_SAVE={best:{},flags:{},unlocked:1,sound:true,camRel:true,shake:true,hintBtn:true,teach:true,music:false,totalMoves:0,crumbled:0,keysTaken:0,launches:0,
  skin:{cube:'amber',tile:'azure',sky:'nebula',trail:'none'},seen:[],
  daily:{date:'',done:false,moves:0,cleared:0,streak:0,last:''},
  endless:{run:0,best:0,cleared:0,seed:0}};
let save=JSON.parse(JSON.stringify(DEF_SAVE));
try{
  const s=JSON.parse(localStorage.getItem(SAVE_KEY))||JSON.parse(localStorage.getItem('cuberoll.v2'));
  if(s&&s.best) save=Object.assign(save,s,{skin:Object.assign({},DEF_SAVE.skin,s.skin||{}),
    daily:Object.assign({},DEF_SAVE.daily,s.daily||{}), endless:Object.assign({},DEF_SAVE.endless,s.endless||{})});
  else { const old=JSON.parse(localStorage.getItem('cuberoll.v1')); if(old&&old.best){ save.best=old.best; save.unlocked=old.unlocked||1; save.sound=old.sound!==false; } }
}catch(e){}
if(!save.flags) save.flags={}; if(!Array.isArray(save.seen)) save.seen=[];
function persist(){ try{ localStorage.setItem(SAVE_KEY,JSON.stringify(save)); }catch(e){} }
Snd.on=save.sound!==false;

// ---------- derived stats & unlocks ----------
function stats(){
  const b=Object.values(save.best), f=Object.values(save.flags);
  const cnt=k=>f.filter(x=>x&&x[k]).length;
  return {
    cleared:b.length,
    perfect:b.filter(x=>x.rating===3).length,
    starTotal:b.reduce((a,x)=>a+(x.stars||0),0),
    totalStars:LEVELS.reduce((a,l)=>a+(l.map.join('').match(/[*X]/g)||[]).length,0),
    allStars:cnt('allstars'), noHint:cnt('nohint'), noUndo:cnt('noundo'), noFall:cnt('nofall'), noBreak:cnt('nobreak'), underPar:cnt('par'),
    crumbled:save.crumbled||0, totalMoves:save.totalMoves||0, keysTaken:save.keysTaken||0, launches:save.launches||0,
    dailyCleared:save.daily.cleared||0, dailyStreak:save.daily.streak||0, endlessBest:save.endless.best||0,
    endlessCleared:save.endless.cleared||0, forged:(save.daily.cleared||0)+(save.endless.cleared||0),
    bestMoves:b.reduce((a,x)=>a+(x.moves||0),0)
  };
}
function missionDone(m,st){ return m.val(st)>=m.goal; }
function skinUnlocked(sk,st){
  if(!sk.unlock) return true; const u=sk.unlock;
  if(u.stars!==undefined) return st.starTotal>=u.stars;
  if(u.clear!==undefined) return st.cleared>=u.clear;
  if(u.perfect!==undefined) return st.perfect>=u.perfect;
  if(u.mission!==undefined){ const m=MISSIONS.find(x=>x.id===u.mission); return !!m&&missionDone(m,st); }
  return true;
}
function unlockText(sk){
  if(!sk.unlock) return 'Unlocked';
  const u=sk.unlock;
  if(u.stars!==undefined) return 'Collect '+u.stars+' stars';
  if(u.clear!==undefined) return 'Clear '+u.clear+' levels';
  if(u.perfect!==undefined) return u.perfect===1?'Earn ★★★ on any level':'Earn ★★★ on '+u.perfect+' levels';
  if(u.mission!==undefined){ const m=MISSIONS.find(x=>x.id===u.mission); return 'Mission: '+(m?m.name:u.mission); }
  return '';
}
function unlockedSet(){ const st=stats(); const s=new Set(); ['cube','tile','sky','trail'].forEach(k=>SKINS[k].forEach(sk=>{ if(skinUnlocked(sk,st)) s.add(k+':'+sk.id); })); MISSIONS.forEach(m=>{ if(missionDone(m,st)) s.add('mission:'+m.id); }); return s; }

// ---------- three setup ----------
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(innerWidth,innerHeight);
document.body.prepend(renderer.domElement);
const scene=new THREE.Scene();
scene.fog=new THREE.FogExp2(0x0a0d1c,0.028);
const camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,0.1,200);
const hemi=new THREE.HemisphereLight(0xbfd4ff,0x1a1030,0.55); scene.add(hemi);
const sun=new THREE.DirectionalLight(0xfff1dc,0.95); sun.position.set(6,14,5); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048); sun.shadow.camera.near=1; sun.shadow.camera.far=60; sun.shadow.bias=-0.0008; sun.shadow.normalBias=0.02;
scene.add(sun); scene.add(sun.target);
const fill=new THREE.PointLight(0x7aa2ff,0.6,40); fill.position.set(-8,6,-6); scene.add(fill);
const world=new THREE.Group(); scene.add(world);

const M={
  floor:new THREE.MeshStandardMaterial({color:0x4b5f9e,sideColor:0x252d4f,roughness:.55,metalness:.15}),
  goal:new THREE.MeshStandardMaterial({color:0x1a1f3a,sideColor:0x2c3559,roughness:.4,metalness:.3,emissive:0x2a1a4a}),
  goalRing:new THREE.MeshStandardMaterial({color:0xffb347,emissive:0xff9a2a,emissiveIntensity:1.4,roughness:.3}),
  goalRingLocked:new THREE.MeshStandardMaterial({color:0x64748b,emissive:0x334155,emissiveIntensity:.7,roughness:.5}),
  fragile:new THREE.MeshStandardMaterial({color:0xffa35e,sideColor:0xb8551c,roughness:.25,metalness:.1,emissive:0x6a2c0c,emissiveIntensity:.5}),
  crumble:new THREE.MeshStandardMaterial({color:0x8b8272,sideColor:0x3d382c,roughness:.98,metalness:.02,emissive:0x1a170f,emissiveIntensity:.2}),
  ice:new THREE.MeshStandardMaterial({color:0x74d4ff,sideColor:0x1f6d99,roughness:.03,metalness:.45,emissive:0x1a7fb0,emissiveIntensity:.85,transparent:true,opacity:.82}),
  pin:new THREE.MeshStandardMaterial({color:0xc084fc,sideColor:0x5b2a8a,roughness:.3,metalness:.3,emissive:0x3b0f66,emissiveIntensity:.6}),
  port:new THREE.MeshStandardMaterial({color:0x1b1233,sideColor:0x2a1b52,roughness:.35,metalness:.4,emissive:0x2a1060,emissiveIntensity:.7}),
  portRing:new THREE.MeshStandardMaterial({color:0xa78bfa,emissive:0x7c3aed,emissiveIntensity:1.5,roughness:.25}),
  starpad:new THREE.MeshStandardMaterial({color:0x6a5a34,sideColor:0x3a3018,roughness:.5,metalness:.2,emissive:0x4a3a00,emissiveIntensity:.5}),
  launch:new THREE.MeshStandardMaterial({color:0x22c55e,sideColor:0x14532d,roughness:.35,metalness:.3,emissive:0x0d5a2a,emissiveIntensity:.8}),
  launchCoil:new THREE.MeshStandardMaterial({color:0xbbf7d0,emissive:0x22c55e,emissiveIntensity:1.2,roughness:.25}),
  keyTile:new THREE.MeshStandardMaterial({color:0x155e6b,sideColor:0x0b3038,roughness:.4,metalness:.3,emissive:0x0a4652,emissiveIntensity:.6}),
  keyMark:new THREE.MeshStandardMaterial({color:0x22d3ee,emissive:0x06b6d4,emissiveIntensity:1.4,roughness:.2,metalness:.5}),
  lock:new THREE.MeshStandardMaterial({color:0xef4444,roughness:.4,metalness:.25,emissive:0x7f1d1d,emissiveIntensity:.7,transparent:true}),
  bridge:new THREE.MeshStandardMaterial({color:0x38bdf8,roughness:.3,metalness:.4,emissive:0x0e5a80,emissiveIntensity:.6,transparent:true}),
  swSoft:new THREE.MeshStandardMaterial({color:0x2dd4bf,emissive:0x0f766e,emissiveIntensity:.8,roughness:.3}),
  swHard:new THREE.MeshStandardMaterial({color:0xf472b6,emissive:0x9d174d,emissiveIntensity:.7,roughness:.3}),
  star:new THREE.MeshStandardMaterial({color:0xffc233,emissive:0xff9500,emissiveIntensity:.9,roughness:.2,metalness:.5}),
  block:new THREE.MeshStandardMaterial({color:0xffb347,roughness:.35,metalness:.25,emissive:0x3a1e00,emissiveIntensity:.35}),
  blockEdge:new THREE.LineBasicMaterial({color:0xfff1c9,transparent:true,opacity:.55}),
};
const tileGeo=new THREE.BoxGeometry(.94,.32,.94);
const bridgeGeo=new THREE.BoxGeometry(.94,.2,.94);
const fragileGeo=new THREE.BoxGeometry(.94,.14,.94);
const crumbleGeo=new THREE.BoxGeometry(.88,.18,.88);
const iceGeo=new THREE.BoxGeometry(.94,.22,.94);
const pinBaseGeo=new THREE.CylinderGeometry(.3,.42,.3,6);
const pinTipGeo=new THREE.CylinderGeometry(.15,.24,.2,6);
const portRingGeo=new THREE.TorusGeometry(.3,.045,8,28);
const coilGeo=new THREE.CylinderGeometry(.22,.3,.1,14);
const keyGeo=new THREE.TorusGeometry(.16,.05,8,18);
const keyStemGeo=new THREE.BoxGeometry(.07,.28,.07);
const blockGeo=new THREE.BoxGeometry(.98,1.98,.98);
const blockEdges=new THREE.EdgesGeometry(blockGeo);
const starGeo=new THREE.OctahedronGeometry(.3,0);
const padStarGeo=new THREE.OctahedronGeometry(.22,0);
const ringGeo=new THREE.TorusGeometry(.32,.05,10,32);
const btnRound=new THREE.CylinderGeometry(.28,.3,.14,24);
const btnSquare=new THREE.BoxGeometry(.52,.14,.52);

// ---------- skins ----------
function hexToHsl(hex){ const r=((hex>>16)&255)/255,g=((hex>>8)&255)/255,b=(hex&255)/255; const mx=Math.max(r,g,b),mn=Math.min(r,g,b); let h=0,s=0,l=(mx+mn)/2; if(mx!==mn){ const d=mx-mn; s=l>.5?d/(2-mx-mn):d/(mx+mn); h=mx===r?((g-b)/d+(g<b?6:0)):mx===g?((b-r)/d+2):((r-g)/d+4); h*=60; } return [h,s*100,l*100]; }
function skinOf(kind,id){ return SKINS[kind].find(s=>s.id===id)||SKINS[kind][0]; }
function applySkins(){
  const c=skinOf('cube',save.skin.cube), t=skinOf('tile',save.skin.tile), k=skinOf('sky',save.skin.sky);
  trailColor=skinOf('trail',save.skin.trail||'none').color;
  M.block.color.set(c.color); M.block.emissive.set(c.emissive); M.block.metalness=c.metal; M.block.roughness=c.rough; M.blockEdge.color.set(c.edge);
  M.floor.color.set(t.top); M.floor.sideColor.set(t.side); M.goal.color.set(t.goal); M.goal.sideColor.set(t.side); M.goalRing.color.set(t.ring); M.goalRing.emissive.set(t.ring);
  scene.fog.color.set(k.fog); hemi.color.set(k.hemiSky); hemi.groundColor.set(k.hemiGnd); sun.color.set(k.sun); fill.color.set(k.fill);
  document.documentElement.style.setProperty('--bg1',k.bg1); document.documentElement.style.setProperty('--bg2',k.bg2);
  applyLevelTint();
}
function applyLevelTint(){
  const k=skinOf('sky',save.skin.sky);
  if(!L){ document.documentElement.style.setProperty('--bg1',k.bg1); document.documentElement.style.setProperty('--bg2',k.bg2); return; }
  const shift=((lvlIndex%10)-4.5)*5;
  const h1=hexToHsl(parseInt(k.bg1.slice(1),16)), h2=hexToHsl(parseInt(k.bg2.slice(1),16));
  document.documentElement.style.setProperty('--bg1',`hsl(${(h1[0]+shift+360)%360},${h1[1].toFixed(0)}%,${h1[2].toFixed(0)}%)`);
  document.documentElement.style.setProperty('--bg2',`hsl(${(h2[0]+shift+360)%360},${h2[1].toFixed(0)}%,${h2[2].toFixed(0)}%)`);
}

// ---------- game state ----------
let trailColor=null, mode='campaign', curDef=null;
let L=null, lvlIndex=0, state=null, history=[], moves=0, busy=false, won=false, tiles=[], bridgeMeshes={}, starMeshes=[], switchMeshes=[], portMeshes=[], keyMeshes=[], lockMeshes=[], center=new THREE.Vector3(), block=null, blockEdgeLines=null, hintMeshes=[], particles=[], hintUsed=false, undoUsed=false, fellCount=0, glassBroken=0, started=false;
const cam={theta:-0.6,phi:0.95,dist:14,target:new THREE.Vector3(),tTheta:-0.6,tPhi:0.95,tDist:14,shake:0};

function tilePos(x,y){ return new THREE.Vector3(x-center.x+.5,0,y-center.z+.5); }
function blockTransform(s){
  const q=new THREE.Quaternion();
  if(s.o===0){ return {pos:tilePos(s.x,s.y).setY(1),quat:q}; }
  if(s.o===1){ q.setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2); return {pos:tilePos(s.x,s.y).add(new THREE.Vector3(.5,0,0)).setY(.5),quat:q}; }
  q.setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2); return {pos:tilePos(s.x,s.y).add(new THREE.Vector3(0,0,.5)).setY(.5),quat:q};
}
function clearWorld(){ while(world.children.length) world.remove(world.children[0]); tiles=[]; bridgeMeshes={}; starMeshes=[]; switchMeshes=[]; portMeshes=[]; keyMeshes=[]; lockMeshes=[]; hintMeshes=[]; particles=[]; }

function dayKey(d){ d=d||new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function daySeed(k){ let h=2166136261; for(let i=0;i<k.length;i++){ h^=k.charCodeAt(i); h=Math.imul(h,16777619); } return (h>>>0)%100000000; }
let dailyDef=null, dailyKey='';
function getDaily(){ const k=dayKey(); if(dailyDef&&dailyKey===k) return dailyDef; const r=Forge.forge(daySeed(k),8); dailyKey=k; dailyDef=r.def; if(dailyDef) dailyDef.name='Daily — '+dailyDef.name; return dailyDef; }
function loadLevel(i,opts){ mode='campaign'; lvlIndex=clamp(i,0,LEVELS.length-1); loadDef(LEVELS[lvlIndex],opts); }
function loadDaily(){ const d=getDaily(); if(!d){ toast('Could not forge today\'s island — try again.'); return; } mode='daily'; closeOverlays(); loadDef(d,{}); }
function loadEndless(){
  if(!save.endless.seed){ save.endless.seed=Math.floor(Math.random()*1e8); save.endless.run=0; persist(); }
  $('ovForge').classList.add('show');
  setTimeout(()=>{
    const r=Forge.forge(save.endless.seed+save.endless.run*7717, save.endless.run);
    closeOverlays();
    if(!r.def){ toast('Could not forge an island — try again.'); return; }
    r.def.name='Island '+(save.endless.run+1)+' — '+r.def.name;
    mode='endless'; loadDef(r.def,{});
  },40);
}
function loadDef(def,opts){
  opts=opts||{}; queued=[]; curDef=def; L=parseLevel(def); state=initialState(L);
  history=[]; moves=0; won=false; busy=false; hintUsed=false; undoUsed=false; fellCount=0; glassBroken=0; started=true;
  clearWorld();
  center.set(L.w/2,0,L.h/2);
  applyLevelTint();
  const delayBase=performance.now();
  for(let y=0;y<L.h;y++) for(let x=0;x<L.w;x++){ const t=L.tiles[y][x]; if(t.type==='void') continue;
    const g=new THREE.Group(); g.position.copy(tilePos(x,y)); world.add(g);
    let m, ci=null;
    if(t.type==='fragile'){ m=new THREE.Mesh(fragileGeo,M.fragile); m.position.y=-.07; const cr=new THREE.LineSegments(new THREE.EdgesGeometry(fragileGeo),new THREE.LineBasicMaterial({color:0xffd9b0,transparent:true,opacity:.5})); cr.position.y=-.07; g.add(cr); }
    else if(t.type==='crumble'){ ci=t.ci; m=new THREE.Mesh(crumbleGeo,M.crumble); m.position.y=-.09; const cr=new THREE.LineSegments(new THREE.EdgesGeometry(crumbleGeo),new THREE.LineBasicMaterial({color:0x14110b,transparent:true,opacity:.85})); cr.position.y=-.09; g.add(cr); }
    else if(t.type==='ice'){ m=new THREE.Mesh(iceGeo,M.ice); m.position.y=-.11; const cr=new THREE.LineSegments(new THREE.EdgesGeometry(iceGeo),new THREE.LineBasicMaterial({color:0xeafaff,transparent:true,opacity:.9})); cr.position.y=-.11; g.add(cr); }
    else if(t.type==='pin'){ m=new THREE.Mesh(pinBaseGeo,M.pin); m.position.y=-.15; const tip=new THREE.Mesh(pinTipGeo,M.pin); tip.position.y=.1; tip.castShadow=true; g.add(tip); }
    else if(t.type==='port'){ m=new THREE.Mesh(tileGeo,M.port); m.position.y=-.16; const r=new THREE.Mesh(portRingGeo,M.portRing); r.rotation.x=Math.PI/2; r.position.y=.03; g.add(r); g.userData.pring=r; portMeshes.push({g,x,y,ring:r,pi:t.pi}); const pl=new THREE.PointLight(0x8b5cf6,.9,3.5); pl.position.y=.5; g.add(pl); }
    else if(t.type==='launch'){ m=new THREE.Mesh(tileGeo,M.launch); m.position.y=-.16; const c1=new THREE.Mesh(coilGeo,M.launchCoil); c1.position.y=.04; const c2=new THREE.Mesh(coilGeo,M.launchCoil); c2.position.y=.15; c2.scale.setScalar(.8); g.add(c1); g.add(c2); g.userData.coil=[c1,c2]; }
    else if(t.type==='keytile'){ m=new THREE.Mesh(tileGeo,M.keyTile); m.position.y=-.16; }
    else if(t.type==='lock'){ m=new THREE.Mesh(bridgeGeo,M.lock.clone()); m.position.y=-.1; const gh=new THREE.LineSegments(new THREE.EdgesGeometry(bridgeGeo),new THREE.LineBasicMaterial({color:0xfca5a5,transparent:true,opacity:.5})); gh.position.y=-.1; g.add(gh); lockMeshes.push({mesh:m,ghost:gh,group:g,x,y,anim:0}); }
    else if(t.type==='bridge'){ m=new THREE.Mesh(bridgeGeo,M.bridge.clone()); m.position.y=-.1; const gh=new THREE.LineSegments(new THREE.EdgesGeometry(bridgeGeo),new THREE.LineBasicMaterial({color:0x7dd3fc,transparent:true,opacity:.4})); gh.position.y=-.1; g.add(gh); (bridgeMeshes[t.group]=bridgeMeshes[t.group]||[]).push({mesh:m,group:g,x,y,ghost:gh}); }
    else if(t.type==='starpad'){ m=new THREE.Mesh(tileGeo,M.starpad); m.position.y=-.16; const r=new THREE.Mesh(ringGeo,M.goalRing); r.rotation.x=Math.PI/2; r.position.y=.02; r.scale.setScalar(.8); g.add(r); g.userData.pad=r; }
    else { m=new THREE.Mesh(tileGeo,t.type==='goal'?M.goal:M.floor); m.position.y=-.16; }
    m.castShadow=true; m.receiveShadow=true; g.add(m);
    if(t.type==='goal'){ const r=new THREE.Mesh(ringGeo,L.lockGoal?M.goalRingLocked:M.goalRing); r.rotation.x=Math.PI/2; r.position.y=.02; g.add(r); g.userData.ring=r; const pl=new THREE.PointLight(0xffa040,1.2,4); pl.position.y=.6; g.add(pl); g.userData.goalLight=pl; }
    if(t.type==='switch'){ const b=new THREE.Mesh(t.hard?btnSquare:btnRound,t.hard?M.swHard:M.swSoft); b.position.y=.07; b.castShadow=true; g.add(b); switchMeshes.push({mesh:b,x,y,hard:t.hard}); }
    g.userData.spawn={t0:delayBase+(Math.hypot(x-L.start.x,y-L.start.y))*55, dur:420}; g.position.y=-3; g.scale.setScalar(.01);
    tiles.push({g,x,y,type:t.type,ci});
  }
  L.keys.forEach((p,i)=>{
    const grp=new THREE.Group(); grp.position.copy(tilePos(p.x,p.y)).setY(.55);
    const ring=new THREE.Mesh(keyGeo,M.keyMark); const stem=new THREE.Mesh(keyStemGeo,M.keyMark); stem.position.y=-.22;
    grp.add(ring); grp.add(stem); grp.rotation.x=Math.PI/2; world.add(grp); keyMeshes.push({mesh:grp,i,got:false});
  });
  L.stars.forEach((p,i)=>{
    if(p.pad){ const s=new THREE.Mesh(padStarGeo,M.star); s.position.copy(tilePos(p.x,p.y)).setY(.42); s.castShadow=true; s.scale.set(.9,1.3,.9); world.add(s); starMeshes.push({mesh:s,i,got:false,pad:true,px:p.x,py:p.y}); }
    else { const s=new THREE.Mesh(starGeo,M.star); s.position.copy(tilePos(p.x,p.y)).setY(.7); s.castShadow=true; s.scale.set(.7,1.25,.7); world.add(s); starMeshes.push({mesh:s,i,got:false,pad:false}); }
  });
  Object.keys(bridgeMeshes).forEach(g=>{ const open=isSolid(L,{type:'bridge',group:g},state); bridgeMeshes[g].forEach(b=>{ b.open=open; b.anim=open?1:0; }); });
  lockMeshes.forEach(m=>{ m.open=(state.keys===L.allKeys); m.anim=m.open?1:0; });
  block=new THREE.Mesh(blockGeo,M.block); block.castShadow=true; block.receiveShadow=true; blockEdgeLines=new THREE.LineSegments(blockEdges,M.blockEdge); block.add(blockEdgeLines); world.add(block);
  const bt=blockTransform(state); block.position.copy(bt.pos).setY(bt.pos.y+6); block.quaternion.copy(bt.quat); block.userData.drop={t0:delayBase+400,dur:600,from:bt.pos.y+6,to:bt.pos.y};
  const asp=Math.max(.6,Math.min(2.2,innerWidth/innerHeight)); const span=Math.max(L.w*1.55/asp,L.h*1.25); cam.tDist=clamp(span*0.95+5,9,44); if(!opts.keepCam){ cam.tTheta=-0.55; cam.tPhi=0.95; }
  cam.target.set(0,0,0);
  sun.target.position.set(0,0,0); const sc=sun.shadow.camera; const ext=Math.max(L.w,L.h)*0.75+2; sc.left=-ext; sc.right=ext; sc.top=ext; sc.bottom=-ext; sc.updateProjectionMatrix();
  $('hud').classList.add('on');
  updateHUD(); $('hint').innerHTML='<em>'+def.name+'</em> — '+L.hint;
  showMsg('');
  setTimeout(maybeTeach,700);
}

function updateHUD(){
  $('lvl').textContent = mode==='campaign' ? ('Level '+(lvlIndex+1)+' / '+LEVELS.length)
    : mode==='daily' ? ('Daily challenge · '+dayKey()) : ('Endless · island '+((save.endless.run||0)+1));
  $('name').textContent=curDef.name; $('moves').textContent=moves; $('par').textContent=curDef.par;
  const b=mode==='campaign'?save.best[lvlIndex]:null; $('best').textContent=b?b.moves:'—';
  let s=''; L.stars.forEach((_,i)=>{ s+=(state.stars&(1<<i))?'★':'☆'; });
  if(L.lockGoal&&L.stars.length&&state.stars!==(1<<L.stars.length)-1) s+=' 🔒';
  if(L.keys.length){ let k=''; L.keys.forEach((_,i)=>{ k+=(state.keys&(1<<i))?'🔑':'🗝'; }); s+=(s?'  ':'')+k; }
  $('stars').textContent=s;
}
let msgT=null; function showMsg(t,ms){ const m=$('msg'); m.textContent=t; m.style.opacity=t?1:0; clearTimeout(msgT); if(t&&ms) msgT=setTimeout(()=>m.style.opacity=0,ms); }
let toastQ=[],toastT=null;
function toast(t){ toastQ.push(t); if(!toastT) nextToast(); }
function nextToast(){ const m=$('toast'); if(!toastQ.length){ toastT=null; m.style.opacity=0; return; } m.innerHTML=toastQ.shift(); m.style.opacity=1; toastT=setTimeout(()=>{ m.style.opacity=0; setTimeout(nextToast,260); },1700); }

// ---------- input mapping ----------
function camDir(d){
  if(!save.camRel) return d;
  const f=new THREE.Vector3(); camera.getWorldDirection(f); f.y=0; f.normalize();
  const r=new THREE.Vector3().crossVectors(f,new THREE.Vector3(0,1,0)).normalize();
  let v; if(d==='up') v=f; else if(d==='down') v=f.clone().negate(); else if(d==='right') v=r; else v=r.clone().negate();
  if(Math.abs(v.x)>Math.abs(v.z)) return v.x>0?'right':'left'; return v.z>0?'down':'up';
}

// ---------- moves ----------
let queued=[];
function tryMove(screenDir){
  if(won||!L||!started) return; if(busy){ if(queued.length<8) queued.push(screenDir); return; } Snd.init();
  const dir=camDir(screenDir); const r=step(L,state,dir);
  const prevState=state; history.push({state:prevState,moves});
  clearHints();
  moves++; busy=true; save.totalMoves=(save.totalMoves||0)+1;
  playMove(prevState,dir,r);
}
function playMove(s0,dir,r){
  runActions(r.events,0,s0,dir,()=>{
    state=r.state; updateHUD();
    if(r.result==='fall'){ fellCount++; animateFall(dir,'fall'); return; }
    if(r.result==='break'){ fellCount++; glassBroken++; breakTile(r.state.x,r.state.y); animateFall(dir,'break'); return; }
    if(r.result==='win'){ queued=[]; winLevel(); return; }
    busy=false; persistSoon();
    if(queued.length) tryMove(queued.shift());
    else stuckSoon();
  });
}
function runActions(list,i,cur,dir,finish){
  if(i>=list.length){ finish(cur); return; }
  const ev=list[i];
  switch(ev.type){
    case 'roll': animateRoll(cur,dir,ev.to,()=>runActions(list,i+1,ev.to,dir,finish)); return;
    case 'port': animatePort(cur,ev,()=>runActions(list,i+1,{x:ev.tx,y:ev.ty,o:0},dir,finish)); return;
    case 'launch': animateLaunch(cur,ev,()=>runActions(list,i+1,{x:ev.tx,y:ev.ty,o:0},dir,finish)); return;
    case 'crumble': crumbleTile(ev.x,ev.y); break;
    case 'key': takeKey(ev.i,ev.x,ev.y); break;
    case 'unlock': syncLocks(L.allKeys,true); toast('🔑 Every key taken — the gates are solid'); break;
    case 'star': collectStar(ev.i); break;
    case 'switch': Snd.sw(); pressSwitch(ev.x,ev.y); break;
    case 'toggle': syncBridges(ev.mask,true); break;
    case 'slide': Snd.slide(); break;
    case 'sealed': showMsg('Sealed — claim every star',900); break;
  }
  runActions(list,i+1,cur,dir,finish);
}
function spawnTrail(pos){ if(trailColor==null) return; const geo=new THREE.BoxGeometry(.09,.09,.09);
  for(let i=0;i<3;i++){ const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:trailColor})); m.position.copy(pos); m.position.y+=.2+Math.random()*.6;
    m.userData.v=new THREE.Vector3((Math.random()-.5)*.8,Math.random()*1.2+.2,(Math.random()-.5)*.8); m.userData.life=.8; world.add(m); particles.push(m); } }
function animateRoll(s0,dir,s1,done){
  Snd.roll(); spawnTrail(blockTransform(s0).pos);
  const t0=blockTransform(s0), t1=blockTransform(s1);
  const [dx,dz]=DIRS[dir]; const half=(s0.o===0)?.5:((dir==='left'||dir==='right')?(s0.o===1?1:.5):(s0.o===2?1:.5));
  const pivot=t0.pos.clone().add(new THREE.Vector3(dx*half,-t0.pos.y,dz*half));
  const axis=new THREE.Vector3(dz,0,-dx).normalize();
  const start=performance.now(), dur=150;
  const qa=new THREE.Quaternion();
  block.userData.anim=(now)=>{
    const k=clamp((now-start)/dur,0,1), a=easeInOut(k)*Math.PI/2;
    qa.setFromAxisAngle(axis,a);
    const off=t0.pos.clone().sub(pivot).applyQuaternion(qa);
    block.position.copy(pivot).add(off); block.quaternion.copy(qa).multiply(t0.quat);
    if(k>=1){ block.userData.anim=null; block.position.copy(t1.pos); block.quaternion.copy(t1.quat); block.position.y+=-.06; block.userData.squash={t0:now,st:s1}; done(); }
  };
}
function animateLaunch(cur,ev,done){
  Snd.launch(); save.launches=(save.launches||0)+1;
  spawnBurst(tilePos(ev.fx,ev.fy).setY(.35),0x22c55e,16);
  const start=performance.now(), dur=330; const p0=blockTransform({x:ev.fx,y:ev.fy,o:0}).pos, t1=blockTransform({x:ev.tx,y:ev.ty,o:0});
  block.userData.anim=(now)=>{
    const k=clamp((now-start)/dur,0,1);
    block.position.set(p0.x+(t1.pos.x-p0.x)*k, p0.y+(t1.pos.y-p0.y)*k+Math.sin(k*Math.PI)*2.4, p0.z+(t1.pos.z-p0.z)*k);
    block.rotation.y=k*Math.PI*2;
    if(k>=1){ block.userData.anim=null; block.rotation.set(0,0,0); block.position.copy(t1.pos); block.quaternion.copy(t1.quat); block.userData.squash={t0:now,st:{x:ev.tx,y:ev.ty,o:0}}; done(); }
  };
}
function animatePort(cur,ev,done){
  Snd.port(); spawnBurst(tilePos(ev.fx,ev.fy).setY(.4),0xa78bfa,18);
  const start=performance.now(), dur=260; const t1=blockTransform({x:ev.tx,y:ev.ty,o:0});
  const p0=block.position.clone();
  block.userData.anim=(now)=>{
    const k=clamp((now-start)/dur,0,1);
    if(k<.5){ const e=k/.5; block.scale.setScalar(1-e*.95); block.position.copy(p0); block.rotation.y=e*6; }
    else { const e=(k-.5)/.5; block.scale.setScalar(.05+e*.95); block.position.copy(t1.pos); block.rotation.y=(1-e)*6; }
    if(k>=1){ block.userData.anim=null; block.scale.setScalar(1); block.rotation.set(0,0,0); block.position.copy(t1.pos); block.quaternion.copy(t1.quat); spawnBurst(t1.pos.clone(),0xa78bfa,18); done(); }
  };
}
function animateFall(dir,kind){
  if(kind==='fall') Snd.fall(); else Snd.crack();
  if(save.shake) cam.shake=kind==='fall'?.35:.5;
  const [dx,dz]=DIRS[dir]; const start=performance.now(); const p0=block.position.clone(); const q0=block.quaternion.clone();
  const axis=new THREE.Vector3(dz,0,-dx); const spin=new THREE.Quaternion();
  showMsg(kind==='fall'?'Fell off!':'Crack!',1200);
  block.userData.anim=(now)=>{
    const t=(now-start)/1000; block.position.set(p0.x+dx*t*1.5, p0.y-9.8*t*t*0.9+(kind==='break'?-t:0), p0.z+dz*t*1.5);
    spin.setFromAxisAngle(axis,t*2.5); block.quaternion.copy(spin).multiply(q0);
    if(t>0.9){ block.userData.anim=null; rewind(); }
  };
}
function rewind(){
  const last=history.pop(); if(last){ state=last.state; moves=last.moves; }
  applyStateInstant(); const bt=blockTransform(state); block.position.y=bt.pos.y+4; block.userData.drop={t0:performance.now(),dur:450,from:bt.pos.y+4,to:bt.pos.y}; busy=false; queued=[];
  stuckSoon();
}
function applyStateInstant(){
  const bt=blockTransform(state); block.position.copy(bt.pos); block.quaternion.copy(bt.quat); block.scale.setScalar(1); block.rotation.set(0,0,0); block.userData.drop=null; block.userData.anim=null; block.userData.squash=null;
  syncBridges(state.mask,false); syncLocks(state.keys,false);
  keyMeshes.forEach(k=>{ k.got=!!(state.keys&(1<<k.i)); k.mesh.visible=!k.got; });
  starMeshes.forEach(s=>{ s.got=!!(state.stars&(1<<s.i)); s.mesh.visible=!s.got; });
  if(L.lockGoal) updateGoalLockSilent();
  tiles.forEach(t=>{
    if(t.ci!=null){ const gone=!!(state.crumb&(1<<t.ci)); t.g.visible=!gone; if(!gone){ t.g.userData.shatter=null; t.g.position.y=0; t.g.rotation.x=0; t.g.rotation.z=0; } }
    else if(t.g.userData.shatter){ t.g.userData.shatter=null; t.g.visible=true; t.g.position.y=0; t.g.rotation.x=0; t.g.rotation.z=0; }
  });
  updateHUD();
}
function undo(){ queued=[]; if(busy||won||!history.length) return; Snd.click(); undoUsed=true; const h=history.pop(); state=h.state; moves=h.moves; clearHints(); applyStateInstant(); }
function syncBridges(mask,animated){
  Object.keys(bridgeMeshes).forEach(g=>{ const open=isSolid(L,{type:'bridge',group:g},{mask,crumb:0,keys:0}); bridgeMeshes[g].forEach(b=>{ if(b.open!==open){ b.open=open; if(animated) Snd.bridge(open); } if(!animated) b.anim=open?1:0; }); });
}
function pressSwitch(x,y){ const s=switchMeshes.find(m=>m.x===x&&m.y===y); if(s) s.press=performance.now(); spawnBurst(tilePos(x,y).setY(.2),0x7ff7e0,10); }
function collectStar(i){ const s=starMeshes[i]; if(!s||s.got) return; s.got=true; s.mesh.visible=false; Snd.star(); spawnBurst(s.mesh.position.clone(),0xffd166,26); toast('★ Star collected'); if(L.lockGoal) updateGoalLock(); }
function updateGoalLockSilent(){
  const open=!L.lockGoal||state.stars===(1<<L.stars.length)-1;
  const gt=tiles.find(t=>t.type==='goal'); if(gt&&gt.g.userData.ring) gt.g.userData.ring.material=open?M.goalRing:M.goalRingLocked;
  return open;
}
function updateGoalLock(){ if(updateGoalLockSilent()&&L.lockGoal) toast('The goal is open'); }
function takeKey(i,x,y){ const k=keyMeshes[i]; if(!k||k.got) return; k.got=true; k.mesh.visible=false; Snd.keyGet(); save.keysTaken=(save.keysTaken||0)+1; spawnBurst(tilePos(x,y).setY(.5),0x22d3ee,20); toast('🔑 Key '+(i+1)+' of '+L.keys.length); }
function syncLocks(keys,animated){ const open=keys===L.allKeys; lockMeshes.forEach(m=>{ if(m.open!==open){ m.open=open; if(animated) Snd.bridge(open); } if(!animated) m.anim=open?1:0; }); }
function breakTile(x,y){ const t=tiles.find(t=>t.x===x&&t.y===y); if(!t) return; t.g.userData.shatter=performance.now(); spawnBurst(tilePos(x,y),0xf08a3c,22); }
function crumbleTile(x,y){ const t=tiles.find(t=>t.x===x&&t.y===y); if(!t||t.g.userData.shatter) return; t.g.userData.shatter=performance.now(); Snd.crumble(); spawnBurst(tilePos(x,y),0xc9b394,16); save.crumbled=(save.crumbled||0)+1; }
function spawnBurst(pos,color,n){ const geo=new THREE.BoxGeometry(.12,.12,.12); for(let i=0;i<n;i++){ const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color})); m.position.copy(pos); m.userData.v=new THREE.Vector3((Math.random()-.5)*5,Math.random()*5+1,(Math.random()-.5)*5); m.userData.life=1; world.add(m); particles.push(m); } }

let persistT=null; function persistSoon(){ clearTimeout(persistT); persistT=setTimeout(persist,400); }
let stuckWarned=false, stuckT=null;
function stuckSoon(){ clearTimeout(stuckT); stuckT=setTimeout(checkStuck,500); }
function checkStuck(){
  // crumble tiles are the only thing that can strand you for good; everything
  // else is reversible, so there is nothing to warn about.
  if(won||busy||!L||!L.crumbles.length) return;
  try{ if(!canFinish(L,state,9000)){ if(!stuckWarned){ stuckWarned=true; toast('No route left from here — undo (Z) or restart (R)'); } } else stuckWarned=false; }catch(e){}
}

// ---------- win ----------
function winLevel(){
  won=true; Snd.win();
  const par=curDef.par; const nStars=L.stars.length; const gotStars=L.stars.filter((_,i)=>state.stars&(1<<i)).length;
  let rating=1; if(moves<=par) rating=3; else if(moves<=par+4) rating=2;
  const before=unlockedSet();
  if(mode==='campaign'){
    const prev=save.best[lvlIndex];
    save.best[lvlIndex]={moves:Math.min(moves,prev?prev.moves:1e9),stars:Math.max(gotStars,prev?prev.stars||0:0),rating:Math.max(rating,prev?prev.rating||0:0)};
    const hasGlass=L.tiles.some(r=>r.some(t=>t.type==='fragile'));
    const f=save.flags[lvlIndex]||{};
    if(!hintUsed) f.nohint=1; if(!undoUsed) f.noundo=1; if(fellCount===0) f.nofall=1;
    if(nStars&&gotStars===nStars) f.allstars=1; if(hasGlass&&glassBroken===0) f.nobreak=1; if(moves<=par) f.par=1;
    save.flags[lvlIndex]=f;
    save.unlocked=Math.max(save.unlocked,lvlIndex+2);
  } else if(mode==='daily'){
    const k=dayKey();
    if(save.daily.date!==k||!save.daily.done){
      const yest=new Date(Date.now()-86400000);
      save.daily.streak=(save.daily.last===dayKey(yest))?(save.daily.streak||0)+1:1;
      save.daily.cleared=(save.daily.cleared||0)+1; save.daily.last=k;
    }
    save.daily.date=k; save.daily.done=true; save.daily.moves=Math.min(save.daily.moves||1e9,moves); save.daily.rating=Math.max(save.daily.rating||0,rating);
  } else {
    save.endless.run=(save.endless.run||0)+1;
    save.endless.cleared=(save.endless.cleared||0)+1;
    save.endless.best=Math.max(save.endless.best||0,save.endless.run);
  }
  persist();
  const after=unlockedSet(); const gained=[...after].filter(x=>!before.has(x));

  const start=performance.now(); const p0=block.position.clone();
  block.userData.anim=(now)=>{ const k=clamp((now-start)/700,0,1); block.position.y=p0.y-easeInOut(k)*2.2; block.rotation.y=k*Math.PI*.5; if(k>=1) block.userData.anim=null; };
  spawnBurst(tilePos(L.goal.x,L.goal.y).setY(.3),0xffb347,40);
  setTimeout(()=>{
    $('winTitle').textContent = mode==='endless' ? ('Streak '+save.endless.run+'!') : (rating===3?'Perfect!':(rating===2?'Nice!':'Level complete'));
    $('winStars').innerHTML=[1,2,3].map(i=>`<span class="${i<=rating?'':'off'}">★</span>`).join('');
    $('winText').innerHTML=`${moves} moves &middot; par ${par}`+(nStars?` &middot; ${gotStars}/${nStars} stars`:'')
      +(mode==='daily'?`<br><small style="opacity:.8">Daily streak: ${save.daily.streak} day${save.daily.streak===1?'':'s'}</small>`:'')
      +(mode==='endless'?`<br><small style="opacity:.8">Best streak: ${save.endless.best}</small>`:'')
      +(moves>par&&mode!=='endless'?`<br><small style="opacity:.75">Beat par for a perfect run.</small>`:'');
    $('winUnlocks').innerHTML=gained.length?gained.map(g=>{
      if(g.startsWith('mission:')){ const m=MISSIONS.find(x=>x.id===g.slice(8)); return `<div class="mission done"><div class="mi">${m.icon}</div><div class="mb"><div class="mt">Mission complete — ${m.name}</div><div class="md">${m.reward} unlocked</div></div></div>`; }
      const [kind,id]=g.split(':'); const sk=skinOf(kind,id); const label={cube:'Cube',tile:'Tile set',sky:'Sky',trail:'Trail'}[kind];
      return `<div class="mission done"><div class="mi">🎁</div><div class="mb"><div class="mt">New skin — ${sk.name}</div><div class="md">${label} unlocked. Equip it in the menu.</div></div></div>`;
    }).join(''):'';
    if(gained.length) Snd.unlock();
    $('bNext').textContent = mode==='endless' ? 'Next island ▶' : mode==='daily' ? 'Back to menu' : 'Next level ▶';
    if(mode==='campaign'&&lvlIndex>=LEVELS.length-1){ const st=stats(); $('endText').innerHTML=`All ${LEVELS.length} islands cleared — <b>${st.perfect}</b> perfect, <b>${st.starTotal}/${st.totalStars}</b> stars, <b>${MISSIONS.filter(m=>missionDone(m,st)).length}/${MISSIONS.length}</b> missions.<br><small style="opacity:.8">Endless and the daily challenge are still forging new islands.</small>`; $('ovEnd').classList.add('show'); }
    else $('ovWin').classList.add('show');
  },900);
}

// ---------- first-encounter coaching ----------
const TEACH={
  fragile:{icon:'🪟',title:'Glass',body:'Glass holds a block lying flat across it, and shatters the moment you stand upright on one.'},
  switch:{icon:'🎛️',title:'Switches and bridges',body:'A round switch flips its bridge on any contact. A square one needs your full weight — the block has to be standing upright on it.'},
  crumble:{icon:'🪨',title:'Crumble',body:'Crumble tiles hold you exactly once. The moment you roll off, they fall away. Plan a route that never needs to come back.'},
  starpad:{icon:'✦',title:'Star pads',body:'A star pad only pays out when the block is standing upright on it. Rolling across does nothing.'},
  ice:{icon:'❄️',title:'Ice',body:'You cannot stop on ice. Roll onto it and you keep going the same way until you leave it — or run out of island.'},
  pin:{icon:'📍',title:'Pins',body:'A pin is a spire of rock. It holds the block standing upright, and drops it the moment it lies down across one.'},
  port:{icon:'🌀',title:'Portals',body:'Land upright on a portal and it throws you to its twin. Lying across one does nothing at all.'},
  launch:{icon:'🪂',title:'Springs',body:'Land upright on a spring and it fires you three tiles further the way you were going — straight over whatever gap is in between.'},
  keytile:{icon:'🔑',title:'Keys and gates',body:'Red gates are thin air until you are holding every key on the island. Keys are never optional — the route runs through them.'},
};
function maybeTeach(){
  if(save.teach===false||!L||won) return;
  const present=new Set(); L.tiles.forEach(r=>r.forEach(t=>present.add(t.type)));
  if(L.lockGoal) present.add('sealed');
  let pick=null;
  for(const k of Object.keys(TEACH)) if(present.has(k)&&save.seen.indexOf(k)<0){ pick=k; break; }
  if(!pick&&L.lockGoal&&save.seen.indexOf('sealed')<0){ pick='sealed'; }
  if(!pick) return;
  const t = pick==='sealed' ? {icon:'🔒',title:'Sealed goal',body:'This goal stays shut until every star on the island is claimed. Here the stars are not optional — they are the level.'} : TEACH[pick];
  save.seen.push(pick); persist();
  $('teachIcon').textContent=t.icon; $('teachTitle').textContent=t.title; $('teachBody').textContent=t.body;
  closeOverlays(); $('ovTeach').classList.add('show');
}
$('bTeachOk').onclick=()=>{ Snd.click(); closeOverlays(); };

// ---------- hints ----------
function clearHints(){ hintMeshes.forEach(m=>world.remove(m)); hintMeshes=[]; }
function showHint(){ if(busy||won||!L) return; Snd.click(); clearHints(); const path=solve(L,state); if(!path){ toast('No way out from here — undo or reset.'); return; }
  hintUsed=true; let s=state; const geo=new THREE.PlaneGeometry(.9,.9); const steps=Math.min(3,path.length);
  for(let i=0;i<steps;i++){ s=step(L,s,path[i]).state; cellsOf(s).forEach(([x,y])=>{ const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:i===0?0xffffff:0x9fb0ff,transparent:true,opacity:i===0?.6:.28,depthWrite:false})); m.rotation.x=-Math.PI/2; m.position.copy(tilePos(x,y)).setY(.03+i*.005); m.userData.hint=i; world.add(m); hintMeshes.push(m); }); }
  toast(`Hint: ${path.length} moves to go. First move: ${path[0]}`);
}

// ---------- menu ----------
function starsOf(lv){ return (lv.map.join('').match(/[*X]/g)||[]).length; }
const MECH=[['F','🪟','Glass'],['O','🪨','Crumble'],['^','❄️','Ice'],['P','📍','Pins'],['T','🌀','Portals'],['J','🪂','Springs'],['K','🔑','Keys'],['X','✦','Star pads']];
function mechOf(lv){
  const flat=lv.map.join(''); const out=[];
  for(const [ch,icon,name] of MECH) if(flat.indexOf(ch)>=0) out.push([icon,name]);
  if(/[1-8]/.test(flat)) out.push(['🎛️','Switches']);
  if(lv.lockGoal) out.push(['🔒','Sealed goal']);
  return out;
}
function openMenu(tab){ buildMenu(); if(tab) selectTab(tab); closeOverlays(); $('ovMenu').classList.add('show'); }
function selectTab(t){ document.querySelectorAll('#menuTabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t)); document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.id==='pane'+t)); $('ovMenu').querySelector('.panel').scrollTop=0; }
document.querySelectorAll('#menuTabs button').forEach(b=>b.onclick=()=>{ Snd.click(); selectTab(b.dataset.tab); });

function buildMenu(){ const st=stats(); buildTally(st); buildPlay(st); buildLevelGrid(); buildChallenge(st); buildMissions(st); buildSkins(st); buildStats(st); buildSettings(); }
function buildTally(st){
  $('menuTally').innerHTML=`
    <div><b>${st.cleared}/${LEVELS.length}</b><span>Cleared</span></div>
    <div><b>${st.starTotal}/${st.totalStars}</b><span>Stars</span></div>
    <div><b>${st.perfect}</b><span>Perfect</span></div>
    <div><b>${MISSIONS.filter(m=>missionDone(m,st)).length}/${MISSIONS.length}</b><span>Missions</span></div>`;
}
function buildPlay(st){
  const next=clamp(save.unlocked-1,0,LEVELS.length-1);
  const ch=CHAPTERS.find(c=>next>=c.from&&next<=c.to)||CHAPTERS[0];
  $('playBlurb').innerHTML= st.cleared? `You have cleared <b>${st.cleared}</b> of ${LEVELS.length} islands. Next stop: <b>${ch.name}</b>.${st.endlessBest?` Best endless streak: <b>${st.endlessBest}</b>.`:''}` : `Roll the block across the floating islands and land it upright in the goal. ${LEVELS.length} hand-checked islands, eleven kinds of ground, ${MISSIONS.length} side quests — and a fresh island forged every day.`;
  $('bContinue').textContent = st.cleared? `Continue — Level ${next+1} ▶` : 'Start ▶';
  const lv=LEVELS[next], b=save.best[next];
  $('nextCard').innerHTML=`<div class="mission"><div class="mi">${next+1}</div><div class="mb"><div class="mt">${lv.name}</div><div class="md">${lv.hint}</div></div><div class="mr">par ${lv.par}${starsOf(lv)?'<br>'+starsOf(lv)+'★ here':''}${b?'<br>best '+b.moves:''}</div></div>`;
  const open=MISSIONS.filter(m=>!missionDone(m,st)).sort((a,b2)=>(b2.val(st)/b2.goal)-(a.val(st)/a.goal))[0];
  $('featMission').innerHTML= open? missionHTML(open,st) : `<div class="mission done"><div class="mi">🏆</div><div class="mb"><div class="mt">Every mission complete</div><div class="md">Nothing left but your own records.</div></div></div>`;
}
function buildLevelGrid(){
  const host=$('lvGrid'); host.innerHTML='';
  CHAPTERS.forEach(ch=>{
    const done=LEVELS.slice(ch.from,ch.to+1).filter((_,i)=>save.best[ch.from+i]).length;
    const head=document.createElement('div'); head.className='chapter';
    head.innerHTML=`<div class="cn">${ch.name}</div><div class="cl"></div><div class="cp">${done}/${ch.to-ch.from+1} · ${ch.blurb}</div>`;
    host.appendChild(head);
    const g=document.createElement('div'); g.className='grid';
    for(let i=ch.from;i<=ch.to&&i<LEVELS.length;i++){
      const lv=LEVELS[i], b=save.best[i], locked=i+1>save.unlocked;
      const d=document.createElement('div'); d.className='lv'+(locked?' locked':'')+(b?' done':'');
      const ns=starsOf(lv);
      d.innerHTML=`<div class="n">${locked?'🔒':i+1}</div><div class="t">${locked?'Locked':lv.name}</div>`+
        `<div class="s">${b?'★'.repeat(b.rating||1)+'<span style="color:rgba(255,255,255,.15)">'+'★'.repeat(3-(b.rating||1))+'</span> '+b.moves:''}</div>`+
        `<div class="g">${ns?((b?b.stars||0:0)+'/'+ns+' ✦'):''}</div>`+
        `<div class="mx">${locked?'':mechOf(lv).map(m=>`<i title="${m[1]}">${m[0]}</i>`).join('')}</div>`;
      if(!locked) d.onclick=()=>{ Snd.click(); closeOverlays(); loadLevel(i); };
      g.appendChild(d);
    }
    host.appendChild(g);
  });
}
function buildChallenge(st){
  const k=dayKey(); const doneToday=save.daily.date===k&&save.daily.done;
  const d=getDaily();
  $('dailyCard').innerHTML=`<div class="mission${doneToday?' done':''}"><div class="mi">${doneToday?'✔':'📅'}</div><div class="mb">`+
    `<div class="mt">${d?d.name.replace(/^Daily — /,''):'Unavailable'}</div>`+
    `<div class="md">${doneToday?('Cleared in '+save.daily.moves+' moves.'):'One island a day, the same one for everybody. Par '+(d?d.par:'?')+'.'}</div>`+
    `</div><div class="mr">streak ${save.daily.streak||0}<br>${save.daily.cleared||0} cleared</div></div>`;
  $('bDaily').textContent=doneToday?"Replay today's island ▶":"Play today's island ▶";
  const run=save.endless.run||0;
  $('endlessCard').innerHTML=`<div class="mission"><div class="mi">♾️</div><div class="mb">`+
    `<div class="mt">${run?('Run in progress — island '+(run+1)+' next'):'No run in progress'}</div>`+
    `<div class="md">Each island is harder than the last. There is no way to lose it — only to stop.</div>`+
    `<div class="bar"><i style="width:${Math.min(100,run/25*100)}%"></i></div>`+
    `</div><div class="mr">best ${save.endless.best||0}<br>${save.endless.cleared||0} cleared</div></div>`;
  $('bEndless').textContent=run?('Continue — island '+(run+1)+' ▶'):'Start run ▶';
  $('bEndlessReset').style.display=run?'':'none';
}
function missionHTML(m,st){
  const v=Math.min(m.val(st),m.goal), done=v>=m.goal, pct=Math.round(v/m.goal*100);
  return `<div class="mission${done?' done':''}"><div class="mi">${done?'✔':m.icon}</div><div class="mb"><div class="mt">${m.name}</div><div class="md">${m.desc}</div><div class="bar"><i style="width:${pct}%"></i></div></div><div class="mr">${v} / ${m.goal}<br>${m.reward}</div></div>`;
}
function buildMissions(st){ $('missionList').innerHTML=MISSIONS.map(m=>missionHTML(m,st)).join(''); }
function buildSkins(st){
  [['cube','skinCube'],['tile','skinTile'],['sky','skinSky'],['trail','skinTrail']].forEach(([kind,host])=>{
    $(host).innerHTML=SKINS[kind].map(sk=>{
      const ok=skinUnlocked(sk,st), on=save.skin[kind]===sk.id;
      return `<div class="skin${on?' on':''}${ok?'':' locked'}" data-kind="${kind}" data-id="${sk.id}" data-ok="${ok?1:0}"><div class="chip" style="background:${sk.css}"></div><div class="sn">${ok?sk.name:'🔒 '+sk.name}</div><div class="sd">${on?'Equipped':(ok?'Tap to equip':unlockText(sk))}</div></div>`;
    }).join('');
    $(host).querySelectorAll('.skin').forEach(el=>el.onclick=()=>{
      if(el.dataset.ok!=='1'){ Snd.click(); toast('Locked — '+unlockText(skinOf(el.dataset.kind,el.dataset.id))); return; }
      Snd.click(); save.skin[el.dataset.kind]=el.dataset.id; persist(); applySkins(); buildSkins(stats()); toast(skinOf(el.dataset.kind,el.dataset.id).name+' equipped');
    });
  });
}
function buildStats(st){
  const rows=[['Levels cleared',`${st.cleared} / ${LEVELS.length}`],['Perfect (★★★) runs',st.perfect],['Stars collected',`${st.starTotal} / ${st.totalStars}`],
    ['Levels fully starred',st.allStars],['Levels beaten on or under par',st.underPar],['Hint-free clears',st.noHint],['Undo-free clears',st.noUndo],
    ['Clears without falling',st.noFall],['Glass levels with no breakage',st.noBreak],['Crumble tiles collapsed',st.crumbled],['Total moves rolled',st.totalMoves],
    ['Sum of best runs',st.bestMoves],['Missions complete',`${MISSIONS.filter(m=>missionDone(m,st)).length} / ${MISSIONS.length}`],
    ['Skins unlocked',`${['cube','tile','sky','trail'].reduce((a,k)=>a+SKINS[k].filter(s=>skinUnlocked(s,st)).length,0)} / ${['cube','tile','sky','trail'].reduce((a,k)=>a+SKINS[k].length,0)}`]];
  $('statTable').innerHTML=rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
}
function setToggle(id,key,onLabel,offLabel,after){
  const b=$(id); const paint=()=>b.textContent=save[key]?(onLabel||'On'):(offLabel||'Off');
  b.onclick=()=>{ save[key]=!save[key]; persist(); paint(); Snd.click(); if(after) after(); }; paint();
}
function buildSettings(){
  setToggle('setSound','sound','On','Off',()=>{ Snd.on=save.sound; $('bSound').textContent=Snd.on?'🔊':'🔇'; Music.sync(); });
  setToggle('setCamRel','camRel','On','Off');
  setToggle('setShake','shake','On','Off');
  setToggle('setHintBtn','hintBtn','On','Off',()=>{ $('bHint').style.display=save.hintBtn?'':'none'; });
  setToggle('setTeach','teach','On','Off');
  setToggle('setMusic','music','On','Off',()=>Music.sync());
  $('setUnlockAll').onclick=()=>{ save.unlocked=LEVELS.length; persist(); buildMenu(); toast('Every level unlocked'); };
  $('setWipe').onclick=()=>{ if(!confirm('Erase all progress, stars, missions and skins?')) return; const snd=save.sound; save=JSON.parse(JSON.stringify(DEF_SAVE)); save.sound=snd; persist(); applySkins(); buildMenu(); toast('Progress erased'); };
}
function closeOverlays(){ document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show')); }

$('bContinue').onclick=()=>{ Snd.init(); Music.sync(); Snd.click(); closeOverlays(); loadLevel(clamp(save.unlocked-1,0,LEVELS.length-1)); };
$('bPlayLevels').onclick=()=>{ Snd.init(); Snd.click(); selectTab('levels'); };
$('bPlayMissions').onclick=()=>{ Snd.init(); Snd.click(); selectTab('missions'); };
$('bPlayChallenge').onclick=()=>{ Snd.init(); Snd.click(); selectTab('challenge'); };
$('bDaily').onclick=()=>{ Snd.init(); Snd.click(); loadDaily(); };
$('bEndless').onclick=()=>{ Snd.init(); Snd.click(); loadEndless(); };
$('bEndlessReset').onclick=()=>{ if(!confirm('Abandon this endless run? Your best streak is kept.')) return; save.endless.run=0; save.endless.seed=0; persist(); buildMenu(); toast('Run abandoned'); };
$('bMenu').onclick=()=>{ Snd.click(); openMenu(); };
$('bWinMenu').onclick=()=>openMenu();
$('bEndMenu').onclick=()=>openMenu();
$('bUndo').onclick=undo;
$('bReset').onclick=()=>{ if(busy&&!won) return; Snd.click(); if(mode==='campaign') loadLevel(lvlIndex,{keepCam:true}); else loadDef(curDef,{keepCam:true}); };
$('bHint').onclick=showHint;
$('bNext').onclick=()=>{ closeOverlays();
  if(mode==='endless') loadEndless();
  else if(mode==='daily') openMenu('challenge');
  else loadLevel(lvlIndex+1); };
$('bRetry').onclick=()=>{ closeOverlays(); if(mode==='campaign') loadLevel(lvlIndex,{keepCam:true}); else loadDef(curDef,{keepCam:true}); };
$('bEndReplay').onclick=()=>{ closeOverlays(); loadLevel(0); };
$('bSound').onclick=()=>{ save.sound=!save.sound; Snd.on=save.sound; persist(); $('bSound').textContent=Snd.on?'🔊':'🔇'; buildSettings(); Music.sync(); };
$('bSound').textContent=Snd.on?'🔊':'🔇';
$('bHint').style.display=save.hintBtn===false?'none':'';
document.querySelectorAll('#dpad button').forEach(b=>b.addEventListener('pointerdown',e=>{ e.preventDefault(); tryMove(b.dataset.d); }));

addEventListener('keydown',e=>{
  const k=e.key.toLowerCase(); const anyOverlay=document.querySelector('.overlay.show');
  if(anyOverlay){
    if(k==='enter'||k===' '){ if($('ovWin').classList.contains('show')) $('bNext').click(); else if($('ovMenu').classList.contains('show')) $('bContinue').click(); }
    if(k==='escape'){ if($('ovMenu').classList.contains('show')){ if(started){ closeOverlays(); } } else openMenu(); }
    return;
  }
  const map={arrowup:'up',w:'up',arrowdown:'down',s:'down',arrowleft:'left',a:'left',arrowright:'right',d:'right'};
  if(map[k]){ e.preventDefault(); tryMove(map[k]); }
  else if(k==='z'||k==='u') undo(); else if(k==='r') $('bReset').click(); else if(k==='h') showHint();
  else if(k==='escape') openMenu(); else if(k==='l') openMenu('levels'); else if(k==='m') $('bSound').click();
  else if(k==='n'&&won) $('bNext').click();
});

let drag=null; const cv=renderer.domElement;
cv.addEventListener('pointerdown',e=>{ drag={x:e.clientX,y:e.clientY,sx:e.clientX,sy:e.clientY,t:performance.now(),moved:0}; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove',e=>{ if(!drag) return; const dx=e.clientX-drag.x, dy=e.clientY-drag.y; drag.x=e.clientX; drag.y=e.clientY; drag.moved+=Math.abs(dx)+Math.abs(dy);
  if(e.pointerType==='touch') return;
  cam.tTheta-=dx*0.006; cam.tPhi=clamp(cam.tPhi-dy*0.005,0.35,1.35); });
cv.addEventListener('pointerup',e=>{ if(!drag) return; const dx=e.clientX-drag.sx, dy=e.clientY-drag.sy; const dist=Math.hypot(dx,dy);
  if(e.pointerType==='touch'){ if(dist>28&&performance.now()-drag.t<600){ if(Math.abs(dx)>Math.abs(dy)) tryMove(dx>0?'right':'left'); else tryMove(dy>0?'down':'up'); } else if(dist>28){ cam.tTheta-=dx*0.006; cam.tPhi=clamp(cam.tPhi-dy*0.005,0.35,1.35); } }
  drag=null; });
cv.addEventListener('wheel',e=>{ cam.tDist=clamp(cam.tDist*(1+Math.sign(e.deltaY)*0.08),6,50); },{passive:true});
addEventListener('resize',()=>{ renderer.setSize(innerWidth,innerHeight); camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); });
addEventListener('beforeunload',persist);

// ---------- render loop ----------
let last=performance.now();
function frame(now){
  requestAnimationFrame(frame); const dt=Math.min(.05,(now-last)/1000); last=now;
  cam.theta+=(cam.tTheta-cam.theta)*Math.min(1,dt*8); cam.phi+=(cam.tPhi-cam.phi)*Math.min(1,dt*8); cam.dist+=(cam.tDist-cam.dist)*Math.min(1,dt*5);
  if(cam.shake>0) cam.shake=Math.max(0,cam.shake-dt*1.6);
  const sh=cam.shake*cam.shake;
  camera.position.set(cam.target.x+cam.dist*Math.sin(cam.phi)*Math.sin(cam.theta)+(Math.random()-.5)*sh, cam.target.y+cam.dist*Math.cos(cam.phi)+(Math.random()-.5)*sh, cam.target.z+cam.dist*Math.sin(cam.phi)*Math.cos(cam.theta)+(Math.random()-.5)*sh);
  camera.lookAt(cam.target);
  if(!L){ renderer.render(scene,camera); return; }
  for(const t of tiles){ const sp=t.g.userData.spawn; if(sp){ const k=clamp((now-sp.t0)/sp.dur,0,1); const e=easeOut(k); t.g.position.y=-3*(1-e); t.g.scale.setScalar(.01+.99*e); if(k>=1){ t.g.userData.spawn=null; t.g.position.y=0; t.g.scale.setScalar(1);} }
    const shv=t.g.userData.shatter; if(shv){ const k=(now-shv)/1000; t.g.position.y=-k*k*12; t.g.rotation.x=k*3; t.g.rotation.z=k*2; if(k>1.4) t.g.visible=false; }
    if(t.g.userData.ring){ t.g.userData.ring.rotation.z+=dt*1.2; t.g.userData.ring.scale.setScalar(1+Math.sin(now*0.004)*.06); }
    if(t.g.userData.pad){ t.g.userData.pad.rotation.z-=dt*1.6; }
    if(t.g.userData.coil){ const b=Math.sin(now*.005+t.x*.7)*.05; t.g.userData.coil[0].position.y=.04+b; t.g.userData.coil[1].position.y=.15+b*1.8; }
    if(t.g.userData.pring){ t.g.userData.pring.rotation.z+=dt*2.4; t.g.userData.pring.scale.setScalar(1+Math.sin(now*0.005+t.x)*.12); } }
  Object.values(bridgeMeshes).forEach(arr=>arr.forEach(b=>{ const target=b.open?1:0; b.anim+=(target-b.anim)*Math.min(1,dt*7); const a=b.anim; b.mesh.position.y=-.1-(1-a)*0.9; b.mesh.material.opacity=0.12+0.88*a; b.mesh.material.emissiveIntensity=0.15+0.6*a; if(b.ghost){ b.ghost.material.opacity=0.35*(1-a)+0.15; b.ghost.position.y=b.mesh.position.y; } }));
  lockMeshes.forEach(m=>{ const target=m.open?1:0; m.anim+=(target-m.anim)*Math.min(1,dt*7); const a=m.anim;
    // a closed gate has to read as an obstacle, not as absence, so it stays visible
    m.mesh.position.y=-.1-(1-a)*0.34; m.mesh.material.opacity=0.30+0.70*a; m.mesh.material.emissiveIntensity=0.35+0.5*a;
    if(m.ghost){ m.ghost.material.opacity=0.85-0.35*a; m.ghost.position.y=m.mesh.position.y; } });
  keyMeshes.forEach(k=>{ if(k.got) return; k.mesh.rotation.z+=dt*2.2; k.mesh.position.y=.55+Math.sin(now*.003+k.i)*.09; });
  switchMeshes.forEach(s=>{ const p=s.press?clamp((now-s.press)/250,0,1):1; s.mesh.position.y=.07-.05*Math.sin(p*Math.PI); });
  starMeshes.forEach(s=>{ if(s.got) return; s.mesh.rotation.y+=dt*2; s.mesh.rotation.x=Math.sin(now*.002)*.3; s.mesh.position.y=(s.pad?.4:.6)+Math.sin(now*.003+s.i)*(s.pad?.05:.1); });
  hintMeshes.forEach(m=>{ m.material.opacity=(m.userData.hint===0?.5:.22)+Math.sin(now*.008)*.15; });
  if(block){ if(block.userData.anim) block.userData.anim(now);
    else if(block.userData.drop){ const d=block.userData.drop; const k=clamp((now-d.t0)/d.dur,0,1); const e=k<1?1-Math.pow(1-k,2):1; block.position.y=d.from+(d.to-d.from)*e; if(k>=1){ block.userData.drop=null; Snd.roll(); block.userData.squash={t0:now,st:state}; } }
    else if(block.userData.squash){ const sq0=block.userData.squash; const k=clamp((now-sq0.t0)/160,0,1); const sq=1-Math.sin(k*Math.PI)*.06; const st=sq0.st||state; const bt=blockTransform(st); block.scale.set(1+(1-sq)*.5,sq,1+(1-sq)*.5); block.position.copy(bt.pos); block.position.y=bt.pos.y-(1-sq)*(st.o===0?1:.5); if(k>=1){ block.userData.squash=null; block.scale.set(1,1,1); block.position.copy(bt.pos); } }
    M.block.emissiveIntensity=.35+Math.sin(now*.003)*.1; }
  for(let i=particles.length-1;i>=0;i--){ const p=particles[i]; p.userData.life-=dt*1.4; if(p.userData.life<=0){ world.remove(p); particles.splice(i,1); continue; } p.userData.v.y-=9.8*dt; p.position.addScaledVector(p.userData.v,dt); p.rotation.x+=dt*5; p.rotation.y+=dt*4; p.scale.setScalar(Math.max(.01,p.userData.life)); }
  renderer.render(scene,camera);
}
applySkins();
buildMenu();
requestAnimationFrame(frame);
window.LEVELS=LEVELS;
window.__game={get L(){return L}, curDef:()=>curDef, loadDaily, loadEndless, get state(){return state}, tryMove, loadLevel, solve:()=>solve(L,state), get busy(){return busy}, get won(){return won}, get moves(){return moves}, save:()=>save, stats, camDir, openMenu};
})();
