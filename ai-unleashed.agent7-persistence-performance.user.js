// ==UserScript==
// @name         AI Unleashed - Agent 7 Persistence Performance
// @namespace    https://github.com/ADHD-exe/ai-unleashed
// @version      0.7.0
// @description  Persistence, search, snapshots, rollback, queue, and performance utilities for AI Unleashed.
// @author       ADHD-exe
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://claude.ai/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const APP = 'ai-unleashed';
  const VERSION = '0.7.0-agent7-persistence-performance';
  const DB_NAME = `${APP}-performance-db`;
  const DB_VERSION = 1;
  const STORAGE = {
    prompts: `${APP}:prompts`,
    workflows: `${APP}:workflows`,
    dslSnippets: `${APP}:dslSnippets`,
    orchestrations: `${APP}:orchestrations`,
    snapshots: `${APP}:snapshots`,
    queue: `${APP}:queue`,
    perfSettings: `${APP}:perfSettings`,
  };

  const DEFAULT_SETTINGS = {
    autoIndex: true,
    maxSnapshots: 30,
    maxQueueItems: 200,
  };

  const state = {
    db: null,
    panel: null,
    settings: loadJSON(STORAGE.perfSettings, DEFAULT_SETTINGS),
    queue: loadJSON(STORAGE.queue, []),
  };

  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const now = () => new Date().toISOString();
  const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));

  function loadJSON(key, fallback) {
    try {
      const raw = GM_getValue(key, null);
      return raw ? { ...fallback, ...JSON.parse(raw) } : structuredClone(fallback);
    } catch (_) {
      return structuredClone(fallback);
    }
  }

  function loadArray(key) {
    try {
      const raw = GM_getValue(key, null);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveJSON(key, value) {
    GM_setValue(key, JSON.stringify(value));
  }

  function notify(message) {
    const n = document.createElement('div');
    n.className = 'aiu7-toast';
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
  }

  function openModal(title, html, bind) {
    const modal = document.createElement('div');
    modal.className = 'aiu7-modal';
    modal.innerHTML = `<div class="aiu7-card"><button class="aiu7-close">×</button><h2>${escapeHTML(title)}</h2>${html}</div>`;
    modal.querySelector('.aiu7-close').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    bind?.(modal);
    return modal;
  }

  function openDB() {
    if (state.db) return Promise.resolve(state.db);
    return new Promise(resolve => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('index')) {
          const store = db.createObjectStore('index', { keyPath: 'key' });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('title', 'title', { unique: false });
        }
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
      };
      req.onsuccess = () => { state.db = req.result; resolve(state.db); };
      req.onerror = () => resolve(null);
    });
  }

  function flattenItems() {
    const prompts = loadArray(STORAGE.prompts).map(item => ({ type: 'prompt', id: item.id || uid(), title: item.title || 'Untitled Prompt', body: item.body || item.content || '', tags: item.tags || [] }));
    const workflows = loadArray(STORAGE.workflows).map(item => ({ type: 'workflow', id: item.id || uid(), title: item.title || 'Untitled Workflow', body: JSON.stringify(item.steps || []), tags: ['workflow'] }));
    const snippets = loadArray(STORAGE.dslSnippets).map(item => ({ type: 'dsl', id: item.id || uid(), title: item.title || 'Untitled DSL', body: item.body || '', tags: ['dsl'] }));
    const orchestrations = loadArray(STORAGE.orchestrations).map(item => ({ type: 'orchestration', id: item.id || uid(), title: item.title || 'Untitled Orchestration', body: JSON.stringify(item.steps || []), tags: ['orchestration'] }));
    return prompts.concat(workflows, snippets, orchestrations);
  }

  function tokenize(text) {
    return [...new Set(String(text || '').toLowerCase().split(/[^a-z0-9_#-]+/).filter(t => t.length >= 2))];
  }

  async function rebuildIndex() {
    const db = await openDB();
    if (!db) return notify('IndexedDB unavailable.');
    const items = flattenItems();
    return new Promise(resolve => {
      const tx = db.transaction('index', 'readwrite');
      const store = tx.objectStore('index');
      store.clear();
      items.forEach(item => {
        const searchable = `${item.title}\n${item.body}\n${(item.tags || []).join(' ')}`;
        store.put({
          key: `${item.type}:${item.id}`,
          type: item.type,
          id: item.id,
          title: item.title,
          body: item.body,
          tags: item.tags || [],
          tokens: tokenize(searchable),
          updatedAt: now(),
        });
      });
      tx.oncomplete = () => { notify(`Indexed ${items.length} items.`); resolve(items.length); };
      tx.onerror = () => { notify('Index rebuild failed.'); resolve(0); };
    });
  }

  async function searchIndex(query) {
    const db = await openDB();
    if (!db) return [];
    const terms = tokenize(query);
    if (!terms.length) return [];
    return new Promise(resolve => {
      const req = db.transaction('index').objectStore('index').getAll();
      req.onsuccess = () => {
        const results = (req.result || []).map(item => {
          const haystack = `${item.title} ${item.body} ${(item.tags || []).join(' ')}`.toLowerCase();
          const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
          return { ...item, score };
        }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
        resolve(results.slice(0, 100));
      };
      req.onerror = () => resolve([]);
    });
  }

  function openSearchUI() {
    openModal('AIU Indexed Search', `<div class="aiu7-actions"><button data-rebuild>Rebuild Index</button></div><input data-query placeholder="Search prompts, workflows, DSL, orchestrations"><div data-results></div>`, modal => {
      const input = modal.querySelector('[data-query]');
      const results = modal.querySelector('[data-results]');
      modal.querySelector('[data-rebuild]').onclick = rebuildIndex;
      input.oninput = debounce(async () => {
        const rows = await searchIndex(input.value);
        results.innerHTML = rows.map(r => `<div class="aiu7-row"><strong>${escapeHTML(r.title)}</strong><span>${escapeHTML(r.type)}</span><span>score ${r.score}</span><button data-view="${escapeHTML(r.key)}">View</button></div>`).join('') || '<p>No results.</p>';
        results.querySelectorAll('[data-view]').forEach(btn => btn.onclick = () => {
          const row = rows.find(r => r.key === btn.dataset.view);
          openModal('Search Result', `<pre>${escapeHTML(JSON.stringify(row, null, 2))}</pre>`);
        });
      }, 180);
    });
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  function createSnapshot(label = 'Manual Snapshot') {
    const snap = {
      id: uid(),
      label,
      version: VERSION,
      createdAt: now(),
      data: {
        prompts: loadArray(STORAGE.prompts),
        workflows: loadArray(STORAGE.workflows),
        dslSnippets: loadArray(STORAGE.dslSnippets),
        orchestrations: loadArray(STORAGE.orchestrations),
      },
    };
    const snaps = loadArray(STORAGE.snapshots);
    snaps.unshift(snap);
    saveJSON(STORAGE.snapshots, snaps.slice(0, state.settings.maxSnapshots));
    persistSnapshotDB(snap);
    notify('Snapshot created.');
  }

  async function persistSnapshotDB(snapshot) {
    const db = await openDB();
    if (!db) return;
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put(snapshot);
  }

  function restoreSnapshot(id) {
    const snap = loadArray(STORAGE.snapshots).find(s => s.id === id);
    if (!snap) return notify('Snapshot not found.');
    saveJSON(STORAGE.prompts, snap.data.prompts || []);
    saveJSON(STORAGE.workflows, snap.data.workflows || []);
    saveJSON(STORAGE.dslSnippets, snap.data.dslSnippets || []);
    saveJSON(STORAGE.orchestrations, snap.data.orchestrations || []);
    notify('Snapshot restored. Reload page to refresh all modules.');
  }

  function openSnapshotsUI() {
    const snaps = loadArray(STORAGE.snapshots);
    const rows = snaps.map(s => `<div class="aiu7-row"><strong>${escapeHTML(s.label)}</strong><span>${escapeHTML(s.createdAt)}</span><button data-restore="${s.id}">Restore</button><button data-export="${s.id}">Export</button></div>`).join('') || '<p>No snapshots.</p>';
    openModal('Snapshots / Rollback', `<div class="aiu7-actions"><button data-create>Create Snapshot</button></div>${rows}`, modal => {
      modal.querySelector('[data-create]').onclick = () => createSnapshot(prompt('Snapshot label', 'Manual Snapshot') || 'Manual Snapshot');
      modal.querySelectorAll('[data-restore]').forEach(btn => btn.onclick = () => restoreSnapshot(btn.dataset.restore));
      modal.querySelectorAll('[data-export]').forEach(btn => btn.onclick = () => downloadJSON(`aiu-snapshot-${btn.dataset.export}.json`, snaps.find(s => s.id === btn.dataset.export)));
    });
  }

  function enqueueTask(task) {
    const item = { id: uid(), status: 'queued', createdAt: now(), attempts: 0, ...(task || {}) };
    state.queue.unshift(item);
    state.queue = state.queue.slice(0, state.settings.maxQueueItems);
    saveJSON(STORAGE.queue, state.queue);
    persistQueueDB(item);
    notify('Task queued.');
  }

  async function persistQueueDB(item) {
    const db = await openDB();
    if (!db) return;
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').put(item);
  }

  async function runQueue() {
    for (const item of state.queue.filter(q => q.status === 'queued')) {
      item.status = 'running';
      item.startedAt = now();
      item.attempts += 1;
      try {
        if (item.type === 'snapshot') createSnapshot(item.label || 'Queued Snapshot');
        if (item.type === 'reindex') await rebuildIndex();
        if (item.type === 'export') downloadJSON(`aiu-queue-export-${Date.now()}.json`, { item, data: flattenItems() });
        item.status = 'done';
        item.completedAt = now();
      } catch (err) {
        item.status = 'failed';
        item.error = String(err?.message || err);
      }
      saveJSON(STORAGE.queue, state.queue);
      await persistQueueDB(item);
    }
    notify('Queue run complete.');
  }

  function openQueueUI() {
    const rows = state.queue.map(q => `<div class="aiu7-row"><strong>${escapeHTML(q.type || 'task')}</strong><span>${escapeHTML(q.status)}</span><span>${escapeHTML(q.createdAt)}</span><button data-remove="${q.id}">Remove</button></div>`).join('') || '<p>No queued tasks.</p>';
    openModal('Execution Queue', `<div class="aiu7-actions"><button data-snapshot>Queue Snapshot</button><button data-reindex>Queue Reindex</button><button data-export>Queue Export</button><button data-run>Run Queue</button></div>${rows}`, modal => {
      modal.querySelector('[data-snapshot]').onclick = () => enqueueTask({ type: 'snapshot', label: 'Queued Snapshot' });
      modal.querySelector('[data-reindex]').onclick = () => enqueueTask({ type: 'reindex' });
      modal.querySelector('[data-export]').onclick = () => enqueueTask({ type: 'export' });
      modal.querySelector('[data-run]').onclick = runQueue;
      modal.querySelectorAll('[data-remove]').forEach(btn => btn.onclick = () => { state.queue = state.queue.filter(q => q.id !== btn.dataset.remove); saveJSON(STORAGE.queue, state.queue); modal.remove(); openQueueUI(); });
    });
  }

  function openSettingsUI() {
    openModal('Agent 7 Settings', `
      <label><input type="checkbox" data-auto ${state.settings.autoIndex ? 'checked' : ''}> Auto index on load</label>
      <label>Max snapshots<input type="number" data-snaps value="${state.settings.maxSnapshots}"></label>
      <label>Max queue items<input type="number" data-queue value="${state.settings.maxQueueItems}"></label>
      <button data-save>Save</button>
    `, modal => {
      modal.querySelector('[data-save]').onclick = () => {
        state.settings.autoIndex = modal.querySelector('[data-auto]').checked;
        state.settings.maxSnapshots = Math.max(1, Number(modal.querySelector('[data-snaps]').value || 30));
        state.settings.maxQueueItems = Math.max(10, Number(modal.querySelector('[data-queue]').value || 200));
        saveJSON(STORAGE.perfSettings, state.settings);
        modal.remove();
        notify('Settings saved.');
      };
    });
  }

  function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function createPanel() {
    if (state.panel) state.panel.remove();
    state.panel = document.createElement('div');
    state.panel.className = 'aiu7-panel';
    state.panel.innerHTML = `
      <strong>AIU Perf</strong>
      <button data-action="search">Search</button>
      <button data-action="index">Reindex</button>
      <button data-action="snapshots">Snapshots</button>
      <button data-action="queue">Queue</button>
      <button data-action="settings">Settings</button>
    `;
    state.panel.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'search') openSearchUI();
      if (action === 'index') rebuildIndex();
      if (action === 'snapshots') openSnapshotsUI();
      if (action === 'queue') openQueueUI();
      if (action === 'settings') openSettingsUI();
    });
    document.body.appendChild(state.panel);
  }

  function injectStyles() {
    GM_addStyle(`
      .aiu7-panel,.aiu7-card,.aiu7-toast{font:13px system-ui,sans-serif;background:#052e2b;color:#ecfeff}.aiu7-panel{position:fixed;left:16px;bottom:416px;z-index:999993;border:1px solid #2dd4bf;border-radius:12px;padding:10px;display:flex;gap:6px;flex-wrap:wrap;max-width:430px;box-shadow:0 12px 30px #0008}.aiu7-panel button,.aiu7-card button{background:#2dd4bf;color:#052e2b;border:0;border-radius:8px;padding:6px 9px;cursor:pointer}.aiu7-modal{position:fixed;inset:0;z-index:1000011;background:#0008;display:grid;place-items:center}.aiu7-card{width:min(980px,92vw);max-height:86vh;overflow:auto;border-radius:14px;padding:18px;position:relative;border:1px solid #2dd4bf}.aiu7-close{position:absolute;right:12px;top:12px}.aiu7-card input{width:100%;box-sizing:border-box;background:#042f2e;color:#ecfeff;border:1px solid #2dd4bf;border-radius:8px;padding:8px}.aiu7-card label{display:grid;gap:4px;margin:10px 0}.aiu7-actions{display:flex;gap:6px;flex-wrap:wrap}.aiu7-row{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;border-bottom:1px solid #ffffff22;padding:8px 0}.aiu7-card pre{white-space:pre-wrap;background:#042f2e;padding:10px;border-radius:8px;overflow:auto}.aiu7-toast{position:fixed;left:18px;bottom:498px;z-index:1000012;padding:10px 14px;border-radius:10px;border:1px solid #2dd4bf}
    `);
  }

  function initMenu() {
    GM_registerMenuCommand('AIU Perf: Search', openSearchUI);
    GM_registerMenuCommand('AIU Perf: Rebuild Index', rebuildIndex);
    GM_registerMenuCommand('AIU Perf: Snapshots', openSnapshotsUI);
    GM_registerMenuCommand('AIU Perf: Queue', openQueueUI);
    GM_registerMenuCommand('AIU Perf: Settings', openSettingsUI);
  }

  async function init() {
    injectStyles();
    createPanel();
    initMenu();
    await openDB();
    if (state.settings.autoIndex) rebuildIndex();
  }

  init();
})();
