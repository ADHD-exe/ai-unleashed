// ==UserScript==
// @name         AI Unleashed - Agent 9 Sync & Packaging
// @namespace    https://github.com/ADHD-exe/ai-unleashed
// @version      0.9.0
// @description  Sync helpers (import/export with conflict detection) and packaging metadata for AI Unleashed.
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
  const VERSION = '0.9.0-agent9-sync-packaging';
  const STORAGE = {
    prompts: `${APP}:prompts`,
    workflows: `${APP}:workflows`,
    dslSnippets: `${APP}:dslSnippets`,
    orchestrations: `${APP}:orchestrations`,
    syncMeta: `${APP}:syncMeta`,
  };

  const state = {
    panel: null,
    meta: loadJSON(STORAGE.syncMeta, { lastSync: null, deviceId: makeDeviceId() }),
  };

  const now = () => new Date().toISOString();
  const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));

  function makeDeviceId() {
    return `dev-${Math.random().toString(36).slice(2, 10)}`;
  }

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
    n.className = 'aiu9-toast';
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
  }

  function openModal(title, html, bind) {
    const modal = document.createElement('div');
    modal.className = 'aiu9-modal';
    modal.innerHTML = `<div class="aiu9-card"><button class="aiu9-close">×</button><h2>${escapeHTML(title)}</h2>${html}</div>`;
    modal.querySelector('.aiu9-close').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    bind?.(modal);
    return modal;
  }

  function buildBundle() {
    return {
      version: VERSION,
      exportedAt: now(),
      deviceId: state.meta.deviceId,
      prompts: loadArray(STORAGE.prompts),
      workflows: loadArray(STORAGE.workflows),
      dslSnippets: loadArray(STORAGE.dslSnippets),
      orchestrations: loadArray(STORAGE.orchestrations),
    };
  }

  function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportBundle() {
    downloadJSON(`ai-unleashed-sync-${new Date().toISOString().slice(0, 10)}.json`, buildBundle());
    state.meta.lastSync = now();
    saveJSON(STORAGE.syncMeta, state.meta);
    notify('Sync bundle exported.');
  }

  function detectConflicts(localArr, incomingArr) {
    const map = new Map(localArr.map(i => [i.id, i]));
    const conflicts = [];
    incomingArr.forEach(item => {
      const local = map.get(item.id);
      if (!local) return;
      const lu = new Date(local.updatedAt || 0).getTime();
      const iu = new Date(item.updatedAt || 0).getTime();
      if (lu !== iu) conflicts.push({ id: item.id, local, incoming: item });
    });
    return conflicts;
  }

  function mergeArrays(localArr, incomingArr, strategy = 'latest-wins') {
    const out = [...localArr];
    const byId = new Map(out.map(i => [i.id, i]));
    incomingArr.forEach(item => {
      const existing = byId.get(item.id);
      if (!existing) { out.push(item); byId.set(item.id, item); return; }
      const lu = new Date(existing.updatedAt || 0).getTime();
      const iu = new Date(item.updatedAt || 0).getTime();
      if (strategy === 'latest-wins') {
        if (iu >= lu) {
          const idx = out.findIndex(x => x.id === item.id);
          out[idx] = item;
        }
      }
    });
    return out;
  }

  function importBundle() {
    const raw = prompt('Paste sync bundle JSON');
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const prompts = loadArray(STORAGE.prompts);
      const workflows = loadArray(STORAGE.workflows);
      const dslSnippets = loadArray(STORAGE.dslSnippets);
      const orchestrations = loadArray(STORAGE.orchestrations);

      const conflicts = []
        .concat(detectConflicts(prompts, data.prompts || []))
        .concat(detectConflicts(workflows, data.workflows || []))
        .concat(detectConflicts(dslSnippets, data.dslSnippets || []))
        .concat(detectConflicts(orchestrations, data.orchestrations || []));

      if (conflicts.length) {
        openModal('Sync Conflicts Detected', `<p>${conflicts.length} conflicts found.</p><button data-continue>Continue (latest wins)</button>`, modal => {
          modal.querySelector('[data-continue]').onclick = () => {
            applyMerge(data);
            modal.remove();
          };
        });
      } else {
        applyMerge(data);
      }
    } catch (_) {
      notify('Invalid sync bundle JSON.');
    }
  }

  function applyMerge(data) {
    saveJSON(STORAGE.prompts, mergeArrays(loadArray(STORAGE.prompts), data.prompts || []));
    saveJSON(STORAGE.workflows, mergeArrays(loadArray(STORAGE.workflows), data.workflows || []));
    saveJSON(STORAGE.dslSnippets, mergeArrays(loadArray(STORAGE.dslSnippets), data.dslSnippets || []));
    saveJSON(STORAGE.orchestrations, mergeArrays(loadArray(STORAGE.orchestrations), data.orchestrations || []));
    state.meta.lastSync = now();
    saveJSON(STORAGE.syncMeta, state.meta);
    notify('Sync bundle imported (merged). Reload recommended.');
  }

  function openSyncUI() {
    openModal('Sync & Packaging', `
      <p>Device ID: <code>${escapeHTML(state.meta.deviceId)}</code></p>
      <p>Last Sync: ${escapeHTML(state.meta.lastSync || 'never')}</p>
      <div class="aiu9-actions">
        <button data-export>Export Bundle</button>
        <button data-import>Import Bundle</button>
      </div>
    `, modal => {
      modal.querySelector('[data-export]').onclick = exportBundle;
      modal.querySelector('[data-import]').onclick = importBundle;
    });
  }

  function createPanel() {
    if (state.panel) state.panel.remove();
    state.panel = document.createElement('div');
    state.panel.className = 'aiu9-panel';
    state.panel.innerHTML = `
      <strong>AIU Sync</strong>
      <button data-action="sync">Sync</button>
      <button data-action="export">Export</button>
      <button data-action="import">Import</button>
    `;
    state.panel.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'sync') openSyncUI();
      if (action === 'export') exportBundle();
      if (action === 'import') importBundle();
    });
    document.body.appendChild(state.panel);
  }

  function injectStyles() {
    GM_addStyle(`
      .aiu9-panel,.aiu9-card,.aiu9-toast{font:13px system-ui,sans-serif;background:#111827;color:#e5e7eb}.aiu9-panel{position:fixed;left:16px;bottom:616px;z-index:999991;border:1px solid #60a5fa;border-radius:12px;padding:10px;display:flex;gap:6px;flex-wrap:wrap;max-width:430px;box-shadow:0 12px 30px #0008}.aiu9-panel button,.aiu9-card button{background:#60a5fa;color:#111827;border:0;border-radius:8px;padding:6px 9px;cursor:pointer}.aiu9-modal{position:fixed;inset:0;z-index:1000015;background:#0008;display:grid;place-items:center}.aiu9-card{width:min(780px,92vw);max-height:86vh;overflow:auto;border-radius:14px;padding:18px;position:relative;border:1px solid #60a5fa}.aiu9-close{position:absolute;right:12px;top:12px}.aiu9-actions{display:flex;gap:6px;flex-wrap:wrap}.aiu9-toast{position:fixed;left:18px;bottom:698px;z-index:1000016;padding:10px 14px;border-radius:10px;border:1px solid #60a5fa}
    `);
  }

  function initMenu() {
    GM_registerMenuCommand('AIU Sync: Open', openSyncUI);
    GM_registerMenuCommand('AIU Sync: Export', exportBundle);
    GM_registerMenuCommand('AIU Sync: Import', importBundle);
  }

  function init() {
    injectStyles();
    createPanel();
    initMenu();
  }

  init();
})();
