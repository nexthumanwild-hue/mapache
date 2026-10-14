// Espacios (versión de Wild): en modo equipo cada persona tiene su espacio privado y comparte las carpetas que quiera,
// persona a persona, con «Puede editar» o «Solo ver». Nadie ve lo que no es suyo ni le han compartido, tampoco el admin.
//
// - Carpeta: { ownerId, shares: { [userId]: 'edit' | 'view' } }. Lo que se comparte con una carpeta vale también para
//   todo lo que hay dentro (subcarpetas y mapas).
// - Mapa suelto (sin carpeta): de quien lo creó (ownerId). Un mapa dentro de una carpeta va con la carpeta.
// - Lo anterior a los espacios (sin ownerId) queda en el espacio de las personas admin.
//
// scope(store, user) devuelve el mismo almacén que Store.open() pero visto por esa persona: lo usan la API de la app y
// el MCP de sus agentes.
// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';

const RANK = { view: 1, edit: 2, owner: 3 };
const LEVELS = ['edit', 'view'];
const better = (a, b) => ((RANK[a] || 0) >= (RANK[b] || 0) ? a : b);
const can = (level, need) => (RANK[level] || 0) >= RANK[need];
const fail = (message, status = 403) => { throw Object.assign(new Error(message), { status }); };
const mine = (x, user) => (x.ownerId ? x.ownerId === user.id : user.role === 'admin');

// Acceso de una persona a una carpeta: dueña de ella o de alguna de las de arriba, o lo mejor que le hayan compartido.
function folderAccess(folders, user, folderId) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let best = null;
  for (let f = byId.get(folderId), hops = 0; f && hops < 100; f = byId.get(f.parentId), hops++) {
    if (mine(f, user)) return 'owner';
    const s = f.shares && f.shares[user.id];
    if (LEVELS.includes(s)) best = better(best, s);
  }
  return best;
}

function boardAccess(folders, user, b) {
  if (!b) return null;
  if (b.folderId && folders.some((f) => f.id === b.folderId)) return folderAccess(folders, user, b.folderId);
  return mine(b, user) ? 'owner' : null;
}

