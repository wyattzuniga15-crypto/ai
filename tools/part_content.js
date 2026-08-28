// ===== chapters, skins and missions =====
const CHAPTERS=[
  {name:'The Shallows', from:0,  to:9,  blurb:'Learn to roll.'},
  {name:'Cracked Sky',  from:10, to:19, blurb:'Switches, glass and long routes.'},
  {name:'Ashfall',      from:20, to:29, blurb:'Ground that only holds you once.'},
  {name:'Frostline',    from:30, to:39, blurb:'Ice, pins and portals.'},
  {name:'Deep Void',    from:40, to:49, blurb:'Everything at once.'},
];

// unlock: {stars:n} total stars collected | {clear:n} levels cleared | {perfect:n} 3-star ratings | {mission:id}
const SKINS={
  cube:[
    {id:'amber',   name:'Amber',    css:'linear-gradient(135deg,#ffd08a,#ff9a2a)', color:0xffb347, edge:0xfff1c9, emissive:0x3a1e00, metal:.25, rough:.35},
    {id:'ember',   name:'Ember',    css:'linear-gradient(135deg,#ff9d6e,#e0342c)', color:0xff6b4a, edge:0xffd0b0, emissive:0x5a1200, metal:.3,  rough:.35, unlock:{perfect:1}},
    {id:'mint',    name:'Mint',     css:'linear-gradient(135deg,#a7f3d0,#14b8a6)', color:0x4fd6b0, edge:0xd8fff0, emissive:0x064c40, metal:.3,  rough:.3,  unlock:{mission:'star1'}},
    {id:'void',    name:'Void',     css:'linear-gradient(135deg,#4c4a72,#141326)', color:0x2b2a45, edge:0x9b8cff, emissive:0x1d1440, metal:.55, rough:.25, unlock:{mission:'survivor'}},
    {id:'plasma',  name:'Plasma',   css:'linear-gradient(135deg,#c084fc,#4338ca)', color:0x9d6bff, edge:0xe9d5ff, emissive:0x3b0f77, metal:.5,  rough:.22, unlock:{mission:'hunter'}},
    {id:'gold',    name:'Bullion',  css:'linear-gradient(135deg,#fff3b0,#c9971a)', color:0xf5c33b, edge:0xfff8dc, emissive:0x4a3200, metal:.9,  rough:.15, unlock:{mission:'perfectionist'}},
    {id:'obsidian',name:'Obsidian', css:'linear-gradient(135deg,#3b4252,#0b0d14)', color:0x14161f, edge:0x74e0ff, emissive:0x06212b, metal:.75, rough:.12, unlock:{mission:'untouchable'}},
    {id:'quartz',  name:'Quartz',   css:'linear-gradient(135deg,#e0f2fe,#7dd3fc)', color:0xbfe8ff, edge:0xffffff, emissive:0x123a55, metal:.6,  rough:.18, unlock:{mission:'speedrun'}},
    {id:'prism',   name:'Prism',    css:'linear-gradient(135deg,#a5f3fc,#f0abfc,#fde68a)', color:0xdff3ff, edge:0xffffff, emissive:0x2a3a55, metal:.85, rough:.08, unlock:{stars:40}},
  ],
  tile:[
    {id:'azure',   name:'Azure',     css:'linear-gradient(135deg,#7b8fd6,#2c3559)', top:0x4b5f9e, side:0x252d4f, goal:0x1a1f3a, ring:0xffb347},
    {id:'sandstone',name:'Sandstone',css:'linear-gradient(135deg,#e2c391,#8a6a44)', top:0xc9a978, side:0x6d5334, goal:0x3a2b1a, ring:0xffd08a, unlock:{mission:'wanderer'}},
    {id:'jade',    name:'Jade',      css:'linear-gradient(135deg,#8fe3c4,#256b56)', top:0x4fa387, side:0x1e4d3f, goal:0x12302a, ring:0xa7f3d0, unlock:{mission:'star2'}},
    {id:'carbon',  name:'Carbon',    css:'linear-gradient(135deg,#5a6270,#171a21)', top:0x394150, side:0x1b1f28, goal:0x0f1218, ring:0x7dd3fc, unlock:{mission:'noregrets'}},
    {id:'coral',   name:'Coral',     css:'linear-gradient(135deg,#ffb3a7,#a13d5c)', top:0xd97b7b, side:0x6d2f42, goal:0x3a1826, ring:0xffd6a5, unlock:{mission:'glasswork'}},
    {id:'magma',   name:'Magma',     css:'linear-gradient(135deg,#ff9a3d,#4a1004)', top:0xb1481f, side:0x4a1a0c, goal:0x2a0d06, ring:0xffd08a, unlock:{mission:'demolition'}},
    {id:'neon',    name:'Neon',      css:'linear-gradient(135deg,#f0abfc,#3b0764)', top:0x8b3fd6, side:0x3a1264, goal:0x1d0836, ring:0x67e8f9, unlock:{mission:'flawless'}},
  ],
  sky:[
    {id:'nebula',  name:'Nebula',    css:'radial-gradient(circle at 50% 35%,#2b3468,#070a16)', bg1:'#1b2140', bg2:'#070a16', fog:0x0a0d1c, hemiSky:0xbfd4ff, hemiGnd:0x1a1030, sun:0xfff1dc, fill:0x7aa2ff},
    {id:'dusk',    name:'Dusk',      css:'radial-gradient(circle at 50% 35%,#6b3350,#140a16)', bg1:'#4a2340', bg2:'#120814', fog:0x1a0d18, hemiSky:0xffd0c0, hemiGnd:0x2a1030, sun:0xffd7a8, fill:0xff7ab0, unlock:{mission:'explorer'}},
    {id:'aurora',  name:'Aurora',    css:'radial-gradient(circle at 50% 35%,#0f4d52,#04121a)', bg1:'#0e3d46', bg2:'#04101a', fog:0x05161c, hemiSky:0xa7f3d0, hemiGnd:0x06283a, sun:0xd8fff0, fill:0x34d399, unlock:{mission:'star3'}},
    {id:'sunset',  name:'Long Sunset',css:'radial-gradient(circle at 50% 35%,#7a3b12,#1a0a06)', bg1:'#63300f', bg2:'#160805', fog:0x1c0c06, hemiSky:0xffd7a8, hemiGnd:0x3a1408, sun:0xffb37a, fill:0xff9142, unlock:{mission:'pathfinder'}},
    {id:'abyss',   name:'Abyss',     css:'radial-gradient(circle at 50% 35%,#101a34,#01030a)', bg1:'#0b1430', bg2:'#01030a', fog:0x02050f, hemiSky:0x8fb4ff, hemiGnd:0x050a1a, sun:0xcfe3ff, fill:0x3b82f6, unlock:{stars:36}},
    {id:'starfield',name:'Starfield',css:'radial-gradient(circle at 50% 35%,#3b2f6b,#08050f)', bg1:'#2c2358', bg2:'#08050f', fog:0x0b0718, hemiSky:0xe9d5ff, hemiGnd:0x1a0f30, sun:0xfff6ff, fill:0xa78bfa, unlock:{mission:'completionist'}},
  ]
};

