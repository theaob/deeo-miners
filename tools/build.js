// Bundles the game into a single self-contained HTML file: dist/deeo-miners.html
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/, (m, f) =>
  '<style>\n' + fs.readFileSync(path.join(root, f), 'utf8') + '</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, f) =>
  '<script>\n' + fs.readFileSync(path.join(root, f), 'utf8') + '</script>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'deeo-miners.html'), html);
console.log('wrote dist/deeo-miners.html (' + html.length + ' bytes)');
