// Handy-App (PWA): Dateiliste und Service Worker mit automatischer Versionsnummer
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
/** Alle Dateien, die das Spiel offline braucht (relativ zum Spielordner) */
function appFiles() {
  const list = ['index.html', 'manifest.webmanifest'];
  for (const dir of ['css', 'js', 'icons']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).sort()) if (/\.(js|css|png)$/.test(f)) list.push(dir + '/' + f);
  }
  return list;
}
/** Versionsnummer = Prüfsumme über Namen und Inhalt aller Dateien (ändert sich mit jeder Änderung am Spiel) */
function version(files) {
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(f).update(fs.readFileSync(path.join(ROOT, f)));
  return h.digest('hex').slice(0, 12);
}
/** Adressen, die der Service Worker speichert ('./' = Startseite ohne Dateinamen) */
function swUrls(files) {
  return ['./'].concat((files || appFiles()).map(f => './' + f));
}
/** Inhalt von sw.js: alle Spieldateien offline vorhalten */
function serviceWorker() {
  const files = appFiles();
  const tpl = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const out = tpl.replace("'__VERSION__'", JSON.stringify(version(files)))
    .replace('[/*__FILES__*/]', JSON.stringify(swUrls(files)));
  // Lieber laut scheitern als einen Service Worker ohne Dateiliste ausliefern (der würde nichts speichern)
  if (out.indexOf('__VERSION__') >= 0 || out.indexOf('__FILES__') >= 0) throw new Error('sw.js: Platzhalter nicht gefunden');
  return out;
}
module.exports = { appFiles, version, swUrls, serviceWorker };
