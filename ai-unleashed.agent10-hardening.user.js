// ==UserScript==
// @name         AI Unleashed - Agent 10 Hardening
// @namespace    https://github.com/ADHD-exe/ai-unleashed
// @version      1.0.0
// @description  Hardening layer for AI Unleashed: schema migration, validation, guardrails, diagnostics, and safety reports.
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
  const VERSION = '1.0.0-agent10-hardening';
  const STORAGE = {
    prompts: `${APP}:prompts`,
    workflows: `${APP}:workflows`,
    dslSnippets: `${APP}:dslSnippets`,
    orchestrations: `${APP}:orchestrations`,
    hardeningReports: `${APP}:hardeningReports`,
    hardeningSettings: `${APP}:hardeningSettings`,
  };

  const DEFAULT_SETTINGS = {
    maxWorkflowSteps: 50,
    maxOrchestrationSteps: 75,
    maxTemplateChars: 50000,
    maxPromptChars: 100000,
    requireIds: true,
    autoMigrateOnLoad: false,
  };

  const state = {
    panel: null,
    settings: loadObject(STORAGE.hardeningSettings, DEFAULT_SETTINGS),
  };

  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const now = () => new Date().toISOString();
  const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));

  function loadObject(key, fallback) {
    try {
      const raw = GM_getValue(key, null);
      const parsed = raw ? JSON.parse(raw) : {};
      return { ...fallback, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    } catch (_) {
      return { ...fallback };
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
    n.className = 'aiu10-toast';
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3500);
  }

  function openModal(title, html, bind) {
    const modal = document.createElement('div');
    modal.className = 'aiu10-modal';
    modal.innerHTML = `<div class="aiu10-card"><button class="aiu10-close">×</button><h2>${escapeHTML(title)}</h2>${html}</div>`;
    modal.querySelector('.aiu10-close').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    bind?.(modal);
    return modal;
  }

  function normalizeEntityBase(input, fallbackTitle) {
    const item = input && typeof input === 'object' ? { ...input } : {};
    const createdAt = validDate(item.createdAt) ? item.createdAt : now();
    const updatedAt = validDate(item.updatedAt) ? item.updatedAt : createdAt;
    return {
      ...item,
      id: item.id || uid(),
      title: String(item.title || item.name || fallbackTitle).trim(),
      createdAt,
      updatedAt,
    };
  }

  function normalizePrompt(input) {
    const p = normalizeEntityBase(input, 'Untitled Prompt');
    return {
      ...p,
      body: String(p.body || p.content || '').slice(0, state.settings.maxPromptChars),
      tags: Array.isArray(p.tags) ? p.tags.map(String).map(s => s.trim()).filter(Boolean) : [],
      schemaVersion: 2,
    };
  }

  function normalizeWorkflow(input) {
    const w = normalizeEntityBase(input, 'Untitled Workflow');
    return {
      ...w,
      description: String(w.description || ''),
      steps: Array.isArray(w.steps) ? w.steps.slice(0, state.settings.maxWorkflowSteps).map(normalizeStep) : [],
      schemaVersion: 1,
    };
  }

  function normalizeSnippet(input) {
    const s = normalizeEntityBase(input, 'Untitled DSL Snippet');
    return {
      ...s,
      body: String(s.body || '').slice(0, state.settings.maxTemplateChars),
      description: String(s.description || ''),
      schemaVersion: 1,
    };
  }

  function normalizeOrchestration(input) {
    const o = normalizeEntityBase(input, 'Untitled Orchestration');
    return {
      ...o,
      description: String(o.description || ''),
      vars: o.vars && typeof o.vars === 'object' && !Array.isArray(o.vars) ? o.vars : {},
      steps: Array.isArray(o.steps) ? o.steps.slice(0, state.settings.maxOrchestrationSteps).map(normalizeStep) : [],
      schemaVersion: 1,
    };
  }

  function normalizeStep(input) {
    const s = input && typeof input === 'object' ? { ...input } : {};
    return {
      ...s,
      id: s.id || uid(),
      label: String(s.label || s.type || 'Step').trim(),
      type: String(s.type || 'insertText').trim(),
      promptId: String(s.promptId || ''),
      snippetId: String(s.snippetId || ''),
      workflowId: String(s.workflowId || ''),
      text: String(s.text || '').slice(0, state.settings.maxTemplateChars),
      value: String(s.value || '').slice(0, state.settings.maxTemplateChars),
      varName: String(s.varName || ''),
      saveAs: String(s.saveAs || ''),
      delayMs: Math.max(0, Number(s.delayMs || 0)),
      insert: Boolean(s.insert),
    };
  }

  function validDate(value) {
    return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
  }

  function validateUniqueIds(items, type, report) {
    const seen = new Set();
    items.forEach((item, index) => {
      if (!item.id) report.errors.push(`${type}[${index}] missing id`);
      if (seen.has(item.id)) report.errors.push(`${type}[${index}] duplicate id ${item.id}`);
      seen.add(item.id);
    });
  }

  function validatePrompt(prompt, index, report) {
    if (!prompt.title) report.warnings.push(`prompt[${index}] missing title`);
    if (!prompt.body) report.warnings.push(`prompt[${index}] empty body`);
    if (prompt.body.length > state.settings.maxPromptChars) report.errors.push(`prompt[${index}] exceeds max chars`);
  }

  function validateDSL(template, label, report) {
    const stack = [];
    String(template || '').split('\n').forEach((line, idx) => {
      if (/\{\{%\s*if\b/.test(line)) stack.push({ type: 'if', line: idx + 1 });
      if (/\{\{%\s*each\b/.test(line)) stack.push({ type: 'each', line: idx + 1 });
      if (/\{\{%\s*endif\s*%\}\}/.test(line)) {
        const top = stack.pop();
        if (!top || top.type !== 'if') report.errors.push(`${label}: line ${idx + 1} endif without matching if`);
      }
      if (/\{\{%\s*endeach\s*%\}\}/.test(line)) {
        const top = stack.pop();
        if (!top || top.type !== 'each') report.errors.push(`${label}: line ${idx + 1} endeach without matching each`);
      }
    });
    stack.forEach(item => report.errors.push(`${label}: line ${item.line} unclosed ${item.type}`));
  }

  function validateReferences(workflows, snippets, prompts, orchestrations, report) {
    const promptIds = new Set(prompts.map(p => p.id));
    const snippetIds = new Set(snippets.map(s => s.id));
    const workflowIds = new Set(workflows.map(w => w.id));
    workflows.forEach(w => (w.steps || []).forEach(step => {
      if (step.promptId && !promptIds.has(step.promptId)) report.warnings.push(`workflow ${w.title}: missing prompt reference ${step.promptId}`);
    }));
    orchestrations.forEach(o => (o.steps || []).forEach(step => {
      if (step.promptId && !promptIds.has(step.promptId)) report.warnings.push(`orchestration ${o.title}: missing prompt reference ${step.promptId}`);
      if (step.snippetId && !snippetIds.has(step.snippetId)) report.warnings.push(`orchestration ${o.title}: missing DSL reference ${step.snippetId}`);
      if (step.workflowId && !workflowIds.has(step.workflowId)) report.warnings.push(`orchestration ${o.title}: missing workflow reference ${step.workflowId}`);
    }));
  }

  function buildReport() {
    const prompts = loadArray(STORAGE.prompts).map(normalizePrompt);
    const workflows = loadArray(STORAGE.workflows).map(normalizeWorkflow);
    const snippets = loadArray(STORAGE.dslSnippets).map(normalizeSnippet);
    const orchestrations = loadArray(STORAGE.orchestrations).map(normalizeOrchestration);
    const report = {
      id: uid(),
      version: VERSION,
      createdAt: now(),
      summary: {
        prompts: prompts.length,
        workflows: workflows.length,
        dslSnippets: snippets.length,
        orchestrations: orchestrations.length,
      },
      errors: [],
      warnings: [],
    };
    validateUniqueIds(prompts, 'prompt', report);
    validateUniqueIds(workflows, 'workflow', report);
    validateUniqueIds(snippets, 'dslSnippet', report);
    validateUniqueIds(orchestrations, 'orchestration', report);
    prompts.forEach((p, i) => validatePrompt(p, i, report));
    snippets.forEach((s, i) => validateDSL(s.body, `dslSnippet[${i}] ${s.title}`, report));
    orchestrations.forEach((o, i) => {
      if ((o.steps || []).length > state.settings.maxOrchestrationSteps) report.errors.push(`orchestration[${i}] exceeds max steps`);
      (o.steps || []).forEach((step, si) => {
        if (step.delayMs > 600000) report.warnings.push(`orchestration ${o.title} step ${si} has delay over 10 minutes`);
      });
    });
    validateReferences(workflows, snippets, prompts, orchestrations, report);
    return report;
  }

  function migrateData() {
    const before = buildReport();
    saveJSON(STORAGE.prompts, loadArray(STORAGE.prompts).map(normalizePrompt));
    saveJSON(STORAGE.workflows, loadArray(STORAGE.workflows).map(normalizeWorkflow));
    saveJSON(STORAGE.dslSnippets, loadArray(STORAGE.dslSnippets).map(normalizeSnippet));
    saveJSON(STORAGE.orchestrations, loadArray(STORAGE.orchestrations).map(normalizeOrchestration));
    const after = buildReport();
    persistReport({ ...after, migration: { before } });
    notify(`Migration complete: ${after.errors.length} errors, ${after.warnings.length} warnings.`);
  }

  function persistReport(report) {
    const reports = loadArray(STORAGE.hardeningReports);
    reports.unshift(report);
    saveJSON(STORAGE.hardeningReports, reports.slice(0, 50));
  }

  function runDiagnostics() {
    const report = buildReport();
    persistReport(report);
    openReport(report);
  }

  function openReport(report) {
    openModal('Hardening Diagnostic Report', `
      <p>Errors: ${report.errors.length} | Warnings: ${report.warnings.length}</p>
      <pre>${escapeHTML(JSON.stringify(report, null, 2))}</pre>
      <div class="aiu10-actions"><button data-download>Download Report</button></div>
    `, modal => {
      modal.querySelector('[data-download]').onclick = () => downloadJSON(`aiu-hardening-report-${report.id}.json`, report);
    });
  }

  function openReportsHistory() {
    const reports = loadArray(STORAGE.hardeningReports);
    const rows = reports.map(r => `<div class="aiu10-row"><strong>${escapeHTML(r.createdAt)}</strong><span>${r.errors?.length || 0} errors</span><span>${r.warnings?.length || 0} warnings</span><button data-view="${r.id}">View</button></div>`).join('') || '<p>No reports saved.</p>';
    openModal('Hardening Reports', `<div>${rows}</div>`, modal => {
      modal.querySelectorAll('[data-view]').forEach(btn => btn.onclick = () => openReport(reports.find(r => r.id === btn.dataset.view)));
    });
  }

  function openSettingsUI() {
    openModal('Hardening Settings', `
      <label>Max workflow steps<input type="number" data-workflow value="${state.settings.maxWorkflowSteps}"></label>
      <label>Max orchestration steps<input type="number" data-orch value="${state.settings.maxOrchestrationSteps}"></label>
      <label>Max template chars<input type="number" data-template value="${state.settings.maxTemplateChars}"></label>
      <label>Max prompt chars<input type="number" data-prompt value="${state.settings.maxPromptChars}"></label>
      <label><input type="checkbox" data-auto ${state.settings.autoMigrateOnLoad ? 'checked' : ''}> Auto migrate on load</label>
      <button data-save>Save</button>
    `, modal => {
      modal.querySelector('[data-save]').onclick = () => {
        state.settings.maxWorkflowSteps = Math.max(1, Number(modal.querySelector('[data-workflow]').value || 50));
        state.settings.maxOrchestrationSteps = Math.max(1, Number(modal.querySelector('[data-orch]').value || 75));
        state.settings.maxTemplateChars = Math.max(1000, Number(modal.querySelector('[data-template]').value || 50000));
        state.settings.maxPromptChars = Math.max(1000, Number(modal.querySelector('[data-prompt]').value || 100000));
        state.settings.autoMigrateOnLoad = modal.querySelector('[data-auto]').checked;
        saveJSON(STORAGE.hardeningSettings, state.settings);
        modal.remove();
        notify('Hardening settings saved.');
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
    state.panel.className = 'aiu10-panel';
    state.panel.innerHTML = `
      <strong>AIU Hardening</strong>
      <button data-action="diagnose">Diagnose</button>
      <button data-action="migrate">Migrate</button>
      <button data-action="reports">Reports</button>
      <button data-action="settings">Settings</button>
    `;
    state.panel.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'diagnose') runDiagnostics();
      if (action === 'migrate') migrateData();
      if (action === 'reports') openReportsHistory();
      if (action === 'settings') openSettingsUI();
    });
    document.body.appendChild(state.panel);
  }

  function injectStyles() {
    GM_addStyle(`
      .aiu10-panel,.aiu10-card,.aiu10-toast{font:13px system-ui,sans-serif;background:#450a0a;color:#fef2f2}.aiu10-panel{position:fixed;left:16px;bottom:716px;z-index:999990;border:1px solid #f87171;border-radius:12px;padding:10px;display:flex;gap:6px;flex-wrap:wrap;max-width:460px;box-shadow:0 12px 30px #0008}.aiu10-panel button,.aiu10-card button{background:#f87171;color:#450a0a;border:0;border-radius:8px;padding:6px 9px;cursor:pointer}.aiu10-modal{position:fixed;inset:0;z-index:1000017;background:#0008;display:grid;place-items:center}.aiu10-card{width:min(1080px,92vw);max-height:86vh;overflow:auto;border-radius:14px;padding:18px;position:relative;border:1px solid #f87171}.aiu10-close{position:absolute;right:12px;top:12px}.aiu10-card input{width:100%;box-sizing:border-box;background:#7f1d1d;color:#fef2f2;border:1px solid #f87171;border-radius:8px;padding:8px}.aiu10-card label{display:grid;gap:4px;margin:10px 0}.aiu10-actions{display:flex;gap:6px;flex-wrap:wrap}.aiu10-row{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;border-bottom:1px solid #ffffff22;padding:8px 0}.aiu10-card pre{white-space:pre-wrap;background:#7f1d1d;padding:10px;border-radius:8px;overflow:auto}.aiu10-toast{position:fixed;left:18px;bottom:798px;z-index:1000018;padding:10px 14px;border-radius:10px;border:1px solid #f87171}
    `);
  }

  function initMenu() {
    GM_registerMenuCommand('AIU Hardening: Diagnose', runDiagnostics);
    GM_registerMenuCommand('AIU Hardening: Migrate Data', migrateData);
    GM_registerMenuCommand('AIU Hardening: Reports', openReportsHistory);
    GM_registerMenuCommand('AIU Hardening: Settings', openSettingsUI);
  }

  function init() {
    injectStyles();
    createPanel();
    initMenu();
    if (state.settings.autoMigrateOnLoad) migrateData();
  }

  init();
})();
