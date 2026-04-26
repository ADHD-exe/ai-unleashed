// ==UserScript==
// @name         AI Unleashed
// @namespace    https://github.com/ADHD-exe/ai-unleashed
// @version      0.2.0
// @description  Feature-rich userscript scaffold for ChatGPT and Claude: prompts, placeholders, themes, exports, navigation, pins, autocomplete, and AI enhancement hooks.
// @author       ADHD-exe
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://claude.ai/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      api.openai.com
// @connect      api.github.com
// @connect      gist.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const APP = 'ai-unleashed';
  const VERSION = '0.2.0';
  const STORAGE = {
    prompts: `${APP}:prompts`,
    settings: `${APP}:settings`,
    gist: `${APP}:gist`,
    pins: `${APP}:pins`,
    chats: `${APP}:chats`,
    ui: `${APP}:ui`,
  };

  const DEFAULT_SETTINGS = {
    theme: 'midnight',
    layout: 'floating',
    fontSize: 14,
    fontFamily: 'system-ui, sans-serif',
    apiEndpoint: '',
    apiKey: '',
    aiModel: 'gpt-4o-mini',
    gistToken: '',
    gistId: '',
    enableAutocomplete: true,
    enableSmartEditor: true,
    enableInputLauncher: true,
    enablePins: true,
  };

  const DEFAULT_UI = {
    panelOpen: true,
    panelX: null,
    panelY: null,
    launcherAttached: false,
  };

  const THEMES = {
    midnight: { bg: '#111827', fg: '#f9fafb', accent: '#60a5fa', panel: '#1f2937' },
    graphite: { bg: '#18181b', fg: '#fafafa', accent: '#a1a1aa', panel: '#27272a' },
    forest: { bg: '#052e16', fg: '#dcfce7', accent: '#22c55e', panel: '#064e3b' },
    violet: { bg: '#2e1065', fg: '#f5f3ff', accent: '#a78bfa', panel: '#4c1d95' },
  };

  const state = {
    settings: loadJSON(STORAGE.settings, DEFAULT_SETTINGS),
    ui: loadJSON(STORAGE.ui, DEFAULT_UI),
    prompts: [],
    platform: null,
    panel: null,
    observer: null,
    autocomplete: null,
    db: null,
  };

  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));

  function loadJSON(key, fallback) {
    try {
      const raw = GM_getValue(key, null);
      return raw ? { ...fallback, ...JSON.parse(raw) } : structuredClone(fallback);
    } catch (_) {
      return structuredClone(fallback);
    }
  }

  function saveJSON(key, value) {
    GM_setValue(key, JSON.stringify(value));
  }

  function normalizePrompt(input) {
    const p = typeof input === 'string' ? { title: input.slice(0, 60), body: input } : { ...input };
    return {
      id: p.id || uid(),
      title: String(p.title || 'Untitled Prompt').trim(),
      body: String(p.body || p.content || '').trim(),
      tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function loadPrompts() {
    const raw = loadJSON(STORAGE.prompts, []);
    state.prompts = Array.isArray(raw) ? raw.map(normalizePrompt) : [];
    savePrompts();
  }

  function savePrompts() {
    saveJSON(STORAGE.prompts, state.prompts);
  }

  function detectPlatform() {
    const host = location.hostname;
    if (host.includes('claude.ai')) return createClaudeAdapter();
    return createChatGPTAdapter();
  }

  function createChatGPTAdapter() {
    return {
      name: 'chatgpt',
      editorSelector: 'textarea, [contenteditable="true"]',
      launcherAnchorSelector: 'form, main textarea, [contenteditable="true"]',
      getEditor: () => document.querySelector('textarea, [contenteditable="true"]'),
      getMessages: () => [...document.querySelectorAll('[data-message-author-role], article')].map(el => el.innerText.trim()).filter(Boolean),
    };
  }

  function createClaudeAdapter() {
    return {
      name: 'claude',
      editorSelector: 'div[contenteditable="true"], textarea',
      launcherAnchorSelector: 'div[contenteditable="true"], textarea',
      getEditor: () => document.querySelector('div[contenteditable="true"], textarea'),
      getMessages: () => [...document.querySelectorAll('[data-testid*="message"], .font-claude-message')].map(el => el.innerText.trim()).filter(Boolean),
    };
  }

  function insertIntoEditor(text) {
    const editor = state.platform.getEditor();
    if (!editor) return notify('No editor detected.');
    if (editor.tagName === 'TEXTAREA') {
      const start = editor.selectionStart ?? editor.value.length;
      const end = editor.selectionEnd ?? editor.value.length;
      editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = start + text.length;
    } else {
      editor.focus();
      document.execCommand('insertText', false, text);
    }
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  function getEditorText() {
    const editor = state.platform.getEditor();
    return editor?.tagName === 'TEXTAREA' ? editor.value : editor?.innerText || '';
  }

  function parsePlaceholders(text) {
    return [...String(text).matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)(?::([^}]+))?\s*\}\}/g)].map(match => ({ token: match[0], key: match[1], fallback: match[2] || '' }));
  }

  async function resolvePlaceholders(text) {
    let out = String(text);
    for (const ph of parsePlaceholders(text)) {
      const value = prompt(`Value for ${ph.key}`, ph.fallback) ?? ph.fallback;
      out = out.replaceAll(ph.token, value);
    }
    return out;
  }

  async function insertPrompt(promptItem) {
    if (!promptItem) return notify('Prompt not found.');
    const p = normalizePrompt(promptItem);
    const rendered = await resolvePlaceholders(p.body);
    insertIntoEditor(rendered);
  }

  async function enhanceCurrentInput() {
    const editor = state.platform.getEditor();
    const text = getEditorText();
    if (!text.trim()) return notify('Nothing to enhance.');
    const enhanced = await callAIEnhance(text);
    openDiffModal(text, enhanced, next => {
      if (editor.tagName === 'TEXTAREA') editor.value = next;
      else editor.innerText = next;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
  }

  async function callAIEnhance(text) {
    if (!state.settings.apiKey || !state.settings.apiEndpoint) {
      return `${text}\n\n[Enhancement unavailable: configure API endpoint and key in Settings.]`;
    }
    return new Promise(resolve => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: state.settings.apiEndpoint,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.settings.apiKey}` },
        data: JSON.stringify({ model: state.settings.aiModel, messages: [{ role: 'user', content: `Improve this prompt without changing intent:\n\n${text}` }] }),
        onload: res => {
          try { resolve(JSON.parse(res.responseText).choices?.[0]?.message?.content || text); }
          catch (_) { resolve(text); }
        },
        onerror: () => resolve(text),
      });
    });
  }

  function openDiffModal(before, after, apply) {
    openModal('AI Enhancement Diff', `
      <div class="aiu-grid"><div><h4>Before</h4><pre>${escapeHTML(before)}</pre></div><div><h4>After</h4><pre>${escapeHTML(after)}</pre></div></div>
      <button data-aiu-apply>Apply Enhanced Text</button>
    `, modal => modal.querySelector('[data-aiu-apply]').onclick = () => { apply(after); modal.remove(); });
  }

  function createNavInterface() {
    const wrap = document.createElement('div');
    wrap.className = 'aiu-nav';
    wrap.innerHTML = `
      <button data-tab="prompts">Prompts</button>
      <button data-tab="pins">Pins</button>
      <button data-tab="settings">Settings</button>
      <button data-tab="export">Export</button>
      <button data-tab="chats">Chats</button>
      <button data-tab="collapse">${state.ui.panelOpen ? 'Hide' : 'Show'}</button>
    `;
    wrap.addEventListener('click', e => {
      const tab = e.target.closest('[data-tab]')?.dataset.tab;
      if (!tab) return;
      if (tab === 'prompts') openPromptExplorerModal();
      if (tab === 'pins') openPinsModal();
      if (tab === 'settings') openSettingsModal();
      if (tab === 'export') exportAllData();
      if (tab === 'chats') openChatManagerModal();
      if (tab === 'collapse') togglePanelOpen();
    });
    return wrap;
  }

  function initGistIntegration() {
    GM_registerMenuCommand('AI Unleashed: Sync to Gist', syncToGist);
    GM_registerMenuCommand('AI Unleashed: Import from Gist', importFromGist);
  }

  function syncToGist() {
    const payload = JSON.stringify({ settings: state.settings, prompts: state.prompts }, null, 2);
    if (!state.settings.gistToken) return notify('Configure a GitHub token before Gist sync.');
    const method = state.settings.gistId ? 'PATCH' : 'POST';
    const url = state.settings.gistId ? `https://api.github.com/gists/${state.settings.gistId}` : 'https://api.github.com/gists';
    GM_xmlhttpRequest({
      method,
      url,
      headers: { Authorization: `token ${state.settings.gistToken}`, 'Content-Type': 'application/json' },
      data: JSON.stringify({ description: 'AI Unleashed sync data', public: false, files: { 'ai-unleashed.json': { content: payload } } }),
      onload: res => {
        const data = JSON.parse(res.responseText || '{}');
        if (data.id) { state.settings.gistId = data.id; saveJSON(STORAGE.settings, state.settings); }
        notify('Gist sync complete.');
      },
      onerror: () => notify('Gist sync failed.'),
    });
  }

  function importFromGist() {
    if (!state.settings.gistId) return notify('No Gist ID configured.');
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://api.github.com/gists/${state.settings.gistId}`,
      headers: state.settings.gistToken ? { Authorization: `token ${state.settings.gistToken}` } : {},
      onload: res => {
        const data = JSON.parse(res.responseText || '{}');
        const content = data.files?.['ai-unleashed.json']?.content;
        if (!content) return notify('Gist payload not found.');
        const parsed = JSON.parse(content);
        state.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
        state.prompts = Array.isArray(parsed.prompts) ? parsed.prompts.map(normalizePrompt) : [];
        saveJSON(STORAGE.settings, state.settings); savePrompts(); applyTheme(); notify('Gist import complete.');
      },
      onerror: () => notify('Gist import failed.'),
    });
  }

  function exportAllData() {
    const data = { version: VERSION, exportedAt: new Date().toISOString(), settings: state.settings, prompts: state.prompts, ui: state.ui, chats: captureChat() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ai-unleashed-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function openPromptExplorerModal() {
    const rows = state.prompts.map(p => `<div class="aiu-row"><strong>${escapeHTML(p.title)}</strong><span>${escapeHTML(p.tags.join(', '))}</span><button data-insert="${p.id}">Insert</button><button data-pin="${p.id}">Pin</button><button data-edit="${p.id}">Edit</button><button data-delete="${p.id}">Delete</button></div>`).join('') || '<p>No prompts saved.</p>';
    openModal('Prompt Explorer', `
      <div class="aiu-actions"><button data-new>New Prompt</button><button data-import>Import JSON</button></div>
      <input data-filter placeholder="Filter prompts by title, body, or tag">
      <div data-list>${rows}</div>
    `, modal => {
      modal.querySelector('[data-new]').onclick = () => openPromptEditor();
      modal.querySelector('[data-import]').onclick = importPromptJSON;
      modal.querySelectorAll('[data-insert]').forEach(btn => btn.onclick = () => insertPrompt(state.prompts.find(p => p.id === btn.dataset.insert)));
      modal.querySelectorAll('[data-pin]').forEach(btn => btn.onclick = async () => { await savePinFromPrompt(btn.dataset.pin); notify('Prompt pinned.'); });
      modal.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openPromptEditor(state.prompts.find(p => p.id === btn.dataset.edit)));
      modal.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => { state.prompts = state.prompts.filter(p => p.id !== btn.dataset.delete); savePrompts(); modal.remove(); openPromptExplorerModal(); });
      modal.querySelector('[data-filter]').oninput = e => filterPromptRows(modal, e.target.value);
    });
  }

  function filterPromptRows(modal, query) {
    const q = query.trim().toLowerCase();
    modal.querySelectorAll('.aiu-row').forEach(row => row.hidden = q && !row.innerText.toLowerCase().includes(q));
  }

  function importPromptJSON() {
    const raw = prompt('Paste prompt JSON array or object');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      state.prompts = state.prompts.concat(items.map(normalizePrompt));
      savePrompts();
      notify('Prompts imported.');
    } catch (_) {
      notify('Invalid prompt JSON.');
    }
  }

  function openPromptEditor(existing = null) {
    const p = existing || normalizePrompt({});
    openModal(existing ? 'Edit Prompt' : 'New Prompt', `
      <label>Title<input data-title value="${escapeHTML(p.title)}"></label>
      <label>Tags<input data-tags value="${escapeHTML(p.tags.join(', '))}"></label>
      <label>Body<textarea data-body rows="10">${escapeHTML(p.body)}</textarea></label>
      <div class="aiu-actions"><button data-save>Save</button><button data-insert>Insert Draft</button></div>
    `, modal => {
      const body = modal.querySelector('[data-body]');
      initSmartEditor(body);
      modal.querySelector('[data-save]').onclick = () => {
        const next = normalizePrompt({ ...p, title: modal.querySelector('[data-title]').value, body: body.value, tags: modal.querySelector('[data-tags]').value.split(',').map(s => s.trim()).filter(Boolean) });
        state.prompts = state.prompts.filter(item => item.id !== next.id).concat(next);
        savePrompts(); modal.remove(); notify('Prompt saved.');
      };
      modal.querySelector('[data-insert]').onclick = () => insertPrompt({ title: modal.querySelector('[data-title]').value, body: body.value, tags: [] });
    });
  }

  function openSettingsModal() {
    openModal('AI Unleashed Settings', `
      <h3>Layout</h3><label>Panel layout<select data-setting="layout"><option ${state.settings.layout === 'floating' ? 'selected' : ''}>floating</option><option ${state.settings.layout === 'docked' ? 'selected' : ''}>docked</option><option ${state.settings.layout === 'hidden' ? 'selected' : ''}>hidden</option></select></label>
      <label><input type="checkbox" data-setting="enableInputLauncher" ${state.settings.enableInputLauncher ? 'checked' : ''}> Enable input-bar launcher</label>
      <h3>Font</h3><label>Font size<input type="number" data-setting="fontSize" value="${state.settings.fontSize}"></label><label>Font family<input data-setting="fontFamily" value="${escapeHTML(state.settings.fontFamily)}"></label>
      <h3>UI Theme</h3><label>Theme<select data-setting="theme">${Object.keys(THEMES).map(k => `<option ${k === state.settings.theme ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <h3>Interaction</h3><label><input type="checkbox" data-setting="enableAutocomplete" ${state.settings.enableAutocomplete ? 'checked' : ''}> Enable # prompt autocomplete</label><label><input type="checkbox" data-setting="enableSmartEditor" ${state.settings.enableSmartEditor ? 'checked' : ''}> Enable smart editor macros</label><label><input type="checkbox" data-setting="enablePins" ${state.settings.enablePins ? 'checked' : ''}> Enable IndexedDB pins</label>
      <h3>AI</h3><label>API endpoint<input data-setting="apiEndpoint" value="${escapeHTML(state.settings.apiEndpoint)}"></label><label>API key<input type="password" data-setting="apiKey" value="${escapeHTML(state.settings.apiKey)}"></label><label>Model<input data-setting="aiModel" value="${escapeHTML(state.settings.aiModel)}"></label>
      <h3>Gist</h3><label>Token<input type="password" data-setting="gistToken" value="${escapeHTML(state.settings.gistToken)}"></label><label>Gist ID<input data-setting="gistId" value="${escapeHTML(state.settings.gistId)}"></label>
      <button data-save>Save Settings</button>
    `, modal => {
      modal.querySelector('[data-save]').onclick = () => {
        modal.querySelectorAll('[data-setting]').forEach(input => {
          state.settings[input.dataset.setting] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
        });
        saveJSON(STORAGE.settings, state.settings); applyTheme(); createPanel(); attachInputLauncher(); modal.remove();
      };
    });
  }

  function initSmartEditor(textarea) {
    if (!state.settings.enableSmartEditor || !textarea) return;
    const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
    textarea.addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === 'b') { wrapSelection(textarea, '**', '**'); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'i') { wrapSelection(textarea, '_', '_'); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'k') { wrapSelection(textarea, '[', '](url)'); e.preventDefault(); }
      if (e.ctrlKey && e.key === '`') { wrapSelection(textarea, '`', '`'); e.preventDefault(); }
      if (pairs[e.key]) { wrapSelection(textarea, e.key, pairs[e.key]); e.preventDefault(); }
    });
  }

  function wrapSelection(el, left, right) {
    const s = el.selectionStart, e = el.selectionEnd;
    const selected = el.value.slice(s, e);
    el.value = el.value.slice(0, s) + left + selected + right + el.value.slice(e);
    el.selectionStart = s + left.length;
    el.selectionEnd = s + left.length + selected.length;
  }

  function captureChat() {
    return { platform: state.platform.name, url: location.href, capturedAt: new Date().toISOString(), messages: state.platform.getMessages() };
  }

  function openChatManagerModal() {
    const chat = captureChat();
    openModal('Chat Manager', `<p>${chat.messages.length} messages detected.</p><button data-export>Export Chat</button><button data-pin>Pin Snapshot</button><button data-top>Top</button><button data-bottom>Bottom</button>`, modal => {
      modal.querySelector('[data-export]').onclick = exportAllData;
      modal.querySelector('[data-pin]').onclick = async () => { await savePin({ type: 'chat', title: document.title || 'Chat Snapshot', body: JSON.stringify(chat, null, 2) }); notify('Chat snapshot pinned.'); };
      modal.querySelector('[data-top]').onclick = () => scrollTo({ top: 0, behavior: 'smooth' });
      modal.querySelector('[data-bottom]').onclick = () => scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
  }

  function openModal(title, html, bind) {
    const modal = document.createElement('div');
    modal.className = 'aiu-modal';
    modal.innerHTML = `<div class="aiu-modal-card"><button class="aiu-close">×</button><h2>${escapeHTML(title)}</h2>${html}</div>`;
    modal.querySelector('.aiu-close').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    bind?.(modal);
    return modal;
  }

  function notify(message) {
    const n = document.createElement('div');
    n.className = 'aiu-toast';
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
  }

  function applyTheme() {
    const t = THEMES[state.settings.theme] || THEMES.midnight;
    document.documentElement.style.setProperty('--aiu-bg', t.bg);
    document.documentElement.style.setProperty('--aiu-fg', t.fg);
    document.documentElement.style.setProperty('--aiu-accent', t.accent);
    document.documentElement.style.setProperty('--aiu-panel', t.panel);
    document.documentElement.style.setProperty('--aiu-font-size', `${state.settings.fontSize}px`);
    document.documentElement.style.setProperty('--aiu-font-family', state.settings.fontFamily);
  }

  function injectStyles() {
    GM_addStyle(`
      .aiu-panel,.aiu-modal-card,.aiu-toast,.aiu-autocomplete,.aiu-launcher-menu{font-family:var(--aiu-font-family);font-size:var(--aiu-font-size);background:var(--aiu-panel);color:var(--aiu-fg)}
      .aiu-panel{position:fixed;right:16px;bottom:16px;z-index:999999;border:1px solid var(--aiu-accent);border-radius:12px;padding:10px;box-shadow:0 12px 30px #0008}.aiu-panel.aiu-docked{top:0;right:0;bottom:0;width:270px;border-radius:0}.aiu-panel.aiu-hidden .aiu-panel-body{display:none}
      .aiu-drag{cursor:move;font-weight:700;margin-bottom:8px;color:var(--aiu-accent)}.aiu-nav,.aiu-actions{display:flex;gap:6px;flex-wrap:wrap}.aiu-nav button,.aiu-modal button,.aiu-panel button,.aiu-launcher-menu button{background:var(--aiu-accent);color:var(--aiu-bg);border:0;border-radius:8px;padding:6px 10px;cursor:pointer}
      .aiu-modal{position:fixed;inset:0;z-index:1000000;background:#0008;display:grid;place-items:center}.aiu-modal-card{width:min(920px,92vw);max-height:86vh;overflow:auto;border-radius:14px;padding:18px;position:relative}.aiu-close{position:absolute;right:12px;top:12px}
      .aiu-modal label{display:grid;gap:4px;margin:10px 0}.aiu-modal input,.aiu-modal textarea,.aiu-modal select{width:100%;box-sizing:border-box;background:var(--aiu-bg);color:var(--aiu-fg);border:1px solid var(--aiu-accent);border-radius:8px;padding:8px}
      .aiu-row{display:grid;grid-template-columns:1fr auto auto auto auto;gap:8px;align-items:center;border-bottom:1px solid #ffffff22;padding:8px 0}.aiu-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.aiu-grid pre{white-space:pre-wrap;background:var(--aiu-bg);padding:10px;border-radius:8px}.aiu-toast{position:fixed;right:18px;bottom:88px;z-index:1000001;padding:10px 14px;border-radius:10px;border:1px solid var(--aiu-accent)}
      .aiu-autocomplete{position:fixed;z-index:1000002;border:1px solid var(--aiu-accent);border-radius:10px;box-shadow:0 12px 30px #0008;max-height:260px;overflow:auto;min-width:260px}.aiu-suggestion{padding:8px 10px;cursor:pointer}.aiu-suggestion:hover,.aiu-suggestion[aria-selected="true"]{background:var(--aiu-accent);color:var(--aiu-bg)}
      .aiu-input-launcher{position:fixed;right:22px;bottom:92px;z-index:999998}.aiu-input-launcher>button{border-radius:999px;border:1px solid var(--aiu-accent);background:var(--aiu-panel);color:var(--aiu-fg);padding:8px 12px;cursor:pointer}.aiu-launcher-menu{position:absolute;right:0;bottom:42px;display:none;border:1px solid var(--aiu-accent);border-radius:12px;padding:8px;min-width:180px;box-shadow:0 12px 30px #0008}.aiu-input-launcher:hover .aiu-launcher-menu{display:grid;gap:6px}
    `);
  }

  function createPanel() {
    if (state.panel) state.panel.remove();
    if (state.settings.layout === 'hidden') return;
    state.panel = document.createElement('div');
    state.panel.className = `aiu-panel ${state.settings.layout === 'docked' ? 'aiu-docked' : ''} ${state.ui.panelOpen ? '' : 'aiu-hidden'}`;
    if (state.ui.panelX !== null && state.settings.layout === 'floating') {
      state.panel.style.left = `${state.ui.panelX}px`;
      state.panel.style.top = `${state.ui.panelY}px`;
      state.panel.style.right = 'auto';
      state.panel.style.bottom = 'auto';
    }
    state.panel.innerHTML = '<div class="aiu-drag">AI Unleashed</div><div class="aiu-panel-body"></div>';
    state.panel.querySelector('.aiu-panel-body').appendChild(createNavInterface());
    const enhance = document.createElement('button');
    enhance.textContent = 'Enhance Input';
    enhance.onclick = enhanceCurrentInput;
    state.panel.querySelector('.aiu-panel-body').appendChild(enhance);
    document.body.appendChild(state.panel);
    makeDraggable(state.panel, state.panel.querySelector('.aiu-drag'));
  }

  function togglePanelOpen() {
    state.ui.panelOpen = !state.ui.panelOpen;
    saveJSON(STORAGE.ui, state.ui);
    createPanel();
  }

  function makeDraggable(el, handle) {
    if (!handle || state.settings.layout !== 'floating') return;
    let sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('pointerdown', e => {
      sx = e.clientX; sy = e.clientY; const rect = el.getBoundingClientRect(); ox = rect.left; oy = rect.top; handle.setPointerCapture(e.pointerId);
      const move = ev => { el.style.left = `${ox + ev.clientX - sx}px`; el.style.top = `${oy + ev.clientY - sy}px`; el.style.right = 'auto'; el.style.bottom = 'auto'; };
      const up = ev => { handle.releasePointerCapture(ev.pointerId); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); const r = el.getBoundingClientRect(); state.ui.panelX = Math.max(0, r.left); state.ui.panelY = Math.max(0, r.top); saveJSON(STORAGE.ui, state.ui); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    });
  }

  function attachInputLauncher() {
    document.querySelectorAll('.aiu-input-launcher').forEach(el => el.remove());
    if (!state.settings.enableInputLauncher) return;
    const launcher = document.createElement('div');
    launcher.className = 'aiu-input-launcher';
    launcher.innerHTML = `<button>Prompts</button><div class="aiu-launcher-menu"><button data-action="search">Search</button><button data-action="expand">Expand</button><button data-action="filter">Filter</button><button data-action="import">Import Prompt</button><button data-action="export">Export Prompt</button><button data-action="save">Save Prompt</button><button data-action="enhance">Enhance with AI</button></div>`;
    launcher.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'search' || action === 'filter') openPromptExplorerModal();
      if (action === 'expand') openPromptEditor({ title: 'Expanded Draft', body: getEditorText(), tags: ['draft'] });
      if (action === 'import') importPromptJSON();
      if (action === 'export') exportAllData();
      if (action === 'save') saveCurrentInputAsPrompt();
      if (action === 'enhance') enhanceCurrentInput();
    });
    document.body.appendChild(launcher);
  }

  function saveCurrentInputAsPrompt() {
    const body = getEditorText();
    if (!body.trim()) return notify('No input text to save.');
    const title = prompt('Prompt title', body.slice(0, 60)) || 'Saved Prompt';
    state.prompts.push(normalizePrompt({ title, body, tags: ['saved'] }));
    savePrompts();
    notify('Current input saved as prompt.');
  }

  function initAutocomplete() {
    document.addEventListener('input', handleAutocompleteInput, true);
    document.addEventListener('keydown', handleAutocompleteKeys, true);
    document.addEventListener('click', e => { if (!e.target.closest('.aiu-autocomplete')) closeAutocomplete(); }, true);
  }

  function handleAutocompleteInput(e) {
    if (!state.settings.enableAutocomplete) return;
    const editor = state.platform.getEditor();
    if (!editor || e.target !== editor) return;
    const text = getEditorText();
    const cursor = editor.tagName === 'TEXTAREA' ? editor.selectionStart : text.length;
    const prefix = text.slice(0, cursor).match(/#([\w-]{1,40})$/);
    if (!prefix) return closeAutocomplete();
    const q = prefix[1].toLowerCase();
    const matches = state.prompts.filter(p => p.title.toLowerCase().includes(q) || p.tags.some(t => t.toLowerCase().includes(q))).slice(0, 8);
    if (!matches.length) return closeAutocomplete();
    openAutocomplete(editor, matches, prefix[0].length);
  }

  function openAutocomplete(editor, matches, replaceLength) {
    closeAutocomplete();
    const box = document.createElement('div');
    box.className = 'aiu-autocomplete';
    const rect = editor.getBoundingClientRect();
    box.style.left = `${Math.max(8, rect.left)}px`;
    box.style.top = `${Math.max(8, rect.top - 280)}px`;
    box.innerHTML = matches.map((p, i) => `<div class="aiu-suggestion" data-id="${p.id}" aria-selected="${i === 0}"><strong>${escapeHTML(p.title)}</strong><br><small>${escapeHTML(p.tags.join(', '))}</small></div>`).join('');
    box.addEventListener('click', e => {
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (id) applyAutocomplete(editor, state.prompts.find(p => p.id === id), replaceLength);
    });
    document.body.appendChild(box);
    state.autocomplete = { box, matches, replaceLength, index: 0 };
  }

  function handleAutocompleteKeys(e) {
    if (!state.autocomplete) return;
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'Escape') return closeAutocomplete();
    if (e.key === 'ArrowDown') state.autocomplete.index = (state.autocomplete.index + 1) % state.autocomplete.matches.length;
    if (e.key === 'ArrowUp') state.autocomplete.index = (state.autocomplete.index - 1 + state.autocomplete.matches.length) % state.autocomplete.matches.length;
    if (e.key === 'Enter') return applyAutocomplete(state.platform.getEditor(), state.autocomplete.matches[state.autocomplete.index], state.autocomplete.replaceLength);
    state.autocomplete.box.querySelectorAll('.aiu-suggestion').forEach((el, i) => el.setAttribute('aria-selected', String(i === state.autocomplete.index)));
  }

  async function applyAutocomplete(editor, promptItem, replaceLength) {
    if (!promptItem) return;
    const rendered = await resolvePlaceholders(promptItem.body);
    if (editor.tagName === 'TEXTAREA') {
      const end = editor.selectionStart;
      const start = Math.max(0, end - replaceLength);
      editor.value = editor.value.slice(0, start) + rendered + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = start + rendered.length;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    } else {
      insertIntoEditor(rendered);
    }
    closeAutocomplete();
  }

  function closeAutocomplete() {
    state.autocomplete?.box?.remove();
    state.autocomplete = null;
  }

  function openPinDB() {
    if (!state.settings.enablePins) return Promise.resolve(null);
    if (state.db) return Promise.resolve(state.db);
    return new Promise(resolve => {
      const req = indexedDB.open(`${APP}-db`, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('pins', { keyPath: 'id' });
      req.onsuccess = () => { state.db = req.result; resolve(state.db); };
      req.onerror = () => resolve(null);
    });
  }

  async function savePin(pin) {
    const db = await openPinDB();
    if (!db) return notify('IndexedDB unavailable.');
    const item = { id: pin.id || uid(), type: pin.type || 'note', title: pin.title || 'Pinned Item', body: pin.body || '', url: location.href, createdAt: pin.createdAt || new Date().toISOString() };
    return new Promise(resolve => {
      const tx = db.transaction('pins', 'readwrite');
      tx.objectStore('pins').put(item);
      tx.oncomplete = resolve;
    });
  }

  async function savePinFromPrompt(id) {
    const p = state.prompts.find(item => item.id === id);
    if (!p) return;
    await savePin({ type: 'prompt', title: p.title, body: p.body });
  }

  async function listPins() {
    const db = await openPinDB();
    if (!db) return [];
    return new Promise(resolve => {
      const req = db.transaction('pins').objectStore('pins').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async function deletePin(id) {
    const db = await openPinDB();
    if (!db) return;
    return new Promise(resolve => {
      const tx = db.transaction('pins', 'readwrite');
      tx.objectStore('pins').delete(id);
      tx.oncomplete = resolve;
    });
  }

  async function openPinsModal() {
    const pins = await listPins();
    const rows = pins.map(p => `<div class="aiu-row"><strong>${escapeHTML(p.title)}</strong><span>${escapeHTML(p.type)}</span><button data-insert="${p.id}">Insert</button><button data-copy="${p.id}">Copy</button><button data-delete="${p.id}">Delete</button></div>`).join('') || '<p>No pins saved.</p>';
    openModal('Pinned Items', `<div class="aiu-actions"><button data-pin-current>Pin Current Input</button></div><div>${rows}</div>`, modal => {
      modal.querySelector('[data-pin-current]').onclick = async () => { await savePin({ type: 'input', title: 'Pinned Input', body: getEditorText() }); modal.remove(); openPinsModal(); };
      modal.querySelectorAll('[data-insert]').forEach(btn => btn.onclick = () => insertIntoEditor(pins.find(p => p.id === btn.dataset.insert)?.body || ''));
      modal.querySelectorAll('[data-copy]').forEach(btn => btn.onclick = () => navigator.clipboard?.writeText(pins.find(p => p.id === btn.dataset.copy)?.body || '').then(() => notify('Copied.')));
      modal.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = async () => { await deletePin(btn.dataset.delete); modal.remove(); openPinsModal(); });
    });
  }

  function initObserver() {
    state.observer?.disconnect();
    state.observer = new MutationObserver(() => attachInputLauncher());
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function initMenu() {
    GM_registerMenuCommand('AI Unleashed: Prompts', openPromptExplorerModal);
    GM_registerMenuCommand('AI Unleashed: Pins', openPinsModal);
    GM_registerMenuCommand('AI Unleashed: Settings', openSettingsModal);
    GM_registerMenuCommand('AI Unleashed: Export All Data', exportAllData);
  }

  function init() {
    state.platform = detectPlatform();
    loadPrompts();
    injectStyles();
    applyTheme();
    createPanel();
    attachInputLauncher();
    initAutocomplete();
    initObserver();
    initMenu();
    initGistIntegration();
  }

  init();
})();
