// Re-shapes BeanBaron.html for hosting as an Artifact page, which supplies its
// own document skeleton: keep <title>, styles and scripts, drop the wrapper.
//   node tools/beanbaron_artifact.js out.html [BeanBaron.html]
const fs = require('fs'), path = require('path');
const out = process.argv[2] || 'BeanBaron.artifact.html';
let html = fs.readFileSync(process.argv[3] || path.join(__dirname, '..', 'BeanBaron.html'), 'utf8');
html = html.slice(html.indexOf('<title>'));
html = html.replace('</head>\n<body class="noselect">', '').replace('</body>\n</html>', '');
html = html.replace(/<meta[^>]*>\n?/g, '');
// the artifact skeleton owns <body>, so move the body class onto the app root
html = html.replace('<div id="root"></div>', '<div id="root" class="noselect"></div>');
fs.writeFileSync(out, html.trimEnd() + '\n');
console.log('artifact ->', out, '| bytes:', html.length);
