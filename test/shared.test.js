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

test('shared: team mode without setup, and nothing without a user', async () => {
  const info = await req('GET', '/api/info');
  assert.strictEqual(info.json.mode, 'team');
  assert.strictEqual(info.json.shared, true);
  assert.strictEqual(info.json.needsSetup, false);
  assert.strictEqual((await req('GET', '/api/boards')).status, 401);
  // Sin usuario no se entra, ni siquiera con la contraseña del equipo.
  assert.strictEqual((await enter({ name: 'Ana', password: 'la-del-equipo' })).status, 401);
  assert.strictEqual((await enter({ name: '  ', password: 'x', create: true })).status, 400);
  assert.strictEqual((await enter({ name: 'Ana', password: 'corta', create: true })).status, 400);
});

test('shared: anyone creates a user; each name is one person, the first one administers', async () => {
  const ana = await enter({ name: 'Ana López', password: 'ana-propia-1', create: true });
  assert.strictEqual(ana.status, 200);
  assert.strictEqual(ana.json.user.role, 'admin');
  assert.strictEqual(ana.json.user.personal, true);
  assert.strictEqual((await enter({ name: 'ana lopez', password: 'otra-cosa-1', create: true })).status, 409);
  const again = await enter({ name: 'ana lopez', password: 'ana-propia-1' });
  assert.strictEqual(again.json.user.id, ana.json.user.id);
  assert.strictEqual((await enter({ name: 'Ana López', password: 'la-del-equipo' })).status, 401);
  const leo = await enter({ name: 'Leo', password: 'leo-propia-1', create: true });
  assert.strictEqual(leo.json.user.role, 'editor');
  assert.strictEqual((await req('GET', '/api/boards', { headers: { Cookie: cookieOf(leo), Origin: ORIGIN } })).status, 200);
});

test('shared: each person changes their own password', async () => {
  const leo = await enter({ name: 'Leo', password: 'leo-propia-1' });
  const h = { Cookie: cookieOf(leo), Origin: ORIGIN };
  assert.strictEqual((await req('PATCH', '/api/me', { body: { currentPassword: 'mal', password: 'leo-nueva-22' }, headers: h })).status, 403);
  assert.strictEqual((await req('PATCH', '/api/me', { body: { currentPassword: 'leo-propia-1', password: 'leo-nueva-22' }, headers: h })).status, 200);
  assert.strictEqual((await enter({ name: 'Leo', password: 'leo-propia-1' }, '10.0.0.3')).status, 401);
  assert.strictEqual((await enter({ name: 'Leo', password: 'leo-nueva-22' }, '10.0.0.3')).status, 200);
});

test('stickers: groups, per-person uses and renaming a group', async () => {
  const ana = await enter({ name: 'Ana López', password: 'ana-propia-1' });
  const leo = await enter({ name: 'Leo', password: 'leo-nueva-22' });
  const h = (r) => ({ Cookie: cookieOf(r), Origin: ORIGIN });
  assert.strictEqual((await req('PUT', '/api/media/st1', { body: 'x', headers: { ...h(ana), 'Content-Type': 'image/png' } })).status, 200);
  const st = (await req('POST', '/api/stickers', { body: { mediaId: 'st1', name: 'Uno', group: 'Wolf' }, headers: h(ana) })).json;
  assert.strictEqual(st.group, 'Wolf');
  await req('POST', `/api/stickers/${st.id}/use`, { body: {}, headers: h(ana) });
  await req('POST', `/api/stickers/${st.id}/use`, { body: {}, headers: h(ana) });
  assert.strictEqual((await req('GET', '/api/stickers', { headers: h(ana) })).json.stickers[0].used, 2);
  assert.strictEqual((await req('GET', '/api/stickers', { headers: h(leo) })).json.stickers[0].used, 0);
  await req('PATCH', '/api/stickers', { body: { from: 'Wolf', to: 'El lobo' }, headers: h(leo) });
  assert.strictEqual((await req('GET', '/api/stickers', { headers: h(leo) })).json.stickers[0].group, 'El lobo');
  assert.strictEqual((await req('DELETE', `/api/stickers/${st.id}`, { headers: h(leo) })).status, 403);
  // Los vídeos se sirven por trozos (Range): así se ven en streaming y en Safari.
  const part = await req('GET', '/api/media/st1', { headers: { ...h(leo), Range: 'bytes=0-1' } });
  assert.strictEqual(part.status, 206);
  assert.match(part.headers['content-range'], /^bytes 0-1\/\d+$/);
  assert.strictEqual((await req('GET', '/api/media/st1', { headers: { ...h(leo), Range: 'bytes=999-' } })).status, 416);
});

