// Lädt die DOM-freie Spiellogik in Node: const G = require('./load')();
const fs = require('fs');
const path = require('path');
const vm = require('vm');
module.exports = function load(extra) {
  globalThis.G = {};
  const dir = path.join(__dirname, '..', 'js');
  const files = ['data.js', 'maps.js', 'campaign.js', 'game.js', 'ai.js'].concat(extra || []);
  for (const f of files) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
  }
  return globalThis.G;
};
