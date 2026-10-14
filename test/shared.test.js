// Contraseña común (MAPACHE_SHARED_PASSWORD): se entra con nombre y la contraseña del equipo, sin cuentas ni setup.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 4900 + Math.floor(Math.random() * 90);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mapache-shared-'));
let server;

function req(method, url, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const r = http.request(`${ORIGIN}${url}`, { method, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* no es JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const cookieOf = (r) => (r.headers['set-cookie'] || [])[0].split(';')[0];
const enter = (body, ip = '10.0.0.1') => req('POST', '/api/auth/shared', { body, headers: { Origin: ORIGIN, 'X-Forwarded-For': ip } });

test.before(async () => {
  server = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--no-star'], { env: { ...process.env, MAPACHE_MODE: '', MAPACHE_SHARED_PASSWORD: 'la-del-equipo', MAPACHE_DATA: DATA, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 8000);
    server.stdout.on('data', (d) => { out += d; if (/Boards:|Tableros:/.test(out)) { clearTimeout(t); resolve(); } });
    server.stderr.on('data', (d) => { out += d; });
  });
  assert.doesNotMatch(out, /Setup code|Código para crear/);
});
test.after(() => { if (server) server.kill(); });

test('shared: team mode without setup, and nothing without the password', async () => {
  const info = await req('GET', '/api/info');
  assert.strictEqual(info.json.mode, 'team');
  assert.strictEqual(info.json.shared, true);
  assert.strictEqual(info.json.needsSetup, false);
  assert.strictEqual((await req('GET', '/api/boards')).status, 401);
  assert.strictEqual((await enter({ name: 'Ana', password: 'otra' })).status, 401);
  assert.strictEqual((await enter({ name: '  ', password: 'la-del-equipo' })).status, 400);
});

test('shared: each name is one person, the first one administers', async () => {
  const ana = await enter({ name: 'Ana López', password: 'la-del-equipo' });
  assert.strictEqual(ana.status, 200);
  assert.strictEqual(ana.json.user.role, 'admin');
  const again = await enter({ name: 'ana lopez', password: 'la-del-equipo' });
  assert.strictEqual(again.json.user.id, ana.json.user.id);
  const leo = await enter({ name: 'Leo', password: 'la-del-equipo' });
  assert.strictEqual(leo.json.user.role, 'editor');
  const boards = await req('GET', '/api/boards', { headers: { Cookie: cookieOf(leo), Origin: ORIGIN } });
  assert.strictEqual(boards.status, 200);
});

test('shared: only failures count, per forwarded address', async () => {
  for (let i = 0; i < 20; i++) assert.strictEqual((await enter({ name: 'X', password: 'mal' }, '10.9.9.9')).status, 401);
  assert.strictEqual((await enter({ name: 'X', password: 'la-del-equipo' }, '10.9.9.9')).status, 429);
  for (let i = 0; i < 15; i++) assert.strictEqual((await enter({ name: 'Leo', password: 'la-del-equipo' }, '10.0.0.2')).status, 200);
});