test('projects: chat for whoever sees the folder, tasks for whoever can edit it', async () => {
  const ana = await enter({ name: 'Ana López', password: 'ana-propia-1' });
  const leo = await enter({ name: 'Leo', password: 'leo-nueva-22' });
  const eva = await enter({ name: 'Eva', password: 'eva-propia-1', create: true });
  const h = (r) => ({ Cookie: cookieOf(r), Origin: ORIGIN });
  await req('PUT', '/api/folders/pf', { body: { id: 'pf', name: 'Proyecto', parentId: null }, headers: h(ana) });
  await req('PUT', '/api/folders/pf/share', { body: { shares: { [leo.json.user.id]: 'view' } }, headers: h(ana) });
  const task = (await req('POST', '/api/projects/pf/tasks', { body: { title: 'Grabar vídeo' }, headers: h(ana) })).json;
  assert.strictEqual(task.status, 'todo');
  assert.strictEqual((await req('PATCH', `/api/projects/pf/tasks/${task.id}`, { body: { status: 'review', assignee: leo.json.user.id }, headers: h(ana) })).json.status, 'review');
  assert.strictEqual((await req('PATCH', `/api/projects/pf/tasks/${task.id}`, { body: { status: 'nope' }, headers: h(ana) })).status, 400);
  // Leo (solo ver): lee y chatea, pero no toca las tareas.
  assert.strictEqual((await req('POST', '/api/projects/pf/chat', { body: { text: 'Hola equipo' }, headers: h(leo) })).status, 200);
  assert.strictEqual((await req('POST', '/api/projects/pf/tasks', { body: { title: 'x' }, headers: h(leo) })).status, 403);
  const seen = (await req('GET', '/api/projects/pf', { headers: h(leo) })).json;
  assert.strictEqual(seen.canEdit, false);
  assert.strictEqual(seen.tasks[0].assignee, leo.json.user.id);
  assert.strictEqual(seen.chat[0].text, 'Hola equipo');
  assert.strictEqual(seen.chat[0].name, 'Leo');
  // @menciones y asignaciones llegan a la bandeja de quien toca (y no a quien las hace).
  await req('POST', '/api/projects/pf/chat', { body: { text: '@Leo mira esto' }, headers: h(ana) });
  await req('POST', '/api/projects/pf/tasks', { body: { title: 'Revisar copy con @leo' }, headers: h(ana) });
  const kinds = (await req('GET', '/api/projects', { headers: h(leo) })).json.entries.map((x) => x.kind).sort();
  assert.deepStrictEqual(kinds, ['assign', 'chat', 'task']);
  assert.deepStrictEqual((await req('GET', '/api/projects', { headers: h(ana) })).json.entries, []);
  assert.deepStrictEqual((await req('GET', '/api/projects', { headers: h(eva) })).json.entries, []);
  // Eva no tiene acceso a la carpeta: ni la ve.
  assert.strictEqual((await req('GET', '/api/projects/pf', { headers: h(eva) })).status, 404);
  assert.strictEqual((await req('POST', '/api/projects/pf/chat', { body: { text: 'x' }, headers: h(eva) })).status, 404);
});

test('shared: only failures count, per forwarded address', async () => {
  for (let i = 0; i < 20; i++) assert.strictEqual((await enter({ name: 'Leo', password: 'mal' }, '10.9.9.9')).status, 401);
  assert.strictEqual((await enter({ name: 'Leo', password: 'leo-nueva-22' }, '10.9.9.9')).status, 429);
  for (let i = 0; i < 15; i++) assert.strictEqual((await enter({ name: 'Ana López', password: 'ana-propia-1' }, '10.0.0.2')).status, 200);
});
