// Assembles CubeRoll from tools/part_*.  One source, three targets:
//   node build.js out.html            -> auto-detecting build
//   node build.js out.html phone      -> locked to the phone layout
//   node build.js out.html desktop    -> locked to the desktop layout
//   node build.js out.html artifact   -> auto-detecting, in Artifact page shape
//                                        (no doctype/html/head/body wrapper)
const fs=require('fs'),p=__dirname;
const R=s=>fs.readFileSync(p+'/'+s,'utf8');
const out=process.argv[2]||(p+'/CubeRoll.html');
const target=process.argv[3]||'auto';
if(!['auto','phone','desktop','artifact'].includes(target)) throw new Error('target must be auto | phone | desktop | artifact');
const artifact = target==='artifact';
const platform = artifact ? 'auto' : target;

const LEVELS=JSON.parse(R('origlevels.json')).concat(JSON.parse(R('newlevels.json')),JSON.parse(R('newlevels2.json')));
const game=R('part_game.js').replace("/*__PLATFORM__*/'auto'", JSON.stringify(platform));
if(platform!=='auto' && game.indexOf(JSON.stringify(platform))<0) throw new Error('platform token not substituted');

const titles={auto:'Cube Roll — 3D Puzzle',phone:'Cube Roll — 3D Puzzle (phone)',desktop:'Cube Roll — 3D Puzzle (desktop)',artifact:'Cube Roll'};
let head=R('part_head.html').replace('<title>Cube Roll — 3D Puzzle</title>','<title>'+titles[target]+'</title>');
if(artifact){
  // The Artifact host supplies the document skeleton, so hand it page content
  // only: title and styles first, then the markup.
  head=head.slice(head.indexOf('<title>'));
  head=head.replace('</head>\n<body>','').replace(/<meta[^>]*>\n?/g,'');
}
const tail = artifact ? '\n' : '\n</body>\n</html>\n';
const html=head
  +'\n<script>\n'+R('mini3d.js')+'\n</script>\n'
  +'<script>\n'+R('rules.js')+'\n</script>\n'
  +'<script>\n'+R('part_forge.js')+'\n</script>\n'
  +'<script>\n'+R('part_content.js')
  +'\nconst LEVELS = '+JSON.stringify(LEVELS)+';\n</script>\n'
  +'<script>\n'+game+'\n</script>'+tail;
fs.writeFileSync(out,html);
console.log(target.padEnd(7),'->',out,'| levels:',LEVELS.length,'| bytes:',html.length);
