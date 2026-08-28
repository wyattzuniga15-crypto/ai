const fs=require('fs');
Object.assign(global, eval(fs.readFileSync(__dirname+'/rules.js','utf8')+";({parseLevel,initialState,cellsOf,roll,tileAt,isSolid,step,key,keyS,solve,solveAllStars,DIRS,DIR_LIST})"));
const {genLevel,growTiles,placeKeys,sprinkleStars,mulberry,countEvents}=require('./gen.js');
const F=(t,n)=>({t,n}); const SB=(idx,hard,group,span)=>({t:'switchbridge',idx,hard,group,span});
const out=JSON.parse(fs.readFileSync(__dirname+'/newlevels2.json','utf8'));
const cur=out[19]; const curL=parseLevel(cur); const curPar=solve(curL).length;
let best={score:(curPar>=40?100:0)+countEvents(curL,solve(curL),'launch')*20-Math.abs(curPar-45),def:cur,opt:curPar,keep:true};
const cfg={w:15,h:11,steps:94,minSpan:10,minPar:30,maxPar:62,attempts:70,noise:.05,relax:2,targetPar:42,
           feat:[SB(0,false,'a',3),F('crumble',5),F('port',2)]};
const t0=Date.now();
for(let s=0;s<20000 && Date.now()-t0<240000;s++){
  let g=null; try{ g=genLevel(1500000+s*41,cfg); }catch(e){ continue; }
  if(!g) continue;
  let def=g.def;
  const ic=growTiles(def,'^',3,mulberry(s+5),{maxPar:62}); if(ic.placed<3) continue; def=ic.def;
  const j=growTiles(def,'J',2,mulberry(s+11),{maxPar:62,mustFire:'launch'});
  if(j.placed<1) continue; def=j.def;
  const l=growTiles(def,'L',2,mulberry(s+17),{maxPar:62,critical:true}); if(l.placed<1) continue; def=l.def;
  const kk=placeKeys(def,2,mulberry(s+23),{maxPar:64,wantPar:44}); if(kk.placed<1) continue; def=kk.def;
  def=Object.assign({},def,{lockGoal:true});
  const ws=sprinkleStars(def,3,mulberry(s+29),{pads:1});
  let L,optp; try{ L=parseLevel(ws); optp=solve(L); }catch(e){ continue; }
  if(!optp) continue;
  if(L.stars.length&&!solveAllStars(L)) continue;
  const fires=countEvents(L,optp,'launch');
  const score=(optp.length>=40?100:0)+fires*20-Math.abs(optp.length-45);
  if(score>best.score) best={score,def:ws,opt:optp.length,fires,keep:false};
  if(best.score>=135) break;
}
if(best.keep){ console.error('kept existing Terminus (par '+curPar+')'); }
else {
  const lv={name:'Terminus',hint:'The last island. It has kept every trick for you.',par:best.opt+Math.floor(best.opt/12),map:best.def.map,lockGoal:true};
  if(best.def.links) lv.links=best.def.links;
  out[19]=lv;
  const flat=lv.map.join(''),c=ch=>flat.split(ch).length-1;
  console.error('Terminus par='+lv.par+' fires='+best.fires+' J'+c('J')+' K'+c('K')+' L'+c('L')+' ice'+c('^')+' O'+c('O')+' T'+c('T'));
}
fs.writeFileSync(__dirname+'/newlevels2.json',JSON.stringify(out));
console.error('saved');
