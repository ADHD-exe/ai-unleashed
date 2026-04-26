// ==UserScript==
// @name         AI Unleashed - Agent 4 DSL Engine
// @namespace    https://github.com/ADHD-exe/ai-unleashed
// @version      0.4.0
// @description  Programmable prompt DSL layer for AI Unleashed: variables, conditionals, loops, transforms, preview, validation, and rendered insertion.
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
  const VERSION = '0.4.0-agent4-dsl';
  const STORAGE = {
    prompts: `${APP}:prompts`,
    dslSnippets: `${APP}:dslSnippets`,
    dslRuns: `${APP}:dslRuns`,
  };

  const state = {
    snippets: loadJSON(STORAGE.dslSnippets, []),
    panel: null,
  };

  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const now = () => new Date().toISOString();
  const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));

  function loadJSON(key, fallback) {
    try {
      const raw = GM_getValue(key, null);
      return raw ? JSON.parse(raw) : structuredClone(fallback);
    } catch (_) {
      return structuredClone(fallback);
    }
  }

  function saveJSON(key, value) {
    GM_setValue(key, JSON.stringify(value));
  }

  function normalizeSnippet(input) {
    const s = { ...(input || {}) };
    return {
      id: s.id || uid(),
      title: String(s.title || 'Untitled DSL Snippet').trim(),
      body: String(s.body || '').trim(),
      description: String(s.description || '').trim(),
      createdAt: s.createdAt || now(),
      updatedAt: s.updatedAt || now(),
      schemaVersion: 1,
    };
  }

  function getPrompts() {
    const raw = loadJSON(STORAGE.prompts, []);
    return Array.isArray(raw) ? raw : [];
  }

  function setPrompts(prompts) {
    saveJSON(STORAGE.prompts, prompts);
  }

  function notify(message) {
    const n = document.createElement('div');
    n.className = 'aiu4-toast';
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
  }

  function getEditor() {
    return document.querySelector('textarea, [contenteditable="true"]');
  }

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

  function openModal(title, html, bind) {
    const modal = document.createElement('div');
    modal.className = 'aiu4-modal';
    modal.innerHTML = `<div class="aiu4-card"><button class="aiu4-close">×</button><h2>${escapeHTML(title)}</h2>${html}</div>`;
    modal.querySelector('.aiu4-close').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    bind?.(modal);
    return modal;
  }

  function parseAssignments(raw) {
    const vars = {};
    String(raw || '').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key) vars[key] = value;
    });
    return vars;
  }

  function getValue(path, ctx) {
    const parts = String(path || '').split('.').filter(Boolean);
    let cur = ctx;
    for (const part of parts) cur = cur && Object.prototype.hasOwnProperty.call(cur, part) ? cur[part] : '';
    return cur ?? '';
  }

  function applyTransform(value, transform) {
    const v = String(value ?? '');
    if (!transform) return v;
    if (transform === 'upper') return v.toUpperCase();
    if (transform === 'lower') return v.toLowerCase();
    if (transform === 'trim') return v.trim();
    if (transform === 'json') return JSON.stringify(value, null, 2);
    if (transform === 'quote') return `"${v.replaceAll('"', '\\"')}"`;
    if (transform === 'bullets') return v.split(/\n|,/).map(s => s.trim()).filter(Boolean).map(s => `- ${s}`).join('\n');
    return v;
  }

  function tokenizeExpression(expr) {
    const [path, ...pipes] = String(expr || '').split('|').map(s => s.trim());
    return { path, transforms: pipes.filter(Boolean) };
  }

  function renderInline(text, ctx) {
    return String(text).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
      const token = tokenizeExpression(expr);
      let value = getValue(token.path, ctx);
      for (const transform of token.transforms) value = applyTransform(value, transform);
      return value;
    });
  }

  function evalCondition(expr, ctx) {
    const raw = String(expr || '').trim();
    const operators = ['==', '!=', '>=', '<=', '>', '<'];
    for (const op of operators) {
      const idx = raw.indexOf(op);
      if (idx === -1) continue;
      const left = String(getValue(raw.slice(0, idx).trim(), ctx));
      const right = raw.slice(idx + op.length).trim().replace(/^['"]|['"]$/g, '');
      if (op === '==') return left === right;
      if (op === '!=') return left !== right;
      if (op === '>=') return Number(left) >= Number(right);
      if (op === '<=') return Number(left) <= Number(right);
      if (op === '>') return Number(left) > Number(right);
      if (op === '<') return Number(left) < Number(right);
    }
    return Boolean(getValue(raw, ctx));
  }

  function renderDSL(template, inputVars = {}) {
    const ctx = {
      vars: { ...inputVars },
      env: { url: location.href, title: document.title, date: new Date().toLocaleDateString(), iso: now() },
    };
    const lines = String(template || '').split('\n');
    return renderBlock(lines, ctx).trim();
  }

  function renderBlock(lines, ctx) {
    let out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const each = line.match(/^\s*\{\{%\s*each\s+([\w.]+)\s+as\s+(\w+)\s*%\}\}\s*$/);
      if (each) {
        const { block, endIndex } = collectBlock(lines, i + 1, 'each');
        const list = String(getValue(each[1], ctx)).split(',').map(s => s.trim()).filter(Boolean);
        for (const item of list) out.push(renderBlock(block, { ...ctx, [each[2]]: item }));
        i = endIndex;
        continue;
      }
      const iff = line.match(/^\s*\{\{%\s*if\s+(.+?)\s*%\}\}\s*$/);
      if (iff) {
        const { block, elseBlock, endIndex } = collectIfBlock(lines, i + 1);
        out.push(renderBlock(evalCondition(iff[1], ctx) ? block : elseBlock, ctx));
        i = endIndex;
        continue;
      }
      if (/^\s*\{\{%\s*(end|else)/.test(line)) continue;
      out.push(renderInline(line, ctx));
    }
    return out.join('\n');
  }

  function collectBlock(lines, start, type) {
    const block = [];
    let depth = 0;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      if (line.match(/^\s*\{\{%\s*(if|each)\b/)) depth++;
      if (line.match(new RegExp(`^\\s*\\{\\{%\\s*end${type}\\s*%\\}\\}\\s*$`)) && depth === 0) return { block, endIndex: i };
      if (line.match(/^\s*\{\{%\s*end(if|each)\s*%\}\}\s*$/)) depth--;
      block.push(line);
    }
    return { block, endIndex: lines.length - 1 };
  }

  function collectIfBlock(lines, start) {
    const block = [];
    const elseBlock = [];
    let target = block;
    let depth = 0;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      if (line.match(/^\s*\{\{%\s*(if|each)\b/)) depth++;
      if (line.match(/^\s*\{\{%\s*else\s*%\}\}\s*$/) && depth === 0) { target = elseBlock; continue; }
      if (line.match(/^\s*\{\{%\s*endif\s*%\}\}\s*$/) && depth === 0) return { block, elseBlock, endIndex: i };
      if (line.match(/^\s*\{\{%\s*end(if|each)\s*%\}\}\s*$/)) depth--;
      target.push(line);
    }
    return { block, elseBlock, endIndex: lines.length - 1 };
  }

  function validateDSL(template) {
    const errors = [];
    const stack = [];
    String(template || '').split('\n').forEach((line, index) => {
      if (line.match(/\{\{%\s*if\b/)) stack.push({ type: 'if', line: index + 1 });
      if (line.match(/\{\{%\s*each\b/)) stack.push({ type: 'each', line: index + 1 });
      if (line.match(/\{\{%\s*endif\s*%\}\}/)) {
        const top = stack.pop();
        if (!top || top.type !== 'if') errors.push(`Line ${index + 1}: endif without matching if`);
      }
      if (line.match(/\{\{%\s*endeach\s*%\}\}/)) {
        const top = stack.pop();
        if (!top || top.type !== 'each') errors.push(`Line ${index + 1}: endeach without matching each`);
      }
    });
    stack.forEach(item => errors.push(`Line ${item.line}: unclosed ${item.type}`));
    return errors;
  }

  function openDSLPlayground(snippet = null) {
    const s = normalizeSnippet(snippet || { body: 'Write a {{ vars.tone|lower }} explanation about {{ vars.topic }}.\n\n{% if vars.audience == "developer" %}\nInclude implementation details.\n{% else %}\nKeep it beginner friendly.\n{% endif %}\n\nKey points:\n{% each vars.points as point %}\n- {{ point|trim }}\n{% endeach %}' });
    openModal('DSL Playground', `
      <label>Title<input data-title value="${escapeHTML(s.title)}"></label>
      <label>Variables <small>key=value, one per line</small><textarea data-vars rows="7">topic=AI Unleashed\ntone=Technical\naudience=developer\npoints=prompts, workflows, exports</textarea></label>
      <label>Template<textarea data-template rows="14">${escapeHTML(s.body)}</textarea></label>
      <div class="aiu4-actions"><button data-preview>Preview</button><button data-insert>Insert Rendered</button><button data-save>Save Snippet</button><button data-validate>Validate</button></div>
      <pre data-output></pre>
    `, modal => {
      const render = () => {
        const vars = parseAssignments(modal.querySelector('[data-vars]').value);
        const template = modal.querySelector('[data-template]').value;
        const errors = validateDSL(template);
        if (errors.length) return { text: errors.join('\n'), errors };
        return { text: renderDSL(template, vars), errors: [] };
      };
      modal.querySelector('[data-preview]').onclick = () => modal.querySelector('[data-output]').textContent = render().text;
      modal.querySelector('[data-validate]').onclick = () => {
        const errors = validateDSL(modal.querySelector('[data-template]').value);
        modal.querySelector('[data-output]').textContent = errors.length ? errors.join('\n') : 'DSL valid.';
      };
      modal.querySelector('[data-insert]').onclick = () => {
        const result = render();
        if (result.errors.length) return notify('Fix DSL validation errors first.');
        insertIntoEditor(result.text);
        recordRun(s.title, result.text);
      };
      modal.querySelector('[data-save]').onclick = () => {
        const next = normalizeSnippet({ ...s, title: modal.querySelector('[data-title]').value, body: modal.querySelector('[data-template]').value, updatedAt: now() });
        state.snippets = state.snippets.filter(item => item.id !== next.id).concat(next);
        saveJSON(STORAGE.dslSnippets, state.snippets);
        notify('DSL snippet saved.');
      };
    });
  }

  function recordRun(title, output) {
    const runs = loadJSON(STORAGE.dslRuns, []);
    runs.unshift({ id: uid(), title, output, at: now(), url: location.href });
    saveJSON(STORAGE.dslRuns, runs.slice(0, 100));
  }

  function openSnippetManager() {
    state.snippets = state.snippets.map(normalizeSnippet);
    const rows = state.snippets.map(s => `<div class="aiu4-row"><strong>${escapeHTML(s.title)}</strong><button data-open="${s.id}">Open</button><button data-prompt="${s.id}">Save as Prompt</button><button data-delete="${s.id}">Delete</button></div>`).join('') || '<p>No DSL snippets saved.</p>';
    openModal('DSL Snippet Manager', `<div class="aiu4-actions"><button data-new>New Snippet</button><button data-seed>Seed Examples</button></div><div>${rows}</div>`, modal => {
      modal.querySelector('[data-new]').onclick = () => openDSLPlayground();
      modal.querySelector('[data-seed]').onclick = () => { seedSnippets(); modal.remove(); openSnippetManager(); };
      modal.querySelectorAll('[data-open]').forEach(btn => btn.onclick = () => openDSLPlayground(state.snippets.find(s => s.id === btn.dataset.open)));
      modal.querySelectorAll('[data-prompt]').forEach(btn => btn.onclick = () => saveSnippetAsPrompt(btn.dataset.prompt));
      modal.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => {
        state.snippets = state.snippets.filter(s => s.id !== btn.dataset.delete);
        saveJSON(STORAGE.dslSnippets, state.snippets);
        modal.remove();
        openSnippetManager();
      });
    });
  }

  function seedSnippets() {
    const examples = [
      {
        title: 'Bug Report Builder',
        body: 'Create a bug report for {{ vars.project }}.\n\nEnvironment: {{ vars.environment }}\nSeverity: {{ vars.severity|upper }}\n\n{% if vars.include_steps == "yes" %}\nSteps to reproduce:\n{% each vars.steps as step %}\n- {{ step|trim }}\n{% endeach %}\n{% endif %}',
      },
      {
        title: 'Advanced Code Review Prompt',
        body: 'Act as a senior engineer. Review this {{ vars.language }} code for security, reliability, performance, and maintainability.\n\nFocus areas:\n{% each vars.focus as item %}\n- {{ item|trim }}\n{% endeach %}\n\nReturn prioritized findings and concrete patches.',
      },
    ];
    state.snippets = state.snippets.concat(examples.map(normalizeSnippet));
    saveJSON(STORAGE.dslSnippets, state.snippets);
    notify('DSL examples seeded.');
  }

  function saveSnippetAsPrompt(id) {
    const snippet = state.snippets.find(s => s.id === id);
    if (!snippet) return;
    const prompts = getPrompts();
    prompts.push({ id: uid(), title: snippet.title, body: snippet.body, tags: ['dsl', 'template'], createdAt: now(), updatedAt: now(), schemaVersion: 2 });
    setPrompts(prompts);
    notify('DSL snippet saved as prompt template.');
  }

  function openRunHistory() {
    const runs = loadJSON(STORAGE.dslRuns, []);
    const rows = runs.map(r => `<div class="aiu4-row"><span>${escapeHTML(r.at)}</span><strong>${escapeHTML(r.title)}</strong><button data-view="${r.id}">View</button><button data-insert="${r.id}">Insert</button></div>`).join('') || '<p>No DSL runs recorded.</p>';
    openModal('DSL Run History', `<div>${rows}</div>`, modal => {
      modal.querySelectorAll('[data-view]').forEach(btn => btn.onclick = () => {
        const run = runs.find(r => r.id === btn.dataset.view);
        openModal('DSL Run Output', `<pre>${escapeHTML(run?.output || '')}</pre>`);
      });
      modal.querySelectorAll('[data-insert]').forEach(btn => btn.onclick = () => {
        const run = runs.find(r => r.id === btn.dataset.insert);
        insertIntoEditor(run?.output || '');
      });
    });
  }

  function exportDSLBundle() {
    const blob = new Blob([JSON.stringify({ version: VERSION, exportedAt: now(), snippets: state.snippets.map(normalizeSnippet), runs: loadJSON(STORAGE.dslRuns, []) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ai-unleashed-dsl-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importDSLBundle() {
    const raw = prompt('Paste AI Unleashed DSL bundle JSON');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.snippets)) {
        state.snippets = state.snippets.concat(parsed.snippets.map(normalizeSnippet));
        saveJSON(STORAGE.dslSnippets, state.snippets);
      }
      if (Array.isArray(parsed.runs)) saveJSON(STORAGE.dslRuns, parsed.runs.slice(0, 100));
      notify('DSL bundle imported.');
    } catch (_) {
      notify('Invalid DSL bundle JSON.');
    }
  }

  function createPanel() {
    if (state.panel) state.panel.remove();
    state.panel = document.createElement('div');
    state.panel.className = 'aiu4-panel';
    state.panel.innerHTML = `
      <strong>AIU DSL</strong>
      <button data-action="playground">Playground</button>
      <button data-action="snippets">Snippets</button>
      <button data-action="history">History</button>
      <button data-action="export">Export DSL</button>
      <button data-action="import">Import DSL</button>
    `;
    state.panel.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'playground') openDSLPlayground();
      if (action === 'snippets') openSnippetManager();
      if (action === 'history') openRunHistory();
      if (action === 'export') exportDSLBundle();
      if (action === 'import') importDSLBundle();
    });
    document.body.appendChild(state.panel);
  }

  function injectStyles() {
    GM_addStyle(`
      .aiu4-panel,.aiu4-card,.aiu4-toast{font:13px system-ui,sans-serif;background:#0f172a;color:#f8fafc}.aiu4-panel{position:fixed;left:16px;bottom:116px;z-index:999996;border:1px solid #38bdf8;border-radius:12px;padding:10px;display:flex;gap:6px;flex-wrap:wrap;max-width:380px;box-shadow:0 12px 30px #0008}.aiu4-panel button,.aiu4-card button{background:#38bdf8;color:#0f172a;border:0;border-radius:8px;padding:6px 9px;cursor:pointer}.aiu4-modal{position:fixed;inset:0;z-index:1000005;background:#0008;display:grid;place-items:center}.aiu4-card{width:min(980px,92vw);max-height:86vh;overflow:auto;border-radius:14px;padding:18px;position:relative;border:1px solid #38bdf8}.aiu4-close{position:absolute;right:12px;top:12px}.aiu4-card label{display:grid;gap:4px;margin:10px 0}.aiu4-card input,.aiu4-card textarea{width:100%;box-sizing:border-box;background:#020617;color:#f8fafc;border:1px solid #38bdf8;border-radius:8px;padding:8px}.aiu4-actions{display:flex;gap:6px;flex-wrap:wrap}.aiu4-row{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;border-bottom:1px solid #ffffff22;padding:8px 0}.aiu4-card pre{white-space:pre-wrap;background:#020617;padding:10px;border-radius:8px;overflow:auto}.aiu4-toast{position:fixed;left:18px;bottom:198px;z-index:1000006;padding:10px 14px;border-radius:10px;border:1px solid #38bdf8}
    `);
  }

  function initMenu() {
    GM_registerMenuCommand('AIU DSL: Playground', openDSLPlayground);
    GM_registerMenuCommand('AIU DSL: Snippets', openSnippetManager);
    GM_registerMenuCommand('AIU DSL: Run History', openRunHistory);
    GM_registerMenuCommand('AIU DSL: Export Bundle', exportDSLBundle);
    GM_registerMenuCommand('AIU DSL: Import Bundle', importDSLBundle);
  }

  function init() {
    state.snippets = state.snippets.map(normalizeSnippet);
    saveJSON(STORAGE.dslSnippets, state.snippets);
    injectStyles();
    createPanel();
    initMenu();
  }

  init();
})();
