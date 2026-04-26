// ==UserScript==
// @name         AI Unleashed - Agent 5 Orchestrator
// @namespace    https://github.com/ADHD-exe/ai-unleashed
// @version      0.5.0
// @description  Workflow + DSL orchestration layer for AI Unleashed: variable passing, chained roles, step outputs, execution reports, and safe dry runs.
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
  const VERSION = '0.5.0-agent5-orchestrator';
  const STORAGE = {
    prompts: `${APP}:prompts`,
    workflows: `${APP}:workflows`,
    dslSnippets: `${APP}:dslSnippets`,
    orchestrations: `${APP}:orchestrations`,
    orchestrationRuns: `${APP}:orchestrationRuns`,
  };

  const state = {
    orchestrations: loadJSON(STORAGE.orchestrations, []),
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
    return Array.isArray(raw) ? raw : [];
  }

  function getWorkflows() {
    const raw = loadJSON(STORAGE.workflows, []);
    return Array.isArray(raw) ? raw : [];
  }

  function getSnippets() {
    const raw = loadJSON(STORAGE.dslSnippets, []);
    return Array.isArray(raw) ? raw : [];
  }

  function notify(message) {
    const n = document.createElement('div');
    n.className = 'aiu5-toast';
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
  }

  function openModal(title, html, bind) {
    const modal = document.createElement('div');
    modal.className = 'aiu5-modal';
    modal.innerHTML = `<div class="aiu5-card"><button class="aiu5-close">×</button><h2>${escapeHTML(title)}</h2>${html}</div>`;
    modal.querySelector('.aiu5-close').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    bind?.(modal);
    return modal;
  }

  function getEditor() {
    return document.querySelector('textarea, [contenteditable="true"]');
  }

  function getEditorText() {
    const editor = getEditor();
    return editor?.tagName === 'TEXTAREA' ? editor.value : editor?.innerText || '';
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

  function normalizeOrchestration(input) {
    const o = { ...(input || {}) };
    return {
      id: o.id || uid(),
      title: String(o.title || 'Untitled Orchestration').trim(),
      description: String(o.description || '').trim(),
      vars: o.vars && typeof o.vars === 'object' ? o.vars : {},
      steps: Array.isArray(o.steps) ? o.steps.map(normalizeStep) : [],
      createdAt: o.createdAt || now(),
      updatedAt: o.updatedAt || now(),
      schemaVersion: 1,
    };
  }

  function normalizeStep(input) {
    const s = { ...(input || {}) };
    return {
      id: s.id || uid(),
      label: String(s.label || s.type || 'Step').trim(),
      type: ['renderDSL', 'insertPrompt', 'insertText', 'captureInput', 'delay', 'setVar', 'appendVar', 'runWorkflow', 'exportReport'].includes(s.type) ? s.type : 'insertText',
      snippetId: s.snippetId || '',
      promptId: s.promptId || '',
      workflowId: s.workflowId || '',
      text: String(s.text || '').trim(),
      varName: String(s.varName || '').trim(),
      value: String(s.value || '').trim(),
      delayMs: Number.isFinite(Number(s.delayMs)) ? Math.max(0, Number(s.delayMs)) : 0,
      insert: Boolean(s.insert),
      saveAs: String(s.saveAs || '').trim(),
    };
  }

  function getValue(path, ctx) {
    const parts = String(path || '').split('.').filter(Boolean);
    let cur = ctx;
    for (const part of parts) cur = cur && Object.prototype.hasOwnProperty.call(cur, part) ? cur[part] : '';
    return cur ?? '';
  }

  function applyTransform(value, transform) {
    const v = String(value ?? '');
    if (transform === 'upper') return v.toUpperCase();
    if (transform === 'lower') return v.toLowerCase();
    if (transform === 'trim') return v.trim();
    if (transform === 'json') return JSON.stringify(value, null, 2);
    if (transform === 'quote') return `"${v.replaceAll('"', '\\"')}"`;
    if (transform === 'bullets') return v.split(/\n|,/).map(s => s.trim()).filter(Boolean).map(s => `- ${s}`).join('\n');
    return v;
  }

  function renderInline(text, ctx) {
    return String(text || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
      const [path, ...pipes] = String(expr).split('|').map(s => s.trim());
      let value = getValue(path, ctx);
      for (const pipe of pipes) value = applyTransform(value, pipe);
      return value;
    });
  }

  function evalCondition(expr, ctx) {
    const raw = String(expr || '').trim();
    for (const op of ['==', '!=', '>=', '<=', '>', '<']) {
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

  function renderDSL(template, ctx) {
    return renderBlock(String(template || '').split('\n'), ctx).trim();
  }

  function renderBlock(lines, ctx) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const each = line.match(/^\s*\{\{%\s*each\s+([\w.]+)\s+as\s+(\w+)\s*%\}\}\s*$/);
      if (each) {
        const found = collectBlock(lines, i + 1, 'each');
        const list = String(getValue(each[1], ctx)).split(',').map(s => s.trim()).filter(Boolean);
        for (const item of list) out.push(renderBlock(found.block, { ...ctx, [each[2]]: item }));
        i = found.endIndex;
        continue;
      }
      const iff = line.match(/^\s*\{\{%\s*if\s+(.+?)\s*%\}\}\s*$/);
      if (iff) {
        const found = collectIfBlock(lines, i + 1);
        out.push(renderBlock(evalCondition(iff[1], ctx) ? found.block : found.elseBlock, ctx));
        i = found.endIndex;
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

  async function runOrchestration(orchestration, options = {}) {
    const o = normalizeOrchestration(orchestration);
    const ctx = {
      vars: { ...o.vars },
      outputs: {},
      env: { url: location.href, title: document.title, iso: now(), input: getEditorText() },
    };
    const report = { id: uid(), orchestrationId: o.id, title: o.title, dryRun: Boolean(options.dryRun), startedAt: now(), steps: [], finalVars: null };

    for (const step of o.steps) {
      const startedAt = now();
      let output = '';
      try {
        if (step.type === 'setVar') ctx.vars[step.varName] = renderInline(step.value || step.text, ctx);
        if (step.type === 'appendVar') ctx.vars[step.varName] = `${ctx.vars[step.varName] || ''}${renderInline(step.value || step.text, ctx)}`;
        if (step.type === 'captureInput') output = getEditorText();
        if (step.type === 'insertText') output = renderInline(step.text, ctx);
        if (step.type === 'insertPrompt') {
          const prompt = getPrompts().find(p => p.id === step.promptId);
          output = renderInline(prompt?.body || '', ctx);
        }
        if (step.type === 'renderDSL') {
          const snippet = getSnippets().find(s => s.id === step.snippetId);
          output = renderDSL(snippet?.body || step.text, ctx);
        }
        if (step.type === 'delay') await new Promise(resolve => setTimeout(resolve, step.delayMs));
        if (step.type === 'runWorkflow') output = renderLegacyWorkflow(step.workflowId, ctx);
        if (step.type === 'exportReport') downloadJSON(`aiu-orchestration-report-${Date.now()}.json`, report);

        if (step.saveAs) {
          ctx.outputs[step.saveAs] = output;
          ctx.vars[step.saveAs] = output;
        }
        if (step.insert && output && !options.dryRun) insertIntoEditor(output);
        report.steps.push({ stepId: step.id, label: step.label, type: step.type, output, status: 'ok', startedAt, completedAt: now() });
      } catch (err) {
        report.steps.push({ stepId: step.id, label: step.label, type: step.type, output, status: 'error', error: String(err?.message || err), startedAt, completedAt: now() });
      }
    }
    report.completedAt = now();
    report.finalVars = ctx.vars;
    persistRun(report);
    notify(options.dryRun ? 'Orchestration dry run complete.' : `Orchestration complete: ${o.title}`);
    return report;
  }

  function renderLegacyWorkflow(workflowId, ctx) {
    const workflow = getWorkflows().find(w => w.id === workflowId);
    if (!workflow) return '';
    return (workflow.steps || []).map(step => {
      if (step.type === 'insertText') return renderInline(step.text || '', ctx);
      if (step.type === 'insertPrompt') {
        const prompt = getPrompts().find(p => p.id === step.promptId);
        return renderInline(prompt?.body || '', ctx);
      }
      return '';
    }).filter(Boolean).join('\n\n');
  }

  function persistRun(report) {
    const runs = loadJSON(STORAGE.orchestrationRuns, []);
    runs.unshift(report);
    saveJSON(STORAGE.orchestrationRuns, runs.slice(0, 100));
  }

  function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function saveOrchestrations() {
    state.orchestrations = state.orchestrations.map(normalizeOrchestration);
    saveJSON(STORAGE.orchestrations, state.orchestrations);
  }

  function seedOrchestration() {
    const snippets = getSnippets();
    const prompts = getPrompts();
    state.orchestrations.push(normalizeOrchestration({
      title: 'Planner → Executor → Reviewer',
      description: 'Demo orchestration that passes variables between role steps.',
      vars: { topic: 'AI Unleashed', audience: 'developer', requirements: 'security, reliability, performance' },
      steps: [
        { type: 'setVar', label: 'Set role', varName: 'role', value: 'planner' },
        { type: 'insertText', label: 'Planner prompt', text: 'Act as a {{ vars.role }}. Create a plan for {{ vars.topic }} focused on {{ vars.requirements }}.', saveAs: 'plan', insert: true },
        { type: 'delay', label: 'Pause', delayMs: 250 },
        { type: 'setVar', label: 'Set role', varName: 'role', value: 'reviewer' },
        { type: 'insertText', label: 'Reviewer prompt', text: '\n\nNow act as a {{ vars.role }} and critique the plan for {{ vars.audience }} users.', saveAs: 'review', insert: true },
      ],
    }));
    saveOrchestrations();
    notify('Demo orchestration seeded.');
  }

  function openOrchestrationManager() {
    state.orchestrations = state.orchestrations.map(normalizeOrchestration);
    const rows = state.orchestrations.map(o => `<div class="aiu5-row"><strong>${escapeHTML(o.title)}</strong><span>${o.steps.length} steps</span><button data-run="${o.id}">Run</button><button data-dry="${o.id}">Dry Run</button><button data-edit="${o.id}">Edit</button><button data-delete="${o.id}">Delete</button></div>`).join('') || '<p>No orchestrations saved.</p>';
    openModal('Orchestration Manager', `<div class="aiu5-actions"><button data-new>New</button><button data-seed>Seed Demo</button><button data-runs>Run History</button></div><div>${rows}</div>`, modal => {
      modal.querySelector('[data-new]').onclick = () => openOrchestrationEditor();
      modal.querySelector('[data-seed]').onclick = () => { seedOrchestration(); modal.remove(); openOrchestrationManager(); };
      modal.querySelector('[data-runs]').onclick = openRunHistory;
      modal.querySelectorAll('[data-run]').forEach(btn => btn.onclick = () => runOrchestration(state.orchestrations.find(o => o.id === btn.dataset.run)));
      modal.querySelectorAll('[data-dry]').forEach(btn => btn.onclick = async () => openRunReport(await runOrchestration(state.orchestrations.find(o => o.id === btn.dataset.dry), { dryRun: true })));
      modal.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openOrchestrationEditor(state.orchestrations.find(o => o.id === btn.dataset.edit)));
      modal.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => {
        state.orchestrations = state.orchestrations.filter(o => o.id !== btn.dataset.delete);
        saveOrchestrations();
        modal.remove();
        openOrchestrationManager();
      });
    });
  }

  function openOrchestrationEditor(existing = null) {
    const o = normalizeOrchestration(existing || {});
    openModal(existing ? 'Edit Orchestration' : 'New Orchestration', `
      <label>Title<input data-title value="${escapeHTML(o.title)}"></label>
      <label>Description<input data-description value="${escapeHTML(o.description)}"></label>
      <label>Variables JSON<textarea data-vars rows="7">${escapeHTML(JSON.stringify(o.vars, null, 2))}</textarea></label>
      <label>Steps JSON<textarea data-steps rows="16">${escapeHTML(JSON.stringify(o.steps, null, 2))}</textarea></label>
      <p>Step types: renderDSL, insertPrompt, insertText, captureInput, delay, setVar, appendVar, runWorkflow, exportReport.</p>
      <button data-save>Save</button>
    `, modal => {
      modal.querySelector('[data-save]').onclick = () => {
        try {
          const next = normalizeOrchestration({
            ...o,
            title: modal.querySelector('[data-title]').value,
            description: modal.querySelector('[data-description]').value,
            vars: JSON.parse(modal.querySelector('[data-vars]').value || '{}'),
            steps: JSON.parse(modal.querySelector('[data-steps]').value || '[]'),
            updatedAt: now(),
          });
          state.orchestrations = state.orchestrations.filter(item => item.id !== next.id).concat(next);
          saveOrchestrations();
          modal.remove();
          notify('Orchestration saved.');
        } catch (_) {
          notify('Invalid orchestration JSON.');
        }
      };
    });
  }

  function openRunHistory() {
    const runs = loadJSON(STORAGE.orchestrationRuns, []);
    const rows = runs.map(r => `<div class="aiu5-row"><span>${escapeHTML(r.startedAt)}</span><strong>${escapeHTML(r.title)}</strong><button data-view="${r.id}">View</button><button data-export="${r.id}">Export</button></div>`).join('') || '<p>No orchestration runs recorded.</p>';
    openModal('Orchestration Run History', `<div>${rows}</div>`, modal => {
      modal.querySelectorAll('[data-view]').forEach(btn => btn.onclick = () => openRunReport(runs.find(r => r.id === btn.dataset.view)));
      modal.querySelectorAll('[data-export]').forEach(btn => btn.onclick = () => downloadJSON(`aiu-run-${btn.dataset.export}.json`, runs.find(r => r.id === btn.dataset.export)));
    });
  }

  function openRunReport(report) {
    if (!report) return notify('Run report missing.');
    const rows = report.steps.map(s => `<div class="aiu5-row"><strong>${escapeHTML(s.label)}</strong><span>${escapeHTML(s.type)}</span><span>${escapeHTML(s.status)}</span><button data-output="${s.stepId}">Output</button></div>`).join('');
    openModal('Orchestration Run Report', `<pre>${escapeHTML(JSON.stringify({ id: report.id, title: report.title, dryRun: report.dryRun, startedAt: report.startedAt, completedAt: report.completedAt, finalVars: report.finalVars }, null, 2))}</pre><div>${rows}</div>`, modal => {
      modal.querySelectorAll('[data-output]').forEach(btn => btn.onclick = () => {
        const step = report.steps.find(s => s.stepId === btn.dataset.output);
        openModal('Step Output', `<pre>${escapeHTML(step?.output || step?.error || '')}</pre>`);
      });
    });
  }

  function exportOrchestrations() {
    downloadJSON(`ai-unleashed-orchestrations-${new Date().toISOString().slice(0, 10)}.json`, {
      version: VERSION,
      exportedAt: now(),
      orchestrations: state.orchestrations.map(normalizeOrchestration),
      runs: loadJSON(STORAGE.orchestrationRuns, []),
    });
  }

  function importOrchestrations() {
    const raw = prompt('Paste orchestration bundle JSON');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.orchestrations)) {
        state.orchestrations = state.orchestrations.concat(parsed.orchestrations.map(normalizeOrchestration));
        saveOrchestrations();
      }
      if (Array.isArray(parsed.runs)) saveJSON(STORAGE.orchestrationRuns, parsed.runs.slice(0, 100));
      notify('Orchestration bundle imported.');
    } catch (_) {
      notify('Invalid orchestration bundle JSON.');
    }
  }

  function createPanel() {
    if (state.panel) state.panel.remove();
    state.panel = document.createElement('div');
    state.panel.className = 'aiu5-panel';
    state.panel.innerHTML = `
      <strong>AIU Orchestrator</strong>
      <button data-action="manager">Manager</button>
      <button data-action="runs">Runs</button>
      <button data-action="export">Export</button>
      <button data-action="import">Import</button>
    `;
    state.panel.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'manager') openOrchestrationManager();
      if (action === 'runs') openRunHistory();
      if (action === 'export') exportOrchestrations();
      if (action === 'import') importOrchestrations();
    });
    document.body.appendChild(state.panel);
  }

  function injectStyles() {
    GM_addStyle(`
      .aiu5-panel,.aiu5-card,.aiu5-toast{font:13px system-ui,sans-serif;background:#18181b;color:#fafafa}.aiu5-panel{position:fixed;left:16px;bottom:216px;z-index:999995;border:1px solid #f59e0b;border-radius:12px;padding:10px;display:flex;gap:6px;flex-wrap:wrap;max-width:430px;box-shadow:0 12px 30px #0008}.aiu5-panel button,.aiu5-card button{background:#f59e0b;color:#18181b;border:0;border-radius:8px;padding:6px 9px;cursor:pointer}.aiu5-modal{position:fixed;inset:0;z-index:1000007;background:#0008;display:grid;place-items:center}.aiu5-card{width:min(1040px,92vw);max-height:86vh;overflow:auto;border-radius:14px;padding:18px;position:relative;border:1px solid #f59e0b}.aiu5-close{position:absolute;right:12px;top:12px}.aiu5-card label{display:grid;gap:4px;margin:10px 0}.aiu5-card input,.aiu5-card textarea{width:100%;box-sizing:border-box;background:#09090b;color:#fafafa;border:1px solid #f59e0b;border-radius:8px;padding:8px}.aiu5-actions{display:flex;gap:6px;flex-wrap:wrap}.aiu5-row{display:grid;grid-template-columns:1fr auto auto auto auto;gap:8px;align-items:center;border-bottom:1px solid #ffffff22;padding:8px 0}.aiu5-card pre{white-space:pre-wrap;background:#09090b;padding:10px;border-radius:8px;overflow:auto}.aiu5-toast{position:fixed;left:18px;bottom:298px;z-index:1000008;padding:10px 14px;border-radius:10px;border:1px solid #f59e0b}
    `);
  }

  function initMenu() {
    GM_registerMenuCommand('AIU Orchestrator: Manager', openOrchestrationManager);
    GM_registerMenuCommand('AIU Orchestrator: Run History', openRunHistory);
    GM_registerMenuCommand('AIU Orchestrator: Export', exportOrchestrations);
    GM_registerMenuCommand('AIU Orchestrator: Import', importOrchestrations);
  }

  function init() {
    state.orchestrations = state.orchestrations.map(normalizeOrchestration);
    saveOrchestrations();
    injectStyles();
    createPanel();
    initMenu();
  }

  init();
})();
