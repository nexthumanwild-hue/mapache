// Saca las imágenes incrustadas (data URL) de los tableros al almacén «media»: el tablero guarda solo su id.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const S = require(process.argv[2] + '/lib/store');
const store = S.open();
let n = 0, before = 0, after = 0;
for (const meta of store.listBoards()) {
  const file = path.join(store.dirs.boards, `${meta.id}.json`);
  before += fs.statSync(file).size;
  let changed = 0;
  try {
    store.updateBoard(meta.id, (b) => {
      for (const it of Object.values(b.doc.items || {})) {
        const m = it.type === 'image' && typeof it.src === 'string' && /^data:([^;,]+);base64,(.*)$/s.exec(it.src);
        if (!m) continue;
        const id = crypto.randomUUID();
        store.putMedia(id, Buffer.from(m[2], 'base64'), { type: m[1], name: 'imagen' });
        it.mediaId = id; delete it.src; changed++;
      }
    });
  } catch (e) { console.error(meta.id, e.message); }
  n += changed;
  after += fs.statSync(file).size;
  console.log(meta.title || meta.id, `${changed} imágenes`);
}
console.log(`total: ${n} imágenes; tableros ${Math.round(before / 1024)} KB -> ${Math.round(after / 1024)} KB`);
