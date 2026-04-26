// ==UserScript==
// @name         AI Unleashed - Agent 8 Reactive AI
// @namespace    https://github.com/ADHD-exe/ai-unleashed
// @version      0.8.0
// @description  AI response capture and reactive execution layer for AI Unleashed.
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
  const VERSION = '0.8.0-agent8-reactive-ai';
  const STORAGE = {
    responses: `${APP}:capturedResponses`,
    reactiveRules: `${APP}:reactiveRules`,
    orchestrations: `${APP}:orchestrations`,
    reactiveRuns: `${APP}:reactiveRuns`,
    settings: `${APP}:reactiveSettings`,
  };

  const DEFAULT_SETTINGS = {
    autoCapture: true,
    maxResponses: 200,
    minResponseChars: 20,
  };

  const state = {
    panel: null,
    observer: null,
    seen: new Set(),
    settings: loadJSON(STORAGE.settings, DEFAULT_SETTINGS),
    rules: loadArray(STORAGE.reactiveRules),
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
    n.className = 'aiu8-toast';
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
  }

  function openModal(title, html, bind) {
    const modal = document.createElement('div');
    modal.className = 'aiu8-modal';
    modal.innerHTML = `<div class="aiu8-card"><button class="aiu8-close">×</button><h2>${escapeHTML(title)}</h2>${html}</div>`;
    modal.querySelector('.aiu8-close').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    bind?.(modal);
    return modal;
  }

  function getAssistantNodes() {
    return [...document.querySelectorAll('[data-message-author-role="assistant"], article, [data-testid*="message"], .font-claude-message')]
      .filter(el => (el.innerText || '').trim().length >= state.settings.minResponseChars);
  }

  function hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return String(hash);
  }

  function captureResponses() {
    const captures = loadArray(STORAGE.responses);
    let added = 0;
    getAssistantNodes().forEach((el, index) => {
      const text = (el.innerText || '').trim();
      const hash = hashText(text);
      if (state.seen.has(hash) || captures.some(r => r.hash === hash)) return;
      state.seen.add(hash);
      captures.unshift({ id: uid(), hash, index, text, url: location.href, title: document.title, capturedAt: now(), extracted: extractStructured(text) });
      added++;
    });
    if (added) {
      saveJSON(STORAGE.responses, captures.slice(0, state.settings.maxResponses));
      evaluateReactiveRules(captures.slice(0, added));
    }
    return added;
  }

  function extractStructured(text) {
    const fenced = [...String(text).matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1].trim());
    const json = [];
    fenced.forEach(block => {
      try { json.push(JSON.parse(block)); } catch (_) {}
    });
    return {
      fencedBlocks: fenced,
      json,
      headings: String(text).split('\n').filter(line => /^#{1,6}\s+/.test(line.trim())),
      bullets: String(text).split('\n').filter(line => /^\s*[-*+]\s+/.test(line)),
    };
  }

  function normalizeRule(input) {
    const r = { ...(input || {}) };
    return {
      id: r.id || uid(),
      title: String(r.title || 'Untitled Rule').trim(),
      enabled: r.enabled !== false,
      match: String(r.match || '').trim(),
      mode: ['contains', 'regex', 'json'].includes(r.mode) ? r.mode : 'contains',
      action: ['insertText', 'queueOrchestration', 'saveVariable', 'notify'].includes(r.action) ? r.action : 'notify',
      orchestrationId: r.orchestrationId || '',
      text: String(r.text || '').trim(),
      variableName: String(r.variableName || '').trim(),
      createdAt: r.createdAt || now(),
      updatedAt: now(),
    };
  }

  function ruleMatches(rule, response) {
    if (!rule.enabled) return false;
    if (rule.mode === 'contains') return response.text.toLowerCase().includes(rule.match.toLowerCase());
    if (rule.mode === 'regex') {
      try { return new RegExp(rule.match, 'i').test(response.text); } catch (_) { return false; }
    }
    if (rule.mode === 'json') return response.extracted.json.length > 0;
    return false;
  }

  function evaluateReactiveRules(responses) {
    const runs = loadArray(STORAGE.reactiveRuns);
    const orchestrations = loadArray(STORAGE.orchestrations);
    state.rules.map(normalizeRule).filter(r => r.enabled).forEach(rule => {
      responses.forEach(response => {
        if (!ruleMatches(rule, response)) return;
        const run = { id: uid(), ruleId: rule.id, responseId: response.id, action: rule.action, at: now(), status: 'triggered' };
        if (rule.action === 'notify') notify(rule.text || `Reactive rule matched: ${rule.title}`);
        if (rule.action === 'insertText') insertIntoEditor(renderRuleText(rule.text, response));
        if (rule.action === 'saveVariable') saveReactiveVariable(rule.variableName || 'lastResponse', response.text);
        if (rule.action === 'queueOrchestration') {
          const found = orchestrations.find(o => o.id === rule.orchestrationId);
          run.orchestration = found ? { id: found.id, title: found.title } : null;
          notify(found ? `Reactive orchestration queued: ${found.title}` : 'Reactive orchestration target missing.');
        }
        runs.unshift(run);
      });
    });
    saveJSON(STORAGE.reactiveRuns, runs.slice(0, 100));
  }

  function renderRuleText(template, response) {
    return String(template || '').replaceAll('{{response.text}}', response.text).replaceAll('{{response.id}}', response.id).replaceAll('{{response.title}}', response.title || '');
  }

  function saveReactiveVariable(name, value) {
    const vars = loadJSON(`${APP}:reactiveVars`, {});
    vars[name] = { value, updatedAt: now(), url: location.href };
    saveJSON(`${APP}:reactiveVars`, vars);
  }

  function getEditor() { return document.querySelector('textarea, [contenteditable="true"]'); }

  function insertIntoEditor(text) {
    const editor = getEditor();
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

  function openResponsesUI() {
    const responses = loadArray(STORAGE.responses);
    const rows = responses.map(r => `<div class="aiu8-row"><strong>${escapeHTML(r.title || 'Response')}</strong><span>${escapeHTML(r.capturedAt)}</span><button data-view="${r.id}">View</button><button data-insert="${r.id}">Insert</button></div>`).join('') || '<p>No captured responses.</p>';
    openModal('Captured AI Responses', `<div class="aiu8-actions"><button data-capture>Capture Now</button><button data-export>Export</button></div>${rows}`, modal => {
      modal.querySelector('[data-capture]').onclick = () => { const n = captureResponses(); notify(`Captured ${n} new responses.`); };
      modal.querySelector('[data-export]').onclick = () => downloadJSON(`aiu-responses-${Date.now()}.json`, responses);
      modal.querySelectorAll('[data-view]').forEach(btn => btn.onclick = () => {
        const item = responses.find(r => r.id === btn.dataset.view);
        openModal('Captured Response', `<pre>${escapeHTML(JSON.stringify(item, null, 2))}</pre>`);
      });
      modal.querySelectorAll('[data-insert]').forEach(btn => btn.onclick = () => {
        const item = responses.find(r => r.id === btn.dataset.insert);
        insertIntoEditor(item?.text || '');
      });
    });
  }

  function openRulesUI() {
    state.rules = state.rules.map(normalizeRule);
    const rows = state.rules.map(r => `<div class="aiu8-row"><strong>${escapeHTML(r.title)}</strong><span>${escapeHTML(r.mode)}:${escapeHTML(r.action)}</span><button data-edit="${r.id}">Edit</button><button data-toggle="${r.id}">${r.enabled ? 'Disable' : 'Enable'}</button><button data-delete="${r.id}">Delete</button></div>`).join('') || '<p>No reactive rules.</p>';
    openModal('Reactive Rules', `<div class="aiu8-actions"><button data-new>New Rule</button><button data-seed>Seed Rule</button></div>${rows}`, modal => {
      modal.querySelector('[data-new]').onclick = () => openRuleEditor();
      modal.querySelector('[data-seed]').onclick = () => { seedRule(); modal.remove(); openRulesUI(); };
      modal.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openRuleEditor(state.rules.find(r => r.id === btn.dataset.edit)));
      modal.querySelectorAll('[data-toggle]').forEach(btn => btn.onclick = () => { const r = state.rules.find(x => x.id === btn.dataset.toggle); if (r) r.enabled = !r.enabled; saveRules(); modal.remove(); openRulesUI(); });
      modal.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => { state.rules = state.rules.filter(r => r.id !== btn.dataset.delete); saveRules(); modal.remove(); openRulesUI(); });
    });
  }

  function seedRule() {
    state.rules.push(normalizeRule({ title: 'Capture JSON Replies', mode: 'json', match: '', action: 'notify', text: 'A JSON response was captured.' }));
    saveRules();
  }

  function saveRules() {
    state.rules = state.rules.map(normalizeRule);
    saveJSON(STORAGE.reactiveRules, state.rules);
  }

  function openRuleEditor(existing = null) {
    const r = normalizeRule(existing || {});
    const orchestrations = loadArray(STORAGE.orchestrations);
    openModal(existing ? 'Edit Reactive Rule' : 'New Reactive Rule', `
      <label>Title<input data-title value="${escapeHTML(r.title)}"></label>
      <label><input type="checkbox" data-enabled ${r.enabled ? 'checked' : ''}> Enabled</label>
      <label>Mode<select data-mode>${['contains','regex','json'].map(m => `<option ${r.mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label>Match<input data-match value="${escapeHTML(r.match)}"></label>
      <label>Action<select data-action>${['notify','insertText','saveVariable','queueOrchestration'].map(a => `<option ${r.action === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
      <label>Variable Name<input data-var value="${escapeHTML(r.variableName)}"></label>
      <label>Orchestration<select data-orch><option value="">None</option>${orchestrations.map(o => `<option value="${escapeHTML(o.id)}" ${r.orchestrationId === o.id ? 'selected' : ''}>${escapeHTML(o.title)}</option>`).join('')}</select></label>
      <label>Text<textarea data-text rows="8">${escapeHTML(r.text)}</textarea></label>
      <button data-save>Save Rule</button>
    `, modal => {
      modal.querySelector('[data-save]').onclick = () => {
        const next = normalizeRule({
          ...r,
          title: modal.querySelector('[data-title]').value,
          enabled: modal.querySelector('[data-enabled]').checked,
          mode: modal.querySelector('[data-mode]').value,
          match: modal.querySelector('[data-match]').value,
          action: modal.querySelector('[data-action]').value,
          variableName: modal.querySelector('[data-var]').value,
          orchestrationId: modal.querySelector('[data-orch]').value,
          text: modal.querySelector('[data-text]').value,
        });
        state.rules = state.rules.filter(item => item.id !== next.id).concat(next);
        saveRules();
        modal.remove();
        notify('Rule saved.');
      };
    });
  }

  function openRunsUI() {
    const runs = loadArray(STORAGE.reactiveRuns);
    const rows = runs.map(r => `<div class="aiu8-row"><strong>${escapeHTML(r.action)}</strong><span>${escapeHTML(r.at)}</span><span>${escapeHTML(r.status)}</span><button data-view="${r.id}">View</button></div>`).join('') || '<p>No reactive runs.</p>';
    openModal('Reactive Run Log', `<div>${rows}</div>`, modal => {
      modal.querySelectorAll('[data-view]').forEach(btn => btn.onclick = () => {
        const item = runs.find(r => r.id === btn.dataset.view);
        openModal('Reactive Run', `<pre>${escapeHTML(JSON.stringify(item, null, 2))}</pre>`);
      });
    });
  }

  function openSettingsUI() {
    openModal('Reactive Settings', `
      <label><input type="checkbox" data-auto ${state.settings.autoCapture ? 'checked' : ''}> Auto-capture responses</label>
      <label>Max responses<input type="number" data-max value="${state.settings.maxResponses}"></label>
      <label>Minimum response chars<input type="number" data-min value="${state.settings.minResponseChars}"></label>
      <button data-save>Save</button>
    `, modal => {
      modal.querySelector('[data-save]').onclick = () => {
        state.settings.autoCapture = modal.querySelector('[data-auto]').checked;
        state.settings.maxResponses = Math.max(10, Number(modal.querySelector('[data-max]').value || 200));
        state.settings.minResponseChars = Math.max(1, Number(modal.querySelector('[data-min]').value || 20));
        saveJSON(STORAGE.settings, state.settings);
        modal.remove();
        notify('Reactive settings saved.');
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

  function initObserver() {
    state.observer?.disconnect();
    state.observer = new MutationObserver(debounce(() => { if (state.settings.autoCapture) captureResponses(); }, 900));
    state.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  function createPanel() {
    if (state.panel) state.panel.remove();
    state.panel = document.createElement('div');
    state.panel.className = 'aiu8-panel';
    state.panel.innerHTML = `
      <strong>AIU Reactive</strong>
      <button data-action="capture">Capture</button>
      <button data-action="responses">Responses</button>
      <button data-action="rules">Rules</button>
      <button data-action="runs">Runs</button>
      <button data-action="settings">Settings</button>
    `;
    state.panel.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'capture') notify(`Captured ${captureResponses()} new responses.`);
      if (action === 'responses') openResponsesUI();
      if (action === 'rules') openRulesUI();
      if (action === 'runs') openRunsUI();
      if (action === 'settings') openSettingsUI();
    });
    document.body.appendChild(state.panel);
  }

  function injectStyles() {
    GM_addStyle(`
      .aiu8-panel,.aiu8-card,.aiu8-toast{font:13px system-ui,sans-serif;background:#3b0764;color:#faf5ff}.aiu8-panel{position:fixed;left:16px;bottom:516px;z-index:999992;border:1px solid #d946ef;border-radius:12px;padding:10px;display:flex;gap:6px;flex-wrap:wrap;max-width:450px;box-shadow:0 12px 30px #0008}.aiu8-panel button,.aiu8-card button{background:#d946ef;color:#3b0764;border:0;border-radius:8px;padding:6px 9px;cursor:pointer}.aiu8-modal{position:fixed;inset:0;z-index:1000013;background:#0008;display:grid;place-items:center}.aiu8-card{width:min(1040px,92vw);max-height:86vh;overflow:auto;border-radius:14px;padding:18px;position:relative;border:1px solid #d946ef}.aiu8-close{position:absolute;right:12px;top:12px}.aiu8-card input,.aiu8-card textarea,.aiu8-card select{width:100%;box-sizing:border-box;background:#2e1065;color:#faf5ff;border:1px solid #d946ef;border-radius:8px;padding:8px}.aiu8-card label{display:grid;gap:4px;margin:10px 0}.aiu8-actions{display:flex;gap:6px;flex-wrap:wrap}.aiu8-row{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;border-bottom:1px solid #ffffff22;padding:8px 0}.aiu8-card pre{white-space:pre-wrap;background:#2e1065;padding:10px;border-radius:8px;overflow:auto}.aiu8-toast{position:fixed;left:18px;bottom:598px;z-index:1000014;padding:10px 14px;border-radius:10px;border:1px solid #d946ef}
    `);
  }

  function initMenu() {
    GM_registerMenuCommand('AIU Reactive: Capture Now', () => notify(`Captured ${captureResponses()} new responses.`));
    GM_registerMenuCommand('AIU Reactive: Responses', openResponsesUI);
    GM_registerMenuCommand('AIU Reactive: Rules', openRulesUI);
    GM_registerMenuCommand('AIU Reactive: Runs', openRunsUI);
    GM_registerMenuCommand('AIU Reactive: Settings', openSettingsUI);
  }

  function init() {
    injectStyles();
    createPanel();
    initMenu();
    initObserver();
    if (state.settings.autoCapture) setTimeout(captureResponses, 1500);
  }

  init();
})();
