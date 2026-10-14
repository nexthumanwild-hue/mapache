// Proyectos (versión de Wild): cada carpeta tiene un chat y un tablero de tareas (Por hacer · En curso · En revisión ·
// Hecho). Se abre con el botón de la barra superior (proyecto del mapa abierto) o desde el menú de una carpeta.
// Solo con servidor; los datos los guarda lib/projects.js.
// SPDX-License-Identifier: AGPL-3.0-or-later
(function (root) {
  'use strict';
  const t = root.MMI18n.t;
  const Store = root.MMStore;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const avatar = (u, size = 22) => `<span class="tm-avatar" style="--c:${esc((u && u.color) || '#94a3b8')};--s:${size}px" title="${esc((u && u.name) || '')}">${esc(initials(u && u.name))}</span>`;
  const COLS = () => [['todo', t('Por hacer')], ['doing', t('En curso')], ['review', t('En revisión')], ['done', t('Hecho')]];
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16M5.5 8h1.5M11 8h2M17 8h1.5M11 11.5h2"/></svg>';

  let folderId = null; // carpeta del mapa abierto
  let openId = null;   // proyecto abierto en la ventana
  let data = null;
  let editing = null;  // tarea que se está editando
  const box = () => $('#project-modal');
  const online = () => Store.status().mode === 'online';
  const seenKey = (id) => `nomiror:chat-seen:${id}`;
  const setSeen = (id, at) => { try { localStorage.setItem(seenKey(id), String(at)); } catch { /* sin almacenamiento */ } };
  const unread = new Set();

  function button() {
    let b = $('#project-btn');
    if (!b) {
      b = document.createElement('button');
      b.id = 'project-btn';
      b.className = 'icon-btn';
      b.innerHTML = `${ICON}<span class="pj-dot" hidden></span>`;
      b.addEventListener('click', () => folderId && open(folderId));
      const actions = $('#topbar .top-actions');
      if (actions) actions.prepend(b);
    }
    return b;
  }

  async function folderName(id) {
    const f = (await Store.folders.all()).find((x) => x.id === id);
    return f ? f.name : '';
  }

  async function setFolder(id) {
    folderId = id || null;
    const b = button();
    b.hidden = !folderId || !online();
    if (b.hidden) return;
    const name = await folderName(folderId);
    b.dataset.tip = t('Chat y tareas de «{name}»', { name });
    b.setAttribute('aria-label', b.dataset.tip);
    b.querySelector('.pj-dot').hidden = !unread.has(folderId);
  }

  // ---------- Ventana del proyecto ----------

  async function open(id) {
    openId = id;
    editing = null;
    const el = box();
    el.hidden = false;
    el.innerHTML = `<div class="pj-card" role="dialog" aria-modal="true"><div class="pj-head"><h2>${esc(await folderName(id))}</h2>` +
      `<span class="pj-sub">${esc(t('Tareas y chat del proyecto'))}</span><button class="icon-btn pj-close" aria-label="${esc(t('Cerrar'))}">×</button></div>` +
      `<div class="pj-body"><div class="pj-board"></div><div class="pj-chat"><div class="pj-msgs"></div>` +
      `<form class="pj-send"><textarea rows="1" placeholder="${esc(t('Escribe un mensaje…'))}"></textarea><button class="primary" type="submit">${esc(t('Enviar'))}</button></form></div></div></div>`;
    el.querySelector('.pj-close').onclick = close;
    unread.delete(id);
    setFolder(folderId);
    await load();
    el.querySelector('.pj-send textarea').focus();
  }

  function close() {
    openId = null;
    editing = null;
    const el = box();
    el.hidden = true;
    el.innerHTML = '';
  }

  async function load() {
    if (!openId) return;
    try { data = await Store.api('GET', `api/projects/${encodeURIComponent(openId)}`); } catch (e) { data = { chat: [], tasks: [], canEdit: false, error: e.message }; }
    draw();
  }

  function person(id) { return Store.members().find((m) => m.id === id) || null; }

  function draw() {
    const el = box();
    if (!openId || !data || el.hidden) return;
    const board = el.querySelector('.pj-board');
    const tasks = [...data.tasks].sort((a, b) => a.order - b.order);
    board.innerHTML = COLS().map(([k, label]) => {
      const list = tasks.filter((x) => x.status === k);
      return `<section class="pj-col" data-status="${k}"><header><b>${esc(label)}</b><span>${list.length}</span></header><div class="pj-cards">` +
        list.map((x) => (editing === x.id ? editor(x) : card(x))).join('') + '</div>' +
        (data.canEdit ? `<form class="pj-add" data-status="${k}"><input placeholder="+ ${esc(t('Añadir tarea'))}" maxlength="300"></form>` : '') + '</section>';
    }).join('');
    const msgs = el.querySelector('.pj-msgs');
    const me = Store.status().user;
    const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40;
    msgs.innerHTML = data.chat.length ? data.chat.map((m, i) => {
      const prev = data.chat[i - 1];
      const grouped = prev && prev.by === m.by && m.at - prev.at < 5 * 60000;
      const mine = me && m.by === me.id;
      return `<div class="pj-msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}">${grouped || mine ? '' : avatar(m, 26)}<div class="pj-bubble">` +
        (grouped || mine ? '' : `<b>${esc(m.name)}</b>`) + `<p>${esc(m.text)}</p><time>${new Date(m.at).toLocaleString(root.MMI18n.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></div></div>`;
    }).join('') : `<p class="pj-empty">${esc(t('Todavía no hay mensajes. Escribe el primero.'))}</p>`;
    if (atBottom || !msgs.dataset.ready) { msgs.scrollTop = msgs.scrollHeight; msgs.dataset.ready = '1'; }
    if (data.chat.length) setSeen(openId, data.chat[data.chat.length - 1].at);
    if (data.error) board.insertAdjacentHTML('afterbegin', `<p class="au-error">${esc(data.error)}</p>`);
  }

  function card(x) {
    const a = x.assignee && person(x.assignee);
    return `<article class="pj-task" data-id="${esc(x.id)}" draggable="${data.canEdit}"><p>${esc(x.title)}</p>` +
      (x.note ? `<small class="pj-note">${esc(x.note)}</small>` : '') +
      `<footer>${a ? avatar(a, 20) : ''}<span>${esc(a ? a.name : '')}</span></footer></article>`;
  }

  function editor(x) {
    const people = Store.members();
    return `<form class="pj-task pj-edit" data-id="${esc(x.id)}"><textarea name="title" rows="2" maxlength="300">${esc(x.title)}</textarea>` +
      `<textarea name="note" rows="2" maxlength="4000" placeholder="${esc(t('Notas (opcional)'))}">${esc(x.note || '')}</textarea>` +
      `<select name="assignee"><option value="">${esc(t('Sin asignar'))}</option>${people.map((p) => `<option value="${esc(p.id)}"${p.id === x.assignee ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` +
      `<div class="pj-edit-btns"><button class="ghost danger" type="button" data-pj="del">${esc(t('Borrar'))}</button><button class="ghost" type="button" data-pj="cancel">${esc(t('Cancelar'))}</button><button class="primary" type="submit">${esc(t('Guardar'))}</button></div></form>`;
  }

  const api = (method, sub, body) => Store.api(method, `api/projects/${encodeURIComponent(openId)}/${sub}`, body);
  const toast = (m) => (root.mapache ? root.mapache.toast(m) : null);
  const run = async (p) => { try { await p; } catch (e) { toast(e.message); } await load(); };

  function wire() {
    const el = box();
    if (!el || el.dataset.wired) return;
    el.dataset.wired = '1';
    // Lo que se escribe aquí no son atajos del tablero.
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { if (editing) { editing = null; draw(); } else close(); }
      if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.pj-send textarea')) { e.preventDefault(); e.target.form.requestSubmit(); }
    });
    el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
    el.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.matches('.pj-send')) {
        const ta = f.querySelector('textarea');
        const text = ta.value.trim();
        if (!text) return;
        ta.value = '';
        return run(api('POST', 'chat', { text }));
      }
      if (f.matches('.pj-add')) {
        const inp = f.querySelector('input');
        const title = inp.value.trim();
        if (!title) return;
        inp.value = '';
        return run(api('POST', 'tasks', { title, status: f.dataset.status })).then(() => box().querySelector(`.pj-add[data-status="${f.dataset.status}"] input`)?.focus());
      }
      if (f.matches('.pj-edit')) {
        const id = f.dataset.id;
        editing = null;
        return run(api('PATCH', `tasks/${encodeURIComponent(id)}`, { title: f.title.value, note: f.note.value, assignee: f.assignee.value || null }));
      }
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pj]');
      if (b) {
        const id = b.closest('.pj-edit').dataset.id;
        if (b.dataset.pj === 'cancel') { editing = null; return draw(); }
        if (b.dataset.pj === 'del') { editing = null; return run(api('DELETE', `tasks/${encodeURIComponent(id)}`)); }
      }
      const c = e.target.closest('.pj-task:not(.pj-edit)');
      if (c && data && data.canEdit) { editing = c.dataset.id; draw(); box().querySelector('.pj-edit textarea')?.focus(); }
    });
    // Arrastrar tarjetas entre columnas (y dentro de una columna para ordenarlas).
    let dragId = null;
    el.addEventListener('dragstart', (e) => { const c = e.target.closest('.pj-task'); if (!c) return; dragId = c.dataset.id; e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
    el.addEventListener('dragend', () => { dragId = null; el.querySelectorAll('.dragging, .drop').forEach((x) => x.classList.remove('dragging', 'drop')); });
    el.addEventListener('dragover', (e) => {
      const col = e.target.closest('.pj-col');
      if (!col || !dragId) return;
      e.preventDefault();
      el.querySelectorAll('.pj-col.drop').forEach((x) => x !== col && x.classList.remove('drop'));
      col.classList.add('drop');
    });
    el.addEventListener('drop', (e) => {
      const col = e.target.closest('.pj-col');
      if (!col || !dragId) return;
      e.preventDefault();
      const status = col.dataset.status;
      const others = [...data.tasks].filter((x) => x.status === status && x.id !== dragId).sort((a, b) => a.order - b.order);
      const over = e.target.closest('.pj-task');
      let order;
      if (over && over.dataset.id !== dragId) {
        const i = others.findIndex((x) => x.id === over.dataset.id);
        const before = others[i - 1];
        order = before ? (before.order + others[i].order) / 2 : others[i].order - 1;
      } else order = others.length ? others[others.length - 1].order + 1 : Date.now();
      const task = data.tasks.find((x) => x.id === dragId);
      if (task) { task.status = status; task.order = order; draw(); }
      run(api('PATCH', `tasks/${encodeURIComponent(dragId)}`, { status, order }));
    });
  }

  // Avisos en directo: si el proyecto está abierto se refresca; si no, el botón marca mensajes nuevos.
  let timer = null;
  Store.on((e) => {
    if (e.type === 'status') setFolder(folderId);
    if (e.type !== 'project') return;
    if (e.folderId === openId) { clearTimeout(timer); timer = setTimeout(load, 150); return; }
    if (e.kind === 'chat') { unread.add(e.folderId); setFolder(folderId); }
  });

  function init() {
    if (!$('#project-modal')) {
      const m = document.createElement('div');
      m.id = 'project-modal';
      m.className = 'modal';
      m.hidden = true;
      document.body.append(m);
    }
    wire();
    button();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  root.MMProject = { setFolder, open, close };
})(window);
