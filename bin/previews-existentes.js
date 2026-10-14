// Genera las versiones ligeras (y portadas) de los vídeos que ya estaban subidos. Uso: node bin/previews-existentes.js
const fs = require('fs'), path = require('path');
const Previews = require('../lib/previews');
const S = require('../lib/store');
const dir = S.open().dirs.media;
let n = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const file = path.join(dir, f.slice(0, -5));
  if (/^video\//.test(meta.type || '') && !fs.existsSync(Previews.posterOf(file))) { Previews.schedule(file, meta.type); n++; }
}
console.log(`${n} vídeos en cola`);