// Missions are pure functions of the save file, so they can never drift out of sync.
const MISSIONS=[
  {id:'star1',  icon:'✦', name:'Stargazer I',   desc:'Collect 10 stars across the islands.',        goal:10, val:s=>s.starTotal,   reward:'Mint cube'},
  {id:'star2',  icon:'✧', name:'Stargazer II',  desc:'Collect 25 stars.',                            goal:25, val:s=>s.starTotal,   reward:'Jade tiles'},
  {id:'star3',  icon:'✨', name:'Stargazer III', desc:'Collect 45 stars.',                            goal:45, val:s=>s.starTotal,   reward:'Aurora sky'},
  {id:'explorer',     icon:'🧭', name:'Explorer',      desc:'Clear 15 levels.',                       goal:15, val:s=>s.cleared,     reward:'Dusk sky'},
  {id:'pathfinder',   icon:'🗺️', name:'Pathfinder',    desc:'Clear 35 levels.',                       goal:35, val:s=>s.cleared,     reward:'Long Sunset sky'},
  {id:'completionist',icon:'🏝️', name:'Completionist', desc:'Clear all 50 levels.',                   goal:50, val:s=>s.cleared,     reward:'Starfield sky'},
  {id:'perfectionist',icon:'★',  name:'Perfectionist', desc:'Earn a 3-star rating on 5 levels.',      goal:5,  val:s=>s.perfect,     reward:'Bullion cube'},
  {id:'flawless',     icon:'👑', name:'Flawless',      desc:'Earn a 3-star rating on 15 levels.',     goal:15, val:s=>s.perfect,     reward:'Neon tiles'},
  {id:'hunter',       icon:'💎', name:'Treasure Hunter',desc:'Take every star in 8 different levels.',goal:8,  val:s=>s.allStars,    reward:'Plasma cube'},
  {id:'untouchable',  icon:'🚫', name:'Untouchable',   desc:'Clear 10 levels without asking for a hint.', goal:10, val:s=>s.noHint,  reward:'Obsidian cube'},
  {id:'noregrets',    icon:'↶', name:'No Regrets',     desc:'Clear 5 levels without a single undo.',  goal:5,  val:s=>s.noUndo,     reward:'Carbon tiles'},
  {id:'survivor',     icon:'🪶', name:'Survivor',      desc:'Clear 8 levels without falling once.',   goal:8,  val:s=>s.noFall,     reward:'Void cube'},
  {id:'glasswork',    icon:'🪟', name:'Glasswork',     desc:'Clear 6 glass levels without shattering a pane.', goal:6, val:s=>s.noBreak, reward:'Coral tiles'},
  {id:'demolition',   icon:'💥', name:'Demolition',    desc:'Collapse 40 crumble tiles.',             goal:40, val:s=>s.crumbled,   reward:'Magma tiles'},
  {id:'speedrun',     icon:'⚡', name:'Under Par',      desc:'Finish 20 levels on or under par.',      goal:20, val:s=>s.underPar,   reward:'Quartz cube'},
  {id:'wanderer',     icon:'👣', name:'Wanderer',      desc:'Roll 1,200 moves in total.',             goal:1200,val:s=>s.totalMoves,reward:'Sandstone tiles'},
];
