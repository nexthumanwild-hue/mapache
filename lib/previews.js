// Versiones ligeras de los vídeos (versión de Wild): al subir un vídeo grande, el servidor hace con ffmpeg una copia
// de hasta 720p (<id>.preview.mp4) y una portada (<id>.poster.jpg). Los tableros muestran la copia ligera; al descargar
// se baja siempre el original. Sin ffmpeg no pasa nada: se sirve el original.
// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const fs = require('fs');
const { execFile } = require('child_process');

const MIN_SIZE = 1.5 * 1024 * 1024; // los vídeos pequeños (stickers) ya cargan rápido
let hasFfmpeg = null;
const queue = [];
let busy = false;

const previewOf = (file) => `${file}.preview.mp4`;
const posterOf = (file) => `${file}.poster.jpg`;

function check(cb) {
  if (hasFfmpeg !== null) return cb(hasFfmpeg);
  execFile('ffmpeg', ['-version'], (err) => { hasFfmpeg = !err; cb(hasFfmpeg); });
}

const run = (args) => new Promise((ok) => execFile('ffmpeg', ['-v', 'error', '-y', ...args], { timeout: 10 * 60 * 1000 }, (err) => ok(!err)));

// De uno en uno, para no dejar sin CPU al resto del servidor.
async function next() {
  if (busy || !queue.length) return;
  busy = true;
  const file = queue.shift();
  try {
    const tmp = `${previewOf(file)}.tmp.mp4`;
    const fit = 'scale=720:720:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2';
    if (await run(['-i', file, '-vf', fit, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-maxrate', '1000k', '-bufsize', '2000k',
      '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', tmp])) {
      // Solo vale la pena si de verdad pesa menos.
      if (fs.statSync(tmp).size < fs.statSync(file).size * 0.8) fs.renameSync(tmp, previewOf(file)); else fs.unlinkSync(tmp);
    } else try { fs.unlinkSync(tmp); } catch { /* no llegó a crearse */ }
    await run(['-ss', '0.5', '-i', file, '-frames:v', '1', '-vf', 'scale=480:480:force_original_aspect_ratio=decrease', '-q:v', '5', posterOf(file)]);
  } catch (e) { console.error('preview', e.message); }
  busy = false;
  next();
}

function schedule(file, type) {
  if (!/^video\//i.test(type || '')) return;
  try { if (fs.statSync(file).size < MIN_SIZE) return; } catch { return; }
  check((ok) => { if (ok && !queue.includes(file)) { queue.push(file); next(); } });
}

module.exports = { schedule, previewOf, posterOf };
