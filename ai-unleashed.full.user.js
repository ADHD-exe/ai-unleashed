// ==UserScript==
// @name         AI Unleashed Full
// @namespace    https://github.com/ADHD-exe/ai-unleashed
// @version      1.0.0
// @description  Merged production build for AI Unleashed: prompts, DSL, workflows, orchestration, search, snapshots, reactive capture, sync, and diagnostics.
// @author       ADHD-exe
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://claude.ai/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
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
  const VERSION = '1.0.0-full';
  const STORAGE = {
    prompts: `${APP}:prompts`,
    workflows: `${APP}:workflows`,
    dslSnippets: `${APP}:dslSnippets`,
    orchestrations: `${APP}:orchestrations`,
    settings: `${APP}:settings`,
    ui: `${APP}:ui`,
    snapshots: `${APP}:snapshots`,
    responses: `${APP}:capturedResponses`,
    reports: `${APP}:hardeningReports`,
    syncMeta: `${APP}:syncMeta`,
    runs: `${APP}:fullRuns`
  };

  const DEFAULT_SETTINGS = {
    theme: 'midnight',
    fontSize: 14,
    maxSteps: 75,
    maxPromptChars: 100000,
    maxTemplateChars: 50000,
    autoCapture: false,
    minResponseChars: 20
  };

  const THEMES = {
    midnight: { bg: '#111827', fg: '#f9fafb', accent: '#60a5fa', panel: '#1f2937' },
    graphite: { bg: '#18181b', fg: '#fafafa', accent: '#a1a1aa', panel: '#27272a' },
    violet: { bg: '#2e1065', fg: '#f5f3ff', accent: '#a78bfa', panel: '#4c1d95' }
  };

  const state = {
    settings: loadObject(STORAGE.settings, DEFAULT_SETTINGS),
    prompts: [], workflows: [], snippets: [], orchestrations: [],
    panel: null, observer: null, seenResponses: new Set()
  };

  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const now = () => new Date().toISOString();
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  function loadRaw(key, fallback) { try { const raw = GM_getValue(key, null); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
  function loadArray(key) { const v = loadRaw(key, []); return Array.isArray(v) ? v : []; }
  function loadObject(key, fallback) { const v = loadRaw(key, {}); return { ...fallback, ...(v && typeof v === 'object' && !Array.isArray(v) ? v : {}) }; }
  function save(key, value) { GM_setValue(key, JSON.stringify(value)); }
  function validDate(v) { return typeof v === 'string' && !Number.isNaN(new Date(v).getTime()); }

  function normalizeBase(input, fallbackTitle) {
    const x = input && typeof input === 'object' ? { ...input } : {};
    const createdAt = validDate(x.createdAt) ? x.createdAt : now();
    return { ...x, id: x.id || uid(), title: String(x.title || x.name || fallbackTitle).trim(), createdAt, updatedAt: validDate(x.updatedAt) ? x.updatedAt : createdAt };
  }
  function normalizePrompt(input) { const p = normalizeBase(input, 'Untitled Prompt'); return { ...p, body: String(p.body || p.content || '').slice(0, state.settings.maxPromptChars), tags: Array.isArray(p.tags) ? p.tags.map(String).filter(Boolean) : [], schemaVersion: 2 }; }
  function normalizeStep(input) { const s = input && typeof input === 'object' ? { ...input } : {}; return { ...s, id: s.id || uid(), label: String(s.label || s.type || 'Step'), type: String(s.type || 'insertText'), promptId: String(s.promptId || ''), snippetId: String(s.snippetId || ''), workflowId: String(s.workflowId || ''), text: String(s.text || '').slice(0, state.settings.maxTemplateChars), value: String(s.value || '').slice(0, state.settings.maxTemplateChars), varName: String(s.varName || ''), saveAs: String(s.saveAs || ''), delayMs: Math.max(0, Number(s.delayMs || 0)), insert: Boolean(s.insert) }; }
  function normalizeWorkflow(input) { const w = normalizeBase(input, 'Untitled Workflow'); return { ...w, description: String(w.description || ''), steps: Array.isArray(w.steps) ? w.steps.slice(0, state.settings.maxSteps).map(normalizeStep) : [], schemaVersion: 1 }; }
  function normalizeSnippet(input) { const s = normalizeBase(input, 'Untitled DSL Snippet'); return { ...s, description: String(s.description || ''), body: String(s.body || '').slice(0, state.settings.maxTemplateChars), schemaVersion: 1 }; }
  function normalizeOrchestration(input) { const o = normalizeBase(input, 'Untitled Orchestration'); return { ...o, description: String(o.description || ''), vars: o.vars && typeof o.vars === 'object' && !Array.isArray(o.vars) ? o.vars : {}, steps: Array.isArray(o.steps) ? o.steps.slice(0, state.settings.maxSteps).map(normalizeStep) : [], schemaVersion: 1 }; }

  function loadAll() {
    state.prompts = loadArray(STORAGE.prompts).map(normalizePrompt);
    state.workflows = loadArray(STORAGE.workflows).map(normalizeWorkflow);
    state.snippets = loadArray(STORAGE.dslSnippets).map(normalizeSnippet);
    state.orchestrations = loadArray(STORAGE.orchestrations).map(normalizeOrchestration);
  }
  function saveAll() { save(STORAGE.prompts, state.prompts); save(STORAGE.workflows, state.workflows); save(STORAGE.dslSnippets, state.snippets); save(STORAGE.orchestrations, state.orchestrations); }

  function platform() { return location.hostname.includes('claude.ai') ? 'claude' : 'chatgpt'; }
  function getEditor() { return document.querySelector(platform() === 'claude' ? 'div[contenteditable="true"], textarea' : 'textarea, [contenteditable="true"]'); }
  function getEditorText() { const e = getEditor(); return e?.tagName === 'TEXTAREA' ? e.value : e?.innerText || ''; }
  function insertText(text) { const e = getEditor(); if (!e) return toast('No editor detected.'); if (e.tagName === 'TEXTAREA') { const s = e.selectionStart ?? e.value.length, end = e.selectionEnd ?? e.value.length; e.value = e.value.slice(0, s) + text + e.value.slice(end); e.selectionStart = e.selectionEnd = s + text.length; } else { e.focus(); document.execCommand('insertText', false, text); } e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); }

  function getPath(path, ctx) { return String(path || '').split('.').filter(Boolean).reduce((cur, part) => cur && Object.prototype.hasOwnProperty.call(cur, part) ? cur[part] : '', ctx) ?? ''; }
  function transform(v, op) { const s = String(v ?? ''); if (op === 'upper') return s.toUpperCase(); if (op === 'lower') return s.toLowerCase(); if (op === 'trim') return s.trim(); if (op === 'json') return JSON.stringify(v, null, 2); if (op === 'bullets') return s.split(/\n|,/).map(x => x.trim()).filter(Boolean).map(x => `- ${x}`).join('\n'); return s; }
  function renderInline(text, ctx) { return String(text || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => { const [path, ...pipes] = String(expr).split('|').map(x => x.trim()); return pipes.reduce((v, p) => transform(v, p), getPath(path, ctx)); }); }
  function evalCond(expr, ctx) { const raw = String(expr || '').trim(); for (const op of ['==','!=','>=','<=','>','<']) { const i = raw.indexOf(op); if (i < 0) continue; const l = String(getPath(raw.slice(0, i).trim(), ctx)); const r = raw.slice(i + op.length).trim().replace(/^['"]|['"]$/g, ''); if (op === '==') return l === r; if (op === '!=') return l !== r; if (op === '>=') return Number(l) >= Number(r); if (op === '<=') return Number(l) <= Number(r); if (op === '>') return Number(l) > Number(r); if (op === '<') return Number(l) < Number(r); } return Boolean(getPath(raw, ctx)); }
  function renderDSL(template, ctx) { return renderBlock(String(template || '').split('\n'), ctx).trim(); }
  function collect(lines, start, endTag) { const block = []; let depth = 0; for (let i = start; i < lines.length; i++) { const line = lines[i]; if (/\{\{%\s*(if|each)\b/.test(line)) depth++; if (new RegExp(`^\\s*\\{\\{%\\s*${endTag}\\s*%\\}\\}`).test(line) && depth === 0) return { block, endIndex: i }; if (/\{\{%\s*end(if|each)/.test(line)) depth--; block.push(line); } return { block, endIndex: lines.length - 1 }; }
  function collectIf(lines, start) { const block = [], elseBlock = []; let target = block, depth = 0; for (let i = start; i < lines.length; i++) { const line = lines[i]; if (/\{\{%\s*(if|each)\b/.test(line)) depth++; if (/^\s*\{\{%\s*else\s*%\}\}/.test(line) && depth === 0) { target = elseBlock; continue; } if (/^\s*\{\{%\s*endif\s*%\}\}/.test(line) && depth === 0) return { block, elseBlock, endIndex: i }; if (/\{\{%\s*end(if|each)/.test(line)) depth--; target.push(line); } return { block, elseBlock, endIndex: lines.length - 1 }; }
  function renderBlock(lines, ctx) { const out = []; for (let i = 0; i < lines.length; i++) { const line = lines[i]; const each = line.match(/^\s*\{\{%\s*each\s+([\w.]+)\s+as\s+(\w+)\s*%\}\}/); if (each) { const found = collect(lines, i + 1, 'endeach'); String(getPath(each[1], ctx)).split(',').map(x => x.trim()).filter(Boolean).forEach(item => out.push(renderBlock(found.block, { ...ctx, [each[2]]: item }))); i = found.endIndex; continue; } const iff = line.match(/^\s*\{\{%\s*if\s+(.+?)\s*%\}\}/); if (iff) { const found = collectIf(lines, i + 1); out.push(renderBlock(evalCond(iff[1], ctx) ? found.block : found.elseBlock, ctx)); i = found.endIndex; continue; } if (/^\s*\{\{%\s*(end|else)/.test(line)) continue; out.push(renderInline(line, ctx)); } return out.join('\n'); }

  async function executeSteps(steps, vars = {}, opts = {}) { const ctx = { vars: { ...vars }, outputs: {}, env: { url: location.href, title: document.title, iso: now(), input: getEditorText() } }; const report = { id: uid(), startedAt: now(), dryRun: Boolean(opts.dryRun), steps: [] }; for (const step of steps.slice(0, state.settings.maxSteps)) { let output = ''; try { if (step.type === 'setVar') ctx.vars[step.varName] = renderInline(step.value || step.text, ctx); if (step.type === 'appendVar') ctx.vars[step.varName] = `${ctx.vars[step.varName] || ''}${renderInline(step.value || step.text, ctx)}`; if (step.type === 'captureInput') output = getEditorText(); if (step.type === 'insertText') output = renderInline(step.text, ctx); if (step.type === 'insertPrompt') output = renderInline(state.prompts.find(p => p.id === step.promptId)?.body || '', ctx); if (step.type === 'renderDSL') output = renderDSL(state.snippets.find(s => s.id === step.snippetId)?.body || step.text, ctx); if (step.type === 'runWorkflow') output = (state.workflows.find(w => w.id === step.workflowId)?.steps || []).map(s => s.type === 'insertText' ? renderInline(s.text, ctx) : s.type === 'insertPrompt' ? renderInline(state.prompts.find(p => p.id === s.promptId)?.body || '', ctx) : '').filter(Boolean).join('\n\n'); if (step.type === 'delay') await new Promise(r => setTimeout(r, Math.min(step.delayMs, 600000))); if (step.saveAs) { ctx.vars[step.saveAs] = output; ctx.outputs[step.saveAs] = output; } if (step.insert && output && !opts.dryRun) insertText(output); report.steps.push({ stepId: step.id, label: step.label, type: step.type, status: 'ok', output }); } catch (err) { report.steps.push({ stepId: step.id, label: step.label, type: step.type, status: 'error', error: String(err?.message || err) }); } } report.completedAt = now(); report.finalVars = ctx.vars; const runs = loadArray(STORAGE.runs); runs.unshift(report); save(STORAGE.runs, runs.slice(0, 100)); return report; }

  function captureResponses() { const nodes = [...document.querySelectorAll('[data-message-author-role="assistant"], article, [data-testid*="message"], .font-claude-message')]; const existing = loadArray(STORAGE.responses); let added = 0; nodes.forEach((el, index) => { const text = (el.innerText || '').trim(); if (text.length < state.settings.minResponseChars) return; const hash = hashText(text); if (state.seenResponses.has(hash) || existing.some(x => x.hash === hash)) return; state.seenResponses.add(hash); existing.unshift({ id: uid(), hash, index, text, url: location.href, title: document.title, capturedAt: now(), extracted: { fencedBlocks: [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1].trim()), headings: text.split('\n').filter(l => /^#{1,6}\s+/.test(l.trim())), bullets: text.split('\n').filter(l => /^\s*[-*+]\s+/.test(l)) } }); added++; }); if (added) save(STORAGE.responses, existing.slice(0, 200)); return added; }
  function hashText(text) { let h = 0; for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0; return String(h); }

  function buildDiagnostics() { const report = { id: uid(), version: VERSION, createdAt: now(), summary: { prompts: state.prompts.length, workflows: state.workflows.length, snippets: state.snippets.length, orchestrations: state.orchestrations.length }, errors: [], warnings: [] }; const checkIds = (items, type) => { const seen = new Set(); items.forEach((x, i) => { if (!x.id) report.errors.push(`${type}[${i}] missing id`); if (seen.has(x.id)) report.errors.push(`${type}[${i}] duplicate id ${x.id}`); seen.add(x.id); }); }; checkIds(state.prompts, 'prompt'); checkIds(state.workflows, 'workflow'); checkIds(state.snippets, 'snippet'); checkIds(state.orchestrations, 'orchestration'); state.prompts.forEach((p, i) => { if (!p.body) report.warnings.push(`prompt[${i}] empty body`); }); const promptIds = new Set(state.prompts.map(p => p.id)), snippetIds = new Set(state.snippets.map(s => s.id)), workflowIds = new Set(state.workflows.map(w => w.id)); state.orchestrations.forEach(o => o.steps.forEach(s => { if (s.promptId && !promptIds.has(s.promptId)) report.warnings.push(`${o.title}: missing prompt ${s.promptId}`); if (s.snippetId && !snippetIds.has(s.snippetId)) report.warnings.push(`${o.title}: missing snippet ${s.snippetId}`); if (s.workflowId && !workflowIds.has(s.workflowId)) report.warnings.push(`${o.title}: missing workflow ${s.workflowId}`); })); const reports = loadArray(STORAGE.reports); reports.unshift(report); save(STORAGE.reports, reports.slice(0, 50)); return report; }

  function createSnapshot() { const snap = { id: uid(), createdAt: now(), data: { prompts: state.prompts, workflows: state.workflows, dslSnippets: state.snippets, orchestrations: state.orchestrations } }; const snaps = loadArray(STORAGE.snapshots); snaps.unshift(snap); save(STORAGE.snapshots, snaps.slice(0, 30)); toast('Snapshot created.'); }
  function exportBundle() { downloadJSON(`ai-unleashed-full-${new Date().toISOString().slice(0,10)}.json`, { version: VERSION, exportedAt: now(), prompts: state.prompts, workflows: state.workflows, dslSnippets: state.snippets, orchestrations: state.orchestrations, settings: state.settings }); }
  function importBundle() { const raw = prompt('Paste AI Unleashed bundle JSON'); if (!raw) return; try { const d = JSON.parse(raw); if (Array.isArray(d.prompts)) state.prompts = d.prompts.map(normalizePrompt); if (Array.isArray(d.workflows)) state.workflows = d.workflows.map(normalizeWorkflow); if (Array.isArray(d.dslSnippets)) state.snippets = d.dslSnippets.map(normalizeSnippet); if (Array.isArray(d.orchestrations)) state.orchestrations = d.orchestrations.map(normalizeOrchestration); saveAll(); toast('Bundle imported. Reload recommended.'); } catch { toast('Invalid bundle JSON.'); } }
  function downloadJSON(filename, data) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href); }

  function openModal(title, html, bind) { const m = document.createElement('div'); m.className = 'aiuf-modal'; m.innerHTML = `<div class="aiuf-card"><button class="aiuf-close">×</button><h2>${esc(title)}</h2>${html}</div>`; m.querySelector('.aiuf-close').onclick = () => m.remove(); m.addEventListener('click', e => { if (e.target === m) m.remove(); }); document.body.appendChild(m); bind?.(m); return m; }
  function toast(msg) { const n = document.createElement('div'); n.className = 'aiuf-toast'; n.textContent = msg; document.body.appendChild(n); setTimeout(() => n.remove(), 3000); }

  function openPrompts() { const rows = state.prompts.map(p => `<div class="aiuf-row"><strong>${esc(p.title)}</strong><span>${esc(p.tags.join(', '))}</span><button data-insert="${p.id}">Insert</button><button data-edit="${p.id}">Edit</button><button data-del="${p.id}">Delete</button></div>`).join('') || '<p>No prompts.</p>'; openModal('Prompts', `<button data-new>New Prompt</button>${rows}`, m => { m.querySelector('[data-new]').onclick = () => editPrompt(); m.querySelectorAll('[data-insert]').forEach(b => b.onclick = () => insertText(state.prompts.find(p => p.id === b.dataset.insert)?.body || '')); m.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editPrompt(state.prompts.find(p => p.id === b.dataset.edit))); m.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { state.prompts = state.prompts.filter(p => p.id !== b.dataset.del); saveAll(); m.remove(); openPrompts(); }); }); }
  function editPrompt(p = null) { const x = normalizePrompt(p || {}); openModal(p ? 'Edit Prompt' : 'New Prompt', `<label>Title<input data-title value="${esc(x.title)}"></label><label>Tags<input data-tags value="${esc(x.tags.join(', '))}"></label><label>Body<textarea data-body rows="12">${esc(x.body)}</textarea></label><button data-save>Save</button>`, m => { m.querySelector('[data-save]').onclick = () => { const next = normalizePrompt({ ...x, title: m.querySelector('[data-title]').value, body: m.querySelector('[data-body]').value, tags: m.querySelector('[data-tags]').value.split(',').map(s => s.trim()).filter(Boolean), updatedAt: now() }); state.prompts = state.prompts.filter(p => p.id !== next.id).concat(next); saveAll(); m.remove(); toast('Prompt saved.'); }; }); }
  function openDSL() { openModal('DSL Playground', `<label>Vars JSON<textarea data-vars rows="6">{"topic":"AI Unleashed","audience":"developer","points":"prompts, workflows, sync"}</textarea></label><label>Template<textarea data-template rows="12">Write about {{ vars.topic }}.\n{% if vars.audience == "developer" %}\nInclude implementation details.\n{% endif %}\n{% each vars.points as point %}\n- {{ point|trim }}\n{% endeach %}</textarea></label><button data-preview>Preview</button><button data-insert>Insert</button><pre data-out></pre>`, m => { const render = () => renderDSL(m.querySelector('[data-template]').value, { vars: JSON.parse(m.querySelector('[data-vars]').value || '{}'), env: { url: location.href, title: document.title, iso: now(), input: getEditorText() } }); m.querySelector('[data-preview]').onclick = () => { try { m.querySelector('[data-out]').textContent = render(); } catch { toast('Invalid vars JSON.'); } }; m.querySelector('[data-insert]').onclick = () => { try { insertText(render()); } catch { toast('Invalid vars JSON.'); } }; }); }
  function openOrchestrations() { const rows = state.orchestrations.map(o => `<div class="aiuf-row"><strong>${esc(o.title)}</strong><span>${o.steps.length} steps</span><button data-run="${o.id}">Run</button><button data-dry="${o.id}">Dry</button></div>`).join('') || '<p>No orchestrations.</p>'; openModal('Orchestrations', `<button data-seed>Seed Demo</button>${rows}`, m => { m.querySelector('[data-seed]').onclick = () => { state.orchestrations.push(normalizeOrchestration({ title: 'Demo Orchestration', vars: { topic: 'AI Unleashed' }, steps: [{ type: 'insertText', label: 'Insert', text: 'Explain {{ vars.topic }}.', insert: true }] })); saveAll(); m.remove(); openOrchestrations(); }; m.querySelectorAll('[data-run]').forEach(b => b.onclick = async () => { await executeSteps(state.orchestrations.find(o => o.id === b.dataset.run)?.steps || [], state.orchestrations.find(o => o.id === b.dataset.run)?.vars || {}); toast('Run complete.'); }); m.querySelectorAll('[data-dry]').forEach(b => b.onclick = async () => openModal('Dry Run Report', `<pre>${esc(JSON.stringify(await executeSteps(state.orchestrations.find(o => o.id === b.dataset.dry)?.steps || [], state.orchestrations.find(o => o.id === b.dataset.dry)?.vars || {}, { dryRun: true }), null, 2))}</pre>`)); }); }
  function openDiagnostics() { openModal('Diagnostics', `<pre>${esc(JSON.stringify(buildDiagnostics(), null, 2))}</pre><button data-migrate>Migrate + Save</button>`, m => { m.querySelector('[data-migrate]').onclick = () => { loadAll(); saveAll(); toast('Migration saved.'); }; }); }
  function openCaptured() { const rows = loadArray(STORAGE.responses).map(r => `<div class="aiuf-row"><strong>${esc(r.title || 'Response')}</strong><span>${esc(r.capturedAt)}</span><button data-view="${r.id}">View</button></div>`).join('') || '<p>No responses.</p>'; openModal('Captured Responses', `<button data-cap>Capture Now</button>${rows}`, m => { m.querySelector('[data-cap]').onclick = () => toast(`Captured ${captureResponses()} new responses.`); m.querySelectorAll('[data-view]').forEach(b => b.onclick = () => openModal('Response', `<pre>${esc(JSON.stringify(loadArray(STORAGE.responses).find(r => r.id === b.dataset.view), null, 2))}</pre>`)); }); }

  function createPanel() { if (state.panel) state.panel.remove(); const t = THEMES[state.settings.theme] || THEMES.midnight; Object.entries({ '--aiuf-bg': t.bg, '--aiuf-fg': t.fg, '--aiuf-accent': t.accent, '--aiuf-panel': t.panel }).forEach(([k,v]) => document.documentElement.style.setProperty(k, v)); state.panel = document.createElement('div'); state.panel.className = 'aiuf-panel'; state.panel.innerHTML = `<strong>AI Unleashed Full</strong><button data-a="prompts">Prompts</button><button data-a="dsl">DSL</button><button data-a="orch">Orchestrate</button><button data-a="capture">Capture</button><button data-a="diag">Diagnose</button><button data-a="snap">Snapshot</button><button data-a="export">Export</button><button data-a="import">Import</button>`; state.panel.addEventListener('click', e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'prompts') openPrompts(); if (a === 'dsl') openDSL(); if (a === 'orch') openOrchestrations(); if (a === 'capture') openCaptured(); if (a === 'diag') openDiagnostics(); if (a === 'snap') createSnapshot(); if (a === 'export') exportBundle(); if (a === 'import') importBundle(); }); document.body.appendChild(state.panel); }
  function injectStyles() { GM_addStyle(`.aiuf-panel,.aiuf-card,.aiuf-toast{font:14px system-ui,sans-serif;background:var(--aiuf-panel);color:var(--aiuf-fg)}.aiuf-panel{position:fixed;right:16px;bottom:16px;z-index:1000000;border:1px solid var(--aiuf-accent);border-radius:12px;padding:10px;display:flex;gap:6px;flex-wrap:wrap;max-width:520px;box-shadow:0 12px 30px #0008}.aiuf-panel button,.aiuf-card button{background:var(--aiuf-accent);color:var(--aiuf-bg);border:0;border-radius:8px;padding:6px 9px;cursor:pointer}.aiuf-modal{position:fixed;inset:0;background:#0008;z-index:1000001;display:grid;place-items:center}.aiuf-card{width:min(980px,92vw);max-height:86vh;overflow:auto;border:1px solid var(--aiuf-accent);border-radius:14px;padding:18px;position:relative}.aiuf-close{position:absolute;right:12px;top:12px}.aiuf-card input,.aiuf-card textarea{width:100%;box-sizing:border-box;background:var(--aiuf-bg);color:var(--aiuf-fg);border:1px solid var(--aiuf-accent);border-radius:8px;padding:8px}.aiuf-card label{display:grid;gap:4px;margin:10px 0}.aiuf-row{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;border-bottom:1px solid #ffffff22;padding:8px 0}.aiuf-card pre{white-space:pre-wrap;background:var(--aiuf-bg);padding:10px;border-radius:8px;overflow:auto}.aiuf-toast{position:fixed;right:18px;bottom:92px;z-index:1000002;padding:10px 14px;border:1px solid var(--aiuf-accent);border-radius:10px}`); }
  function initMenu() { GM_registerMenuCommand('AI Unleashed Full: Prompts', openPrompts); GM_registerMenuCommand('AI Unleashed Full: DSL', openDSL); GM_registerMenuCommand('AI Unleashed Full: Orchestrations', openOrchestrations); GM_registerMenuCommand('AI Unleashed Full: Diagnostics', openDiagnostics); GM_registerMenuCommand('AI Unleashed Full: Export Bundle', exportBundle); }
  function initObserver() { if (!state.settings.autoCapture) return; state.observer = new MutationObserver(() => setTimeout(captureResponses, 1000)); state.observer.observe(document.body, { childList: true, subtree: true, characterData: true }); }

  function init() { loadAll(); saveAll(); injectStyles(); createPanel(); initMenu(); initObserver(); }
  init();
})();
