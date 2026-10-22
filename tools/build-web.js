// Baut eine statische Fassung (Ordner dist/) für beliebiges https-Webhosting, z. B. GitHub Pages:
//   node tools/build-web.js
// Danach dist/ hochladen; die Seite ist als Handy-App installierbar und läuft offline.
'use strict';
const fs = require('fs'), path = require('path');
const pwa = require('./pwa');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'dist');
fs.rmSync(OUT, { recursive: true, force: true });
for (const f of pwa.appFiles()) {
  fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
}
fs.writeFileSync(path.join(OUT, 'sw.js'), pwa.serviceWorker());
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
// Hosting-Hinweise: sw.js darf nicht lange gecacht werden, sonst sehen Handys neue Versionen erst spät
fs.writeFileSync(path.join(OUT, 'vercel.json'), JSON.stringify({ headers: [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }] }, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, '_headers'), '/sw.js\n  Cache-Control: no-cache\n');
console.log('dist/ erstellt: ' + (pwa.appFiles().length + 1) + ' Dateien, Version ' + pwa.version(pwa.appFiles()));
