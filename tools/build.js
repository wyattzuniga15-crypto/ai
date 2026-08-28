const fs=require('fs'),p=__dirname;
const R=s=>fs.readFileSync(p+'/'+s,'utf8');
const orig=JSON.parse(R('origlevels.json'));
const nw=JSON.parse(R('newlevels.json'));
const LEVELS=orig.concat(nw);
const html=R('part_head.html')
  +'\n<script>\n'+R('mini3d.js')+'\n</script>\n'
  +'<script>\n'+R('rules.js')+'\n</script>\n'
  +'<script>\n'+R('part_content.js')
  +'\nconst LEVELS = '+JSON.stringify(LEVELS)+';\n</script>\n'
  +'<script>\n'+R('part_game.js')+'\n</script>\n</body>\n</html>\n';
fs.writeFileSync(process.argv[2]||(p+'/CubeRoll.html'),html);
console.log('levels:',LEVELS.length,'bytes:',html.length);