function scope(store, user, { userById = () => null } = {}) {
  const all = () => store.readFolders().folders;
  const access = (id) => boardAccess(all(), user, store.getBoard(id));

  function readFolders() {
    const { rev, folders } = store.readFolders();
    const seen = new Map();
    for (const f of folders) { const a = folderAccess(folders, user, f.id); if (a) seen.set(f.id, a); }
    return {
      rev,
      folders: folders.filter((f) => seen.has(f.id)).map((f) => {
        const a = seen.get(f.id);
        // Una carpeta compartida cuya carpeta de arriba no ves aparece en la raíz de tu barra lateral.
        const out = { ...f, parentId: seen.has(f.parentId) ? f.parentId : null, access: a };
        if (a !== 'owner') { delete out.shares; const o = f.ownerId && userById(f.ownerId); if (o) out.ownerName = o.name; }
        return out;
      }),
    };
  }

  // Al guardar, ownerId y shares los pone el servidor; parentId no se pierde si la carpeta de arriba no es visible.
  function putFolder(f) {
    const folders = all();
    const cur = folders.find((x) => x.id === f.id);
    const next = { ...f };
    delete next.access; delete next.ownerName;
    if (cur) {
      const a = folderAccess(folders, user, cur.id);
      if (!a) fail('Not found', 404);
      if (!can(a, 'edit')) {
        // Solo ver: puedes plegarla o desplegarla, nada más.
        return store.putFolder({ ...cur, collapsed: !!f.collapsed });
      }
      next.ownerId = cur.ownerId;
      next.shares = cur.shares;
      if ((f.parentId || null) !== (cur.parentId || null)) {
        const parentHidden = cur.parentId && !folderAccess(folders, user, cur.parentId);
        if (!f.parentId && parentHidden) next.parentId = cur.parentId;
        else if (!f.parentId) { if (!mine(cur, user)) fail('Only the owner can move this folder out'); }
        else {
          if (!can(folderAccess(folders, user, f.parentId), 'edit')) fail('You cannot add things to that folder');
          for (let p = folders.find((x) => x.id === f.parentId); p; p = folders.find((x) => x.id === p.parentId)) if (p.id === cur.id) fail('A folder cannot go inside itself', 400);
        }
      }
    } else {
      if (f.parentId && !can(folderAccess(folders, user, f.parentId), 'edit')) fail('You cannot add things to that folder');
      next.ownerId = user.id;
      delete next.shares;
    }
    return store.putFolder(next);
  }

  function removeFolder(id) {
    if (folderAccess(all(), user, id) !== 'owner') fail('Only the owner can delete this folder');
    return store.removeFolder(id);
  }

  // Compartir: solo quien es dueña de la carpeta. shares = { userId: 'edit' | 'view' }; lo que no está, no la ve.
  function setShares(id, shares) {
    const cur = all().find((f) => f.id === id);
    if (!cur) fail('Not found', 404);
    if (!mine(cur, user)) fail('Only the owner can share this folder');
    const clean = {};
    for (const [uid, level] of Object.entries(shares || {})) if (uid !== user.id && LEVELS.includes(level) && userById(uid)) clean[uid] = level;
    return store.putFolder({ ...cur, ownerId: cur.ownerId || user.id, shares: clean });
  }

  const listBoards = () => { const folders = all(); return store.listBoards().filter((b) => boardAccess(folders, user, b)).map((b) => ({ ...b, access: boardAccess(folders, user, b) })); };
  const getBoard = (id) => (access(id) ? store.getBoard(id) : null);
  const boardRev = (id) => (access(id) ? store.boardRev(id) : null);

  // El mapa va a su carpeta (hay que poder editar en ella) o a tu espacio (entonces es tuyo).
  function place(next, cur) {
    const folders = all();
    if (next.folderId && folders.some((f) => f.id === next.folderId)) {
      if ((!cur || next.folderId !== cur.folderId) && !can(folderAccess(folders, user, next.folderId), 'edit')) fail('You cannot add things to that folder');
      next.ownerId = (cur && cur.ownerId) || user.id;
    } else {
      next.ownerId = cur && !cur.folderId && cur.ownerId ? cur.ownerId : user.id;
    }
    delete next.access;
    return next;
  }

  function putBoard(board, opts) {
    const cur = store.getBoard(board.id);
    if (cur && !can(boardAccess(all(), user, cur), 'edit')) fail(boardAccess(all(), user, cur) ? 'You can only view this board' : 'Not found', boardAccess(all(), user, cur) ? 403 : 404);
    return store.putBoard(place({ ...board }, cur), opts);
  }

  function updateBoard(id, fn) {
    const cur = store.getBoard(id);
    const a = boardAccess(all(), user, cur);
    if (!a) fail(`Board not found: ${id}`, 404);
    if (!can(a, 'edit')) fail('You can only view this board');
    return store.updateBoard(id, (b) => { const r = fn(b); place(b, cur); return r; });
  }

  function removeBoard(id) {
    const a = access(id);
    if (!a) return false;
    if (!can(a, 'edit')) fail('You can only view this board');
    return store.removeBoard(id);
  }

  const listTrash = () => { const folders = all(); return store.listTrash().filter((b) => can(boardAccess(folders, user, b), 'edit')); };
  function restoreBoard(id) {
    if (!listTrash().some((b) => b.id === id)) return null;
    return store.restoreBoard(id);
  }

  return { ...store, listBoards, getBoard, boardRev, putBoard, updateBoard, removeBoard, listTrash, restoreBoard,
    readFolders, putFolder, removeFolder, setShares };
}

module.exports = { scope, folderAccess, boardAccess };
