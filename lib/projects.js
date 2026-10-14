// Proyectos (versión de Wild): cada carpeta tiene un chat y un tablero de tareas con 4 columnas. Se guarda en
// projects/<carpeta>.json. Lo ve quien ve la carpeta; el chat lo puede usar cualquiera de ellos, y las tareas, quien
// puede editarla.
// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Spaces = require('./spaces');
const { mentionIds } = require('../src/comments.js');

const STATUSES = ['todo', 'doing', 'review', 'done'];
const MAX_CHAT = 2000;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

function makeProjects({ store, writeAtomic, userById = () => null, users = () => [] }) {
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
      // @menciones: se guardan los ids, así la bandeja de cada persona las encuentra.
      const msg = { id: crypto.randomUUID(), ...who(user), text, mentions: mentionIds(text, users()), at: Date.now() };
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
        if (b.assignee !== undefined) {
          const next = b.assignee && userById(b.assignee) ? b.assignee : null;
          // Quién asignó y cuándo: a quien le toca le llega a su bandeja.
          if (next !== (cur.assignee || null)) Object.assign(out, { assignedBy: user ? user.id : null, assignedAt: Date.now() });
          out.assignee = next;
        }
        if (b.order != null && Number.isFinite(+b.order)) out.order = +b.order;
        if (b.note != null) out.note = String(b.note).slice(0, 4000);
        if (b.title != null || b.note != null) {
          const ids = mentionIds(`${out.title || ''}\n${out.note || ''}`, users());
          const fresh = ids.filter((id) => !(cur.mentions || []).includes(id));
          out.mentions = ids;
          if (fresh.length) Object.assign(out, { mentionedBy: user ? user.id : null, mentionedAt: Date.now() });
        }
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

  // Bandeja: dónde te han mencionado (chat y tareas) o te han asignado una tarea, en los proyectos que ves.
  function inbox(user) {
    if (!user) return [];
    const folders = store.readFolders().folders;
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
    const out = [];
    const author = (id) => { const u = id && userById(id); return u ? { id: u.id, name: u.name, color: u.color } : { id, name: '?' }; };
    for (const f of files) {
      const fid = f.slice(0, -5);
      const folder = folders.find((x) => x.id === fid);
      if (!folder || !Spaces.folderAccess(folders, user, fid)) continue;
      const d = read(fid);
      const base = { folderId: fid, folderName: folder.name };
      for (const m of d.chat) {
        if (m.by !== user.id && (m.mentions || []).includes(user.id)) out.push({ ...base, key: `pj/${fid}/${m.id}`, kind: 'chat', author: author(m.by), text: m.text, createdAt: m.at });
      }
      for (const x of d.tasks) {
        if (x.assignee === user.id && x.assignedBy && x.assignedBy !== user.id) out.push({ ...base, key: `pj/${fid}/t/${x.id}/a/${x.assignedAt}`, kind: 'assign', author: author(x.assignedBy), text: x.title, createdAt: x.assignedAt });
        if ((x.mentions || []).includes(user.id) && x.mentionedBy && x.mentionedBy !== user.id) out.push({ ...base, key: `pj/${fid}/t/${x.id}/m/${x.mentionedAt}`, kind: 'task', author: author(x.mentionedBy), text: x.title, createdAt: x.mentionedAt });
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, 150);
  }

  // Quién puede recibir los avisos en directo de un proyecto.
  const sees = (user, folderId) => { try { return !!access(user, folderId); } catch { return false; } };

  return { handle, sees, inbox, STATUSES };
}

module.exports = { makeProjects };
