// ==UserScript==
// @name         AI Unleashed - Agent 3 Extension
// @namespace    https://github.com/ADHD-exe/ai-unleashed
// @version      0.3.0
// @description  Advanced workflow, versioning, migration, duplicate detection, and export/import layer for AI Unleashed.
// @author       ADHD-exe
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://claude.ai/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const APP = 'ai-unleashed';
  const VERSION = '0.3.0-agent3';
  const STORAGE = {
    prompts: `${APP}:prompts`,
    settings: `${APP}:settings`,
    ui: `${APP}:ui`,
    workflows: `${APP}:workflows`,
    versions: `${APP}:promptVersions`,
    audit: `${APP}:audit`,
  };

  const state = {
    workflows: loadJSON(STORAGE.workflows, []),
    audit: loadJSON(STORAGE.audit, []),
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

  function getPrompts() {
    const raw = loadJSON(STORAGE.prompts, []);
    return Array.isArray(raw) ? raw.map(normalizePrompt) : [];
  }

  function setPrompts(prompts) {
    saveJSON(STORAGE.prompts, prompts.map(normalizePrompt));
  }

  function normalizePrompt(input) {
    const p = typeof input === 'string' ? { title: input.slice(0, 60), body: input } : { ...(input || {}) };
    return {
      id: p.id || uid(),
      title: String(p.title || 'Untitled Prompt').trim(),
      body: String(p.body || p.content || '').trim(),
      tags: Array.isArray(p.tags) ? p.tags.map(String).map(s => s.trim()).filter(Boolean) : [],
      createdAt: p.createdAt || now(),
      updatedAt: p.updatedAt || now(),
      schemaVersion: 2,
    };
  }

  function normalizeWorkflow(input) {
    const w = { ...(input || {}) };
    return {
      id: w.id || uid(),
      title: String(w.title || 'Untitled Workflow').trim(),
      description: String(w.description || '').trim(),
      steps: Array.isArray(w.steps) ? w.steps.map(normalizeWorkflowStep) : [],
      createdAt: w.createdAt || now(),
      updatedAt: w.updatedAt || now(),
      schemaVersion: 1,
    };
  }

  function normalizeWorkflowStep(input) {
    const s = { ...(input || {}) };
    return {
      id: s.id || uid(),
      type: ['insertPrompt', 'insertText', 'delay', 'exportChat', 'saveInputAsPrompt'].includes(s.type) ? s.type : 'insertText',
      label: String(s.label || s.type || 'Step').trim(),
      promptId: s.promptId || '',
      text: String(s.text || '').trim(),
      delayMs: Number.isFinite(Number(s.delayMs)) ? Math.max(0, Number(s.delayMs)) : 0,
    };
  }

  function addAudit(event, detail = {}) {
    state.audit.unshift({ id: uid(), event, detail, at: now(), url: location.href });
    state.audit = state.audit.slice(0, 250);
    saveJSON(STORAGE.audit, state.audit);
  }

  function notify(message) {
    const n = document.createElement('div');
    n.className = 'aiu3-toast';
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
  }

  function getEditor() {
    return document.querySelector('textarea, [contenteditable="true"]');
  }

  function getEditorText() {
    const editor = getEditor();
    return editor?.tagName === 'TEXTAREA' ? editor.value : editor?.innerText || '';
  }

  function setEditorText(text) {
    const editor = getEditor();
    if (!editor) return notify('No editor detected.');
    if (editor.tagName === 'TEXTAREA') editor.value = text;
    else editor.innerText = text;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
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

  function captureChat() {
    const messages = [...document.querySelectorAll('[data-message-author-role], article, [data-testid*="message"], .font-claude-message')]
      .map(el => el.innerText.trim())
      .filter(Boolean);
    return { url: location.href, title: document.title, capturedAt: now(), messages };
  }

  function openModal(title, html, bind) {
    const modal = document.createElement('div');
    modal.className = 'aiu3-modal';
    modal.innerHTML = `<div class="aiu3-card"><button class="aiu3-close">×</button><h2>${escapeHTML(title)}</h2>${html}</div>`;
    modal.querySelector('.aiu3-close').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    bind?.(modal);
    return modal;
  }

  function savePromptVersion(prompt, reason = 'manual') {
    const versions = loadJSON(STORAGE.versions, {});
    const p = normalizePrompt(prompt);
    versions[p.id] = Array.isArray(versions[p.id]) ? versions[p.id] : [];
    versions[p.id].unshift({ ...p, versionId: uid(), savedAt: now(), reason });
    versions[p.id] = versions[p.id].slice(0, 25);
    saveJSON(STORAGE.versions, versions);
    addAudit('prompt.version.saved', { promptId: p.id, reason });
  }

  function getPromptVersions(promptId) {
    const versions = loadJSON(STORAGE.versions, {});
    return Array.isArray(versions[promptId]) ? versions[promptId] : [];
  }

  function openVersionManager() {
    const prompts = getPrompts();
    const rows = prompts.map(p => `<div class="aiu3-row"><strong>${escapeHTML(p.title)}</strong><button data-save="${p.id}">Snapshot</button><button data-history="${p.id}">History</button></div>`).join('') || '<p>No prompts available.</p>';
    openModal('Prompt Version Manager', `<div>${rows}</div>`, modal => {
      modal.querySelectorAll('[data-save]').forEach(btn => btn.onclick = () => {
        const prompt = getPrompts().find(p => p.id === btn.dataset.save);
        if (prompt) savePromptVersion(prompt, 'snapshot');
        notify('Version snapshot saved.');
      });
      modal.querySelectorAll('[data-history]').forEach(btn => btn.onclick = () => openPromptHistory(btn.dataset.history));
    });
  }

  function openPromptHistory(promptId) {
    const versions = getPromptVersions(promptId);
    const rows = versions.map(v => `<div class="aiu3-row"><span>${escapeHTML(v.savedAt)} — ${escapeHTML(v.reason)}</span><button data-view="${v.versionId}">View</button><button data-restore="${v.versionId}">Restore</button></div>`).join('') || '<p>No versions saved.</p>';
    openModal('Prompt History', `<div>${rows}</div>`, modal => {
      modal.querySelectorAll('[data-view]').forEach(btn => btn.onclick = () => {
        const v = versions.find(item => item.versionId === btn.dataset.view);
        openModal('Prompt Version', `<pre>${escapeHTML(JSON.stringify(v, null, 2))}</pre>`);
      });
      modal.querySelectorAll('[data-restore]').forEach(btn => btn.onclick = () => {
        const v = versions.find(item => item.versionId === btn.dataset.restore);
        if (!v) return;
        const prompts = getPrompts();
        const restored = normalizePrompt({ ...v, updatedAt: now() });
        setPrompts(prompts.filter(p => p.id !== restored.id).concat(restored));
        addAudit('prompt.version.restored', { promptId: restored.id, versionId: v.versionId });
        notify('Prompt version restored.');
      });
    });
  }

  function findDuplicatePrompts() {
    const prompts = getPrompts();
    const seen = new Map();
    const duplicates = [];
    for (const p of prompts) {
      const key = `${p.title.toLowerCase().trim()}::${p.body.toLowerCase().trim()}`;
      if (seen.has(key)) duplicates.push({ original: seen.get(key), duplicate: p });
      else seen.set(key, p);
    }
    return duplicates;
  }

  function openDuplicateManager() {
    const duplicates = findDuplicatePrompts();
    const rows = duplicates.map((d, i) => `<div class="aiu3-row"><span>${escapeHTML(d.duplicate.title)}</span><button data-remove="${d.duplicate.id}">Remove duplicate</button><button data-view="${i}">Compare</button></div>`).join('') || '<p>No exact duplicates found.</p>';
    openModal('Duplicate Prompt Manager', `<div>${rows}</div>`, modal => {
      modal.querySelectorAll('[data-remove]').forEach(btn => btn.onclick = () => {
        const prompts = getPrompts();
        setPrompts(prompts.filter(p => p.id !== btn.dataset.remove));
        addAudit('prompt.duplicate.removed', { promptId: btn.dataset.remove });
        modal.remove();
        openDuplicateManager();
      });
      modal.querySelectorAll('[data-view]').forEach(btn => {
        btn.onclick = () => {
          const d = duplicates[Number(btn.dataset.view)];
          openModal('Duplicate Compare', `<div class="aiu3-grid"><pre>${escapeHTML(JSON.stringify(d.original, null, 2))}</pre><pre>${escapeHTML(JSON.stringify(d.duplicate, null, 2))}</pre></div>`);
        };
      });
    });
  }

  async function runWorkflow(workflow) {
    const w = normalizeWorkflow(workflow);
    addAudit('workflow.started', { workflowId: w.id, title: w.title });
    for (const step of w.steps) {
      if (step.type === 'insertText') insertIntoEditor(step.text);
      if (step.type === 'insertPrompt') {
        const prompt = getPrompts().find(p => p.id === step.promptId);
        if (prompt) insertIntoEditor(prompt.body);
      }
      if (step.type === 'delay') await new Promise(resolve => setTimeout(resolve, step.delayMs));
      if (step.type === 'exportChat') downloadJSON(`aiu-chat-${Date.now()}.json`, captureChat());
      if (step.type === 'saveInputAsPrompt') {
        const body = getEditorText();
        if (body.trim()) {
          const prompts = getPrompts();
          prompts.push(normalizePrompt({ title: step.text || body.slice(0, 60), body, tags: ['workflow'] }));
          setPrompts(prompts);
        }
      }
      addAudit('workflow.step.completed', { workflowId: w.id, stepId: step.id, type: step.type });
    }
    addAudit('workflow.completed', { workflowId: w.id });
    notify(`Workflow completed: ${w.title}`);
  }

  function saveWorkflows() {
    state.workflows = state.workflows.map(normalizeWorkflow);
    saveJSON(STORAGE.workflows, state.workflows);
  }

  function openWorkflowManager() {
    state.workflows = state.workflows.map(normalizeWorkflow);
    const rows = state.workflows.map(w => `<div class="aiu3-row"><strong>${escapeHTML(w.title)}</strong><span>${w.steps.length} steps</span><button data-run="${w.id}">Run</button><button data-edit="${w.id}">Edit</button><button data-delete="${w.id}">Delete</button></div>`).join('') || '<p>No workflows saved.</p>';
    openModal('Workflow Manager', `<div class="aiu3-actions"><button data-new>New Workflow</button><button data-seed>Seed Demo Workflow</button></div><div>${rows}</div>`, modal => {
      modal.querySelector('[data-new]').onclick = () => openWorkflowEditor();
      modal.querySelector('[data-seed]').onclick = () => { seedWorkflow(); modal.remove(); openWorkflowManager(); };
      modal.querySelectorAll('[data-run]').forEach(btn => btn.onclick = () => runWorkflow(state.workflows.find(w => w.id === btn.dataset.run)));
      modal.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openWorkflowEditor(state.workflows.find(w => w.id === btn.dataset.edit)));
      modal.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => {
        state.workflows = state.workflows.filter(w => w.id !== btn.dataset.delete);
        saveWorkflows();
        modal.remove();
        openWorkflowManager();
      });
    });
  }

  function seedWorkflow() {
    state.workflows.push(normalizeWorkflow({
      title: 'Draft → Save → Export Chat',
      description: 'Example local workflow.',
      steps: [
        { type: 'insertText', label: 'Insert header', text: 'Please review the following:\n\n' },
        { type: 'delay', label: 'Short delay', delayMs: 250 },
        { type: 'saveInputAsPrompt', label: 'Save input as prompt', text: 'Workflow Saved Prompt' },
      ],
    }));
    saveWorkflows();
    addAudit('workflow.seeded');
  }

  function openWorkflowEditor(existing = null) {
    const w = normalizeWorkflow(existing || {});
    const stepText = JSON.stringify(w.steps, null, 2);
    openModal(existing ? 'Edit Workflow' : 'New Workflow', `
      <label>Title<input data-title value="${escapeHTML(w.title)}"></label>
      <label>Description<input data-description value="${escapeHTML(w.description)}"></label>
      <label>Steps JSON<textarea data-steps rows="12">${escapeHTML(stepText)}</textarea></label>
      <p>Step types: insertText, insertPrompt, delay, exportChat, saveInputAsPrompt</p>
      <button data-save>Save Workflow</button>
    `, modal => {
      modal.querySelector('[data-save]').onclick = () => {
        try {
          const steps = JSON.parse(modal.querySelector('[data-steps]').value);
          const next = normalizeWorkflow({
            ...w,
            title: modal.querySelector('[data-title]').value,
            description: modal.querySelector('[data-description]').value,
            steps,
            updatedAt: now(),
          });
          state.workflows = state.workflows.filter(item => item.id !== next.id).concat(next);
          saveWorkflows();
          addAudit('workflow.saved', { workflowId: next.id });
          modal.remove();
          notify('Workflow saved.');
        } catch (_) {
          notify('Invalid workflow steps JSON.');
        }
      };
    });
  }

  function migrateAllData() {
    const prompts = getPrompts();
    setPrompts(prompts);
    state.workflows = state.workflows.map(normalizeWorkflow);
    saveWorkflows();
    addAudit('migration.completed', { promptCount: prompts.length, workflowCount: state.workflows.length });
    notify('Migration complete.');
  }

  function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportAdvancedBundle() {
    downloadJSON(`ai-unleashed-advanced-${new Date().toISOString().slice(0, 10)}.json`, {
      bundleVersion: VERSION,
      exportedAt: now(),
      prompts: getPrompts(),
      workflows: state.workflows.map(normalizeWorkflow),
      promptVersions: loadJSON(STORAGE.versions, {}),
      audit: state.audit,
      settings: loadJSON(STORAGE.settings, {}),
      ui: loadJSON(STORAGE.ui, {}),
    });
    addAudit('bundle.exported');
  }

  function importAdvancedBundle() {
    const raw = prompt('Paste AI Unleashed advanced bundle JSON');
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data.prompts)) setPrompts(data.prompts.map(normalizePrompt));
      if (Array.isArray(data.workflows)) {
        state.workflows = data.workflows.map(normalizeWorkflow);
        saveWorkflows();
      }
      if (data.promptVersions && typeof data.promptVersions === 'object') saveJSON(STORAGE.versions, data.promptVersions);
      addAudit('bundle.imported', { prompts: data.prompts?.length || 0, workflows: data.workflows?.length || 0 });
      notify('Advanced bundle imported.');
    } catch (_) {
      notify('Invalid advanced bundle JSON.');
    }
  }

  function openAuditLog() {
    const rows = state.audit.map(a => `<div class="aiu3-row"><span>${escapeHTML(a.at)}</span><strong>${escapeHTML(a.event)}</strong><button data-view="${a.id}">View</button></div>`).join('') || '<p>No audit events.</p>';
    openModal('AI Unleashed Audit Log', `<div>${rows}</div>`, modal => {
      modal.querySelectorAll('[data-view]').forEach(btn => btn.onclick = () => {
        const item = state.audit.find(a => a.id === btn.dataset.view);
        openModal('Audit Event', `<pre>${escapeHTML(JSON.stringify(item, null, 2))}</pre>`);
      });
    });
  }

  function createAgent3Panel() {
    if (state.panel) state.panel.remove();
    state.panel = document.createElement('div');
    state.panel.className = 'aiu3-panel';
    state.panel.innerHTML = `
      <strong>AIU Agent 3</strong>
      <button data-action="workflows">Workflows</button>
      <button data-action="versions">Versions</button>
      <button data-action="duplicates">Duplicates</button>
      <button data-action="migrate">Migrate</button>
      <button data-action="export">Export+</button>
      <button data-action="import">Import+</button>
      <button data-action="audit">Audit</button>
    `;
    state.panel.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'workflows') openWorkflowManager();
      if (action === 'versions') openVersionManager();
      if (action === 'duplicates') openDuplicateManager();
      if (action === 'migrate') migrateAllData();
      if (action === 'export') exportAdvancedBundle();
      if (action === 'import') importAdvancedBundle();
      if (action === 'audit') openAuditLog();
    });
    document.body.appendChild(state.panel);
  }

  function injectStyles() {
    GM_addStyle(`
      .aiu3-panel,.aiu3-card,.aiu3-toast{font:13px system-ui,sans-serif;background:#111827;color:#f9fafb}.aiu3-panel{position:fixed;left:16px;bottom:16px;z-index:999997;border:1px solid #a78bfa;border-radius:12px;padding:10px;display:flex;gap:6px;flex-wrap:wrap;max-width:360px;box-shadow:0 12px 30px #0008}.aiu3-panel button,.aiu3-card button{background:#a78bfa;color:#111827;border:0;border-radius:8px;padding:6px 9px;cursor:pointer}.aiu3-modal{position:fixed;inset:0;z-index:1000003;background:#0008;display:grid;place-items:center}.aiu3-card{width:min(960px,92vw);max-height:86vh;overflow:auto;border-radius:14px;padding:18px;position:relative;border:1px solid #a78bfa}.aiu3-close{position:absolute;right:12px;top:12px}.aiu3-row{display:grid;grid-template-columns:1fr auto auto auto auto;gap:8px;align-items:center;border-bottom:1px solid #ffffff22;padding:8px 0}.aiu3-actions{display:flex;gap:6px;flex-wrap:wrap}.aiu3-card input,.aiu3-card textarea{width:100%;box-sizing:border-box;background:#030712;color:#f9fafb;border:1px solid #a78bfa;border-radius:8px;padding:8px}.aiu3-card label{display:grid;gap:4px;margin:10px 0}.aiu3-card pre{white-space:pre-wrap;background:#030712;padding:10px;border-radius:8px;overflow:auto}.aiu3-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.aiu3-toast{position:fixed;left:18px;bottom:98px;z-index:1000004;padding:10px 14px;border-radius:10px;border:1px solid #a78bfa}
    `);
  }

  function initMenu() {
    GM_registerMenuCommand('AIU Agent 3: Workflows', openWorkflowManager);
    GM_registerMenuCommand('AIU Agent 3: Prompt Versions', openVersionManager);
    GM_registerMenuCommand('AIU Agent 3: Duplicate Manager', openDuplicateManager);
    GM_registerMenuCommand('AIU Agent 3: Export Advanced Bundle', exportAdvancedBundle);
    GM_registerMenuCommand('AIU Agent 3: Import Advanced Bundle', importAdvancedBundle);
    GM_registerMenuCommand('AIU Agent 3: Migrate Data', migrateAllData);
    GM_registerMenuCommand('AIU Agent 3: Audit Log', openAuditLog);
  }

  function init() {
    state.workflows = state.workflows.map(normalizeWorkflow);
    saveWorkflows();
    injectStyles();
    createAgent3Panel();
    initMenu();
    addAudit('agent3.loaded', { version: VERSION });
  }

  init();
})();
