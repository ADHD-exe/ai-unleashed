// ==UserScript==
// @name         AI Unleashed
// @namespace    https://github.com/ADHD-exe/ai-unleashed
// @version      0.1.0
// @description  Feature-rich userscript scaffold for ChatGPT and Claude: prompts, placeholders, themes, exports, navigation, and AI enhancement hooks.
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
  const VERSION = '0.1.0';
  const STORAGE = {
    prompts: `${APP}:prompts`,
    settings: `${APP}:settings`,
    gist: `${APP}:gist`,
    pins: `${APP}:pins`,
    chats: `${APP}:chats`,
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
  };

  const THEMES = {
    midnight: { bg: '#111827', fg: '#f9fafb', accent: '#60a5fa', panel: '#1f2937' },
    graphite: { bg: '#18181b', fg: '#fafafa', accent: '#a1a1aa', panel: '#27272a' },
    forest: { bg: '#052e16', fg: '#dcfce7', accent: '#22c55e', panel: '#064e3b' },
    violet: { bg: '#2e1065', fg: '#f5f3ff', accent: '#a78bfa', panel: '#4c1d95' },
  };

  const state = {
    settings: loadJSON(STORAGE.settings, DEFAULT_SETTINGS),
    prompts: [],
    platform: null,
    panel: null,
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
      getEditor: () => document.querySelector('textarea, [contenteditable="true"]'),
      getMessages: () => [...document.querySelectorAll('[data-message-author-role], article')].map(el => el.innerText.trim()).filter(Boolean),
    };
  }

  function createClaudeAdapter() {
    return {
      name: 'claude',
      editorSelector: 'div[contenteditable="true"], textarea',
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
    const p = normalizePrompt(promptItem);
    const rendered = await resolvePlaceholders(p.body);
    insertIntoEditor(rendered);
  }

  async function enhanceCurrentInput() {
    const editor = state.platform.getEditor();
    const text = editor?.value || editor?.innerText || '';
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
      <button data-tab="settings">Settings</button>
      <button data-tab="export">Export</button>
      <button data-tab="chats">Chats</button>
    `;
    wrap.addEventListener('click', e => {
      const tab = e.target.closest('[data-tab]')?.dataset.tab;
      if (!tab) return;
      if (tab === 'prompts') openPromptExplorerModal();
      if (tab === 'settings') openSettingsModal();
      if (tab === 'export') exportAllData();
      if (tab === 'chats') openChatManagerModal();
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
    const data = { version: VERSION, exportedAt: new Date().toISOString(), settings: state.settings, prompts: state.prompts, chats: captureChat() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ai-unleashed-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function openPromptExplorerModal() {
    const rows = state.prompts.map(p => `<div class="aiu-row"><strong>${escapeHTML(p.title)}</strong><button data-insert="${p.id}">Insert</button><button data-edit="${p.id}">Edit</button><button data-delete="${p.id}">Delete</button></div>`).join('') || '<p>No prompts saved.</p>';
    openModal('Prompt Explorer', `
      <button data-new>New Prompt</button>
      <div>${rows}</div>
    `, modal => {
      modal.querySelector('[data-new]').onclick = () => openPromptEditor();
      modal.querySelectorAll('[data-insert]').forEach(btn => btn.onclick = () => insertPrompt(state.prompts.find(p => p.id === btn.dataset.insert)));
      modal.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openPromptEditor(state.prompts.find(p => p.id === btn.dataset.edit)));
      modal.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => { state.prompts = state.prompts.filter(p => p.id !== btn.dataset.delete); savePrompts(); modal.remove(); openPromptExplorerModal(); });
    });
  }

  function openPromptEditor(existing = null) {
    const p = existing || normalizePrompt({});
    openModal(existing ? 'Edit Prompt' : 'New Prompt', `
      <label>Title<input data-title value="${escapeHTML(p.title)}"></label>
      <label>Tags<input data-tags value="${escapeHTML(p.tags.join(', '))}"></label>
      <label>Body<textarea data-body rows="10">${escapeHTML(p.body)}</textarea></label>
      <button data-save>Save</button>
    `, modal => {
      const body = modal.querySelector('[data-body]');
      initSmartEditor(body);
      modal.querySelector('[data-save]').onclick = () => {
        const next = normalizePrompt({ ...p, title: modal.querySelector('[data-title]').value, body: body.value, tags: modal.querySelector('[data-tags]').value.split(',').map(s => s.trim()).filter(Boolean) });
        state.prompts = state.prompts.filter(item => item.id !== next.id).concat(next);
        savePrompts(); modal.remove();
      };
    });
  }

  function openSettingsModal() {
    openModal('AI Unleashed Settings', `
      <h3>Layout</h3><label>Panel layout<select data-setting="layout"><option>floating</option><option>docked</option></select></label>
      <h3>Font</h3><label>Font size<input type="number" data-setting="fontSize" value="${state.settings.fontSize}"></label><label>Font family<input data-setting="fontFamily" value="${escapeHTML(state.settings.fontFamily)}"></label>
      <h3>UI Theme</h3><label>Theme<select data-setting="theme">${Object.keys(THEMES).map(k => `<option ${k === state.settings.theme ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <h3>AI</h3><label>API endpoint<input data-setting="apiEndpoint" value="${escapeHTML(state.settings.apiEndpoint)}"></label><label>API key<input type="password" data-setting="apiKey" value="${escapeHTML(state.settings.apiKey)}"></label>
      <h3>Gist</h3><label>Token<input type="password" data-setting="gistToken" value="${escapeHTML(state.settings.gistToken)}"></label><label>Gist ID<input data-setting="gistId" value="${escapeHTML(state.settings.gistId)}"></label>
      <button data-save>Save Settings</button>
    `, modal => {
      modal.querySelector('[data-save]').onclick = () => {
        modal.querySelectorAll('[data-setting]').forEach(input => state.settings[input.dataset.setting] = input.type === 'number' ? Number(input.value) : input.value);
        saveJSON(STORAGE.settings, state.settings); applyTheme(); modal.remove();
      };
    });
  }

  function initSmartEditor(textarea) {
    if (!state.settings.enableSmartEditor || !textarea) return;
    const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
    textarea.addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === 'b') { wrapSelection(textarea, '**', '**'); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'i') { wrapSelection(textarea, '_', '_'); e.preventDefault(); }
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
    openModal('Chat Manager', `<p>${chat.messages.length} messages detected.</p><button data-export>Export Chat</button><button data-top>Top</button><button data-bottom>Bottom</button>`, modal => {
      modal.querySelector('[data-export]').onclick = exportAllData;
      modal.querySelector('[data-top]').onclick = () => scrollTo({ top: 0, behavior: 'smooth' });
      modal.querySelector('[data-bottom]').onclick = () => scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
  }

  function openModal(title, html, bind) {
    const modal = document.createElement('div');
    modal.className = 'aiu-modal';
    modal.innerHTML = `<div class="aiu-modal-card"><button class="aiu-close">×</button><h2>${escapeHTML(title)}</h2>${html}</div>`;
    modal.querySelector('.aiu-close').onclick = () => modal.remove();
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
      .aiu-panel,.aiu-modal-card,.aiu-toast{font-family:var(--aiu-font-family);font-size:var(--aiu-font-size);background:var(--aiu-panel);color:var(--aiu-fg)}
      .aiu-panel{position:fixed;right:16px;bottom:16px;z-index:999999;border:1px solid var(--aiu-accent);border-radius:12px;padding:10px;box-shadow:0 12px 30px #0008}
      .aiu-nav{display:flex;gap:6px;flex-wrap:wrap}.aiu-nav button,.aiu-modal button{background:var(--aiu-accent);color:var(--aiu-bg);border:0;border-radius:8px;padding:6px 10px;cursor:pointer}
      .aiu-modal{position:fixed;inset:0;z-index:1000000;background:#0008;display:grid;place-items:center}.aiu-modal-card{width:min(920px,92vw);max-height:86vh;overflow:auto;border-radius:14px;padding:18px;position:relative}.aiu-close{position:absolute;right:12px;top:12px}
      .aiu-modal label{display:grid;gap:4px;margin:10px 0}.aiu-modal input,.aiu-modal textarea,.aiu-modal select{width:100%;box-sizing:border-box;background:var(--aiu-bg);color:var(--aiu-fg);border:1px solid var(--aiu-accent);border-radius:8px;padding:8px}
      .aiu-row{display:flex;gap:8px;align-items:center;justify-content:space-between;border-bottom:1px solid #ffffff22;padding:8px 0}.aiu-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.aiu-grid pre{white-space:pre-wrap;background:var(--aiu-bg);padding:10px;border-radius:8px}.aiu-toast{position:fixed;right:18px;bottom:88px;z-index:1000001;padding:10px 14px;border-radius:10px;border:1px solid var(--aiu-accent)}
    `);
  }

  function createPanel() {
    if (state.panel) state.panel.remove();
    state.panel = document.createElement('div');
    state.panel.className = 'aiu-panel';
    state.panel.appendChild(createNavInterface());
    const enhance = document.createElement('button');
    enhance.textContent = 'Enhance Input';
    enhance.onclick = enhanceCurrentInput;
    state.panel.appendChild(enhance);
    document.body.appendChild(state.panel);
  }

  function initMenu() {
    GM_registerMenuCommand('AI Unleashed: Prompts', openPromptExplorerModal);
    GM_registerMenuCommand('AI Unleashed: Settings', openSettingsModal);
    GM_registerMenuCommand('AI Unleashed: Export All Data', exportAllData);
  }

  function init() {
    state.platform = detectPlatform();
    loadPrompts();
    injectStyles();
    applyTheme();
    createPanel();
    initMenu();
    initGistIntegration();
  }

  init();
})();
