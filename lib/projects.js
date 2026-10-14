// Proyectos (versión de Wild): cada carpeta tiene un chat y un tablero de tareas con 4 columnas. Se guarda en
// projects/<carpeta>.json. Lo ve quien ve la carpeta; el chat lo puede usar cualquiera de ellos, y las tareas, quien
// puede editarla.
// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Spaces = require('./spaces');

const STATUSES = ['todo', 'doing', 'review', 'done'];
const MAX_CHAT = 2000;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

function makeProjects({ store, writeAtomic, userById = () => null }) {
  const dir = path.join(store.dir, 'projects');
  const file = (id) => path.join(dir, `${String(id).replace(/[^A-Za-z0-9_-]/g, '')}.json`);
  const read = (id) => { try { const d = JSON.parse(fs.readFileSync(file(id), 'utf8')); return { chat: d.chat || [], tasks: d.tasks || [] }; } catch { return { chat: [], tasks: [] }; } };
  const write = (id, d) => { fs.mkdirSync(dir, { recursive: true }); writeAtomic(file(id), JSON.stringify(d)); };

  // Acceso a la carpeta (sin cuentas, en modo local: todo).
  function access(user, folderId) {
    const folders = store.readFolders().folders;
    if (!folders.some((f) => f.id === folderId)) fail('Not found', 404);
    if (!user) return 'owner';
    const a = Spaces.folderAccess(folders, user, folderId);
    if (!a) fail('Not found', 404);
    return user.role === 'viewer' && a !== 'view' ? 'view' : a;
  }
  const canEdit = (a) => a === 'owner' || a === 'edit';
  const who = (user) => (user ? { by: user.id, name: user.name, color: user.color } : { by: null, name: '', color: null });

  // parts: ['projects', folderId, 'chat' | 'tasks', taskId]
  function handle(method, parts, body, user) {
    const [, folderId, sub, taskId] = parts;
    const a = access(user, folderId);
    const d = read(folderId);
    if (!sub && method === 'GET') {
      // El nombre y el color, al día (por si alguien cambió su perfil).
      const fresh = (m) => { const u = m.by && userById(m.by); return u ? { ...m, name: u.name, color: u.color } : m; };
      return { chat: d.chat.slice(-300).map(fresh), tasks: d.tasks, canEdit: canEdit(a) };
    }
    if (sub === 'chat' && method === 'POST') {
      const text = String((body && body.text) || '').trim().slice(0, 4000);
      if (!text) fail('Write a message');
      const msg = { id: crypto.randomUUID(), ...who(user), text, at: Date.now() };
      d.chat = [...d.chat, msg].slice(-MAX_CHAT);
      write(folderId, d);
      return msg;
    }
    if (sub === 'tasks') {
      if (!canEdit(a)) fail('You can only view this folder', 403);
      const clean = (b, cur = {}) => {
        const out = { ...cur };
        if (b.title != null) { out.title = String(b.title).trim().slice(0, 300); if (!out.title) fail('Write the task'); }
        if (b.status != null) { if (!STATUSES.includes(b.status)) fail('Unknown status'); out.status = b.status; }
        if (b.assignee !== undefined) out.assignee = b.assignee && userById(b.assignee) ? b.assignee : null;
        if (b.order != null && Number.isFinite(+b.order)) out.order = +b.order;
        if (b.note != null) out.note = String(b.note).slice(0, 4000);
        return out;
      };
      if (!taskId && method === 'POST') {
        const t = clean(body || {}, { id: crypto.randomUUID(), status: 'todo', assignee: null, order: Date.now(), createdAt: Date.now(), ...who(user) });
        if (!t.title) fail('Write the task');
        t.updatedAt = Date.now();
        d.tasks.push(t);
        write(folderId, d);
        return t;
      }
      const i = d.tasks.findIndex((x) => x.id === taskId);
      if (i < 0) fail('Not found', 404);
      if (method === 'PATCH') {
        d.tasks[i] = { ...clean(body || {}, d.tasks[i]), updatedAt: Date.now() };
        write(folderId, d);
        return d.tasks[i];
      }
      if (method === 'DELETE') { d.tasks.splice(i, 1); write(folderId, d); return { ok: true }; }
    }
    fail('Not found', 404);
  }

  // Quién puede recibir los avisos en directo de un proyecto.
  const sees = (user, folderId) => { try { return !!access(user, folderId); } catch { return false; } };

  return { handle, sees, STATUSES };
}

module.exports = { makeProjects };
