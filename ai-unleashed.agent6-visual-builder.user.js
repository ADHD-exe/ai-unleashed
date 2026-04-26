// ==UserScript==
// @name         AI Unleashed - Agent 6 Visual Builder
// @namespace    https://github.com/ADHD-exe/ai-unleashed
// @version      0.6.0
// @description  Visual builder and graph layer for AI Unleashed: node orchestration editor, dependency graph, floating prompt mini-windows, and visual exports.
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
  const VERSION = '0.6.0-agent6-visual-builder';
  const STORAGE = {
    prompts: `${APP}:prompts`,
    workflows: `${APP}:workflows`,
    dslSnippets: `${APP}:dslSnippets`,
    orchestrations: `${APP}:orchestrations`,
    visualLayouts: `${APP}:visualLayouts`,
    miniWindows: `${APP}:miniWindows`,
  };

  const state = {
    panel: null,
    layouts: loadJSON(STORAGE.visualLayouts, {}),
    miniWindows: loadJSON(STORAGE.miniWindows, []),
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

  function getPrompts() { const raw = loadJSON(STORAGE.prompts, []); return Array.isArray(raw) ? raw : []; }
  function getWorkflows() { const raw = loadJSON(STORAGE.workflows, []); return Array.isArray(raw) ? raw : []; }
  function getSnippets() { const raw = loadJSON(STORAGE.dslSnippets, []); return Array.isArray(raw) ? raw : []; }
  function getOrchestrations() { const raw = loadJSON(STORAGE.orchestrations, []); return Array.isArray(raw) ? raw : []; }
  function setOrchestrations(value) { saveJSON(STORAGE.orchestrations, Array.isArray(value) ? value : []); }

  function notify(message) {
    const n = document.createElement('div');
    n.className = 'aiu6-toast';
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
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

  function openModal(title, html, bind) {
    const modal = document.createElement('div');
    modal.className = 'aiu6-modal';
    modal.innerHTML = `<div class="aiu6-card"><button class="aiu6-close">×</button><h2>${escapeHTML(title)}</h2>${html}</div>`;
    modal.querySelector('.aiu6-close').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    bind?.(modal);
    return modal;
  }

  function normalizeStep(step) {
    const s = { ...(step || {}) };
    return {
      id: s.id || uid(),
      label: String(s.label || s.type || 'Step').trim(),
      type: s.type || 'insertText',
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

  function normalizeOrchestration(input) {
    const o = { ...(input || {}) };
    return {
      id: o.id || uid(),
      title: String(o.title || 'Untitled Visual Orchestration').trim(),
      description: String(o.description || '').trim(),
      vars: o.vars && typeof o.vars === 'object' ? o.vars : {},
      steps: Array.isArray(o.steps) ? o.steps.map(normalizeStep) : [],
      createdAt: o.createdAt || now(),
      updatedAt: now(),
      schemaVersion: 1,
    };
  }

  function openVisualBuilder(orchestration = null) {
    const o = normalizeOrchestration(orchestration || {});
    const layout = state.layouts[o.id] || autoLayout(o);
    const nodes = o.steps.map((step, index) => nodeHTML(step, index, layout[step.id] || { x: 40 + index * 210, y: 80 })).join('');
    openModal('Visual Orchestration Builder', `
      <label>Title<input data-title value="${escapeHTML(o.title)}"></label>
      <label>Description<input data-description value="${escapeHTML(o.description)}"></label>
      <div class="aiu6-actions"><button data-add>Add Node</button><button data-save>Save Orchestration</button><button data-json>Open JSON Editor</button><button data-export>Export Graph</button></div>
      <div class="aiu6-canvas" data-canvas>${nodes}<svg data-edges class="aiu6-edges"></svg></div>
    `, modal => {
      const canvas = modal.querySelector('[data-canvas]');
      drawEdges(canvas);
      canvas.querySelectorAll('.aiu6-node').forEach(node => makeNodeDraggable(node, canvas, o.id));
      canvas.querySelectorAll('[data-edit-node]').forEach(btn => btn.onclick = () => openNodeEditor(o, btn.dataset.editNode, () => { modal.remove(); openVisualBuilder(o); }));
      canvas.querySelectorAll('[data-delete-node]').forEach(btn => btn.onclick = () => { o.steps = o.steps.filter(s => s.id !== btn.dataset.deleteNode); modal.remove(); openVisualBuilder(o); });
      modal.querySelector('[data-add]').onclick = () => { o.steps.push(normalizeStep({ type: 'insertText', label: 'New Node', text: '' })); modal.remove(); openVisualBuilder(o); };
      modal.querySelector('[data-json]').onclick = () => openJSONEditor(o);
      modal.querySelector('[data-export]').onclick = () => downloadJSON(`aiu-visual-graph-${o.id}.json`, { orchestration: o, layout: state.layouts[o.id] || layout });
      modal.querySelector('[data-save]').onclick = () => {
        o.title = modal.querySelector('[data-title]').value;
        o.description = modal.querySelector('[data-description]').value;
        const all = getOrchestrations().filter(item => item.id !== o.id).concat(normalizeOrchestration(o));
        setOrchestrations(all);
        saveJSON(STORAGE.visualLayouts, state.layouts);
        notify('Visual orchestration saved.');
      };
    });
  }

  function nodeHTML(step, index, pos) {
    return `<div class="aiu6-node" data-node-id="${step.id}" style="left:${pos.x}px;top:${pos.y}px"><strong>${index + 1}. ${escapeHTML(step.label)}</strong><small>${escapeHTML(step.type)}</small><div>${escapeHTML(step.saveAs ? `saveAs: ${step.saveAs}` : step.promptId || step.snippetId || step.workflowId || step.text.slice(0, 48))}</div><div class="aiu6-actions"><button data-edit-node="${step.id}">Edit</button><button data-delete-node="${step.id}">Delete</button></div></div>`;
  }

  function autoLayout(orchestration) {
    const layout = {};
    orchestration.steps.forEach((step, index) => { layout[step.id] = { x: 40 + (index % 4) * 230, y: 80 + Math.floor(index / 4) * 170 }; });
    state.layouts[orchestration.id] = layout;
    saveJSON(STORAGE.visualLayouts, state.layouts);
    return layout;
  }

  function drawEdges(canvas) {
    const svg = canvas.querySelector('[data-edges]');
    const nodes = [...canvas.querySelectorAll('.aiu6-node')];
    svg.innerHTML = '';
    nodes.forEach((node, index) => {
      const next = nodes[index + 1];
      if (!next) return;
      const a = node.getBoundingClientRect();
      const b = next.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      const x1 = a.left - c.left + a.width;
      const y1 = a.top - c.top + a.height / 2;
      const x2 = b.left - c.left;
      const y2 = b.top - c.top + b.height / 2;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('d', `M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`);
      line.setAttribute('class', 'aiu6-edge');
      svg.appendChild(line);
    });
  }

  function makeNodeDraggable(node, canvas, orchestrationId) {
    let sx = 0, sy = 0, ox = 0, oy = 0;
    node.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      sx = e.clientX; sy = e.clientY; ox = node.offsetLeft; oy = node.offsetTop;
      node.setPointerCapture(e.pointerId);
      const move = ev => {
        node.style.left = `${Math.max(0, ox + ev.clientX - sx)}px`;
        node.style.top = `${Math.max(0, oy + ev.clientY - sy)}px`;
        drawEdges(canvas);
      };
      const up = ev => {
        node.releasePointerCapture(ev.pointerId);
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        state.layouts[orchestrationId] = state.layouts[orchestrationId] || {};
        state.layouts[orchestrationId][node.dataset.nodeId] = { x: node.offsetLeft, y: node.offsetTop };
        saveJSON(STORAGE.visualLayouts, state.layouts);
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
    });
  }

  function openNodeEditor(orchestration, nodeId, afterSave) {
    const step = orchestration.steps.find(s => s.id === nodeId);
    if (!step) return;
    openModal('Edit Visual Node', `
      <label>Label<input data-label value="${escapeHTML(step.label)}"></label>
      <label>Type<select data-type>${['renderDSL','insertPrompt','insertText','captureInput','delay','setVar','appendVar','runWorkflow','exportReport'].map(t => `<option ${step.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Prompt ID<input data-prompt value="${escapeHTML(step.promptId)}"></label>
      <label>Snippet ID<input data-snippet value="${escapeHTML(step.snippetId)}"></label>
      <label>Workflow ID<input data-workflow value="${escapeHTML(step.workflowId)}"></label>
      <label>Variable Name<input data-var value="${escapeHTML(step.varName)}"></label>
      <label>Save Output As<input data-saveas value="${escapeHTML(step.saveAs)}"></label>
      <label>Delay MS<input type="number" data-delay value="${escapeHTML(step.delayMs)}"></label>
      <label><input type="checkbox" data-insert ${step.insert ? 'checked' : ''}> Insert output into editor</label>
      <label>Text / Value<textarea data-text rows="8">${escapeHTML(step.text || step.value)}</textarea></label>
      <button data-save>Save Node</button>
    `, modal => {
      modal.querySelector('[data-save]').onclick = () => {
        step.label = modal.querySelector('[data-label]').value;
        step.type = modal.querySelector('[data-type]').value;
        step.promptId = modal.querySelector('[data-prompt]').value;
        step.snippetId = modal.querySelector('[data-snippet]').value;
        step.workflowId = modal.querySelector('[data-workflow]').value;
        step.varName = modal.querySelector('[data-var]').value;
        step.saveAs = modal.querySelector('[data-saveas]').value;
        step.delayMs = Number(modal.querySelector('[data-delay]').value || 0);
        step.insert = modal.querySelector('[data-insert]').checked;
        step.text = modal.querySelector('[data-text]').value;
        step.value = modal.querySelector('[data-text]').value;
        modal.remove();
        afterSave?.();
      };
    });
  }

  function openJSONEditor(orchestration) {
    openModal('Orchestration JSON Editor', `<textarea data-json rows="22">${escapeHTML(JSON.stringify(orchestration, null, 2))}</textarea><button data-save>Apply JSON</button>`, modal => {
      modal.querySelector('[data-save]').onclick = () => {
        try {
          const next = normalizeOrchestration(JSON.parse(modal.querySelector('[data-json]').value));
          const all = getOrchestrations().filter(item => item.id !== next.id).concat(next);
          setOrchestrations(all);
          modal.remove();
          notify('Orchestration JSON saved.');
        } catch (_) {
          notify('Invalid orchestration JSON.');
        }
      };
    });
  }

  function openGraphViewer() {
    const prompts = getPrompts();
    const snippets = getSnippets();
    const workflows = getWorkflows();
    const orchestrations = getOrchestrations();
    const nodes = [];
    prompts.forEach(p => nodes.push({ id: p.id, type: 'prompt', label: p.title || 'Prompt' }));
    snippets.forEach(s => nodes.push({ id: s.id, type: 'dsl', label: s.title || 'DSL' }));
    workflows.forEach(w => nodes.push({ id: w.id, type: 'workflow', label: w.title || 'Workflow' }));
    orchestrations.forEach(o => nodes.push({ id: o.id, type: 'orchestration', label: o.title || 'Orchestration' }));
    const edges = [];
    workflows.forEach(w => (w.steps || []).forEach(step => { if (step.promptId) edges.push([w.id, step.promptId]); }));
    orchestrations.forEach(o => (o.steps || []).forEach(step => { if (step.promptId) edges.push([o.id, step.promptId]); if (step.snippetId) edges.push([o.id, step.snippetId]); if (step.workflowId) edges.push([o.id, step.workflowId]); }));
    const nodeHtml = nodes.map((n, i) => `<div class="aiu6-graph-node aiu6-${n.type}" style="left:${40 + (i % 5) * 190}px;top:${70 + Math.floor(i / 5) * 130}px" data-id="${n.id}"><strong>${escapeHTML(n.label)}</strong><small>${escapeHTML(n.type)}</small></div>`).join('');
    openModal('Prompt Dependency Graph', `<div class="aiu6-actions"><button data-export>Export Graph JSON</button></div><div class="aiu6-graph" data-graph>${nodeHtml}<svg class="aiu6-edges" data-edges></svg></div>`, modal => {
      modal.querySelector('[data-export]').onclick = () => downloadJSON(`aiu-dependency-graph-${Date.now()}.json`, { nodes, edges });
      drawGraphEdges(modal.querySelector('[data-graph]'), edges);
    });
  }

  function drawGraphEdges(graph, edges) {
    const svg = graph.querySelector('[data-edges]');
    edges.forEach(([from, to]) => {
      const aNode = graph.querySelector(`[data-id="${CSS.escape(from)}"]`);
      const bNode = graph.querySelector(`[data-id="${CSS.escape(to)}"]`);
      if (!aNode || !bNode) return;
      const a = aNode.getBoundingClientRect();
      const b = bNode.getBoundingClientRect();
      const c = graph.getBoundingClientRect();
      const x1 = a.left - c.left + a.width / 2;
      const y1 = a.top - c.top + a.height / 2;
      const x2 = b.left - c.left + b.width / 2;
      const y2 = b.top - c.top + b.height / 2;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1); line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('class', 'aiu6-edge');
      svg.appendChild(line);
    });
  }

  function openMiniWindowManager() {
    const prompts = getPrompts();
    const rows = prompts.map(p => `<div class="aiu6-row"><strong>${escapeHTML(p.title)}</strong><button data-open="${p.id}">Open Mini</button></div>`).join('') || '<p>No prompts found.</p>';
    openModal('Floating Prompt Mini-Windows', `<div class="aiu6-actions"><button data-restore>Restore Saved Windows</button><button data-clear>Clear Saved Windows</button></div>${rows}`, modal => {
      modal.querySelector('[data-restore]').onclick = restoreMiniWindows;
      modal.querySelector('[data-clear]').onclick = () => { state.miniWindows = []; saveJSON(STORAGE.miniWindows, state.miniWindows); document.querySelectorAll('.aiu6-mini').forEach(el => el.remove()); };
      modal.querySelectorAll('[data-open]').forEach(btn => btn.onclick = () => openMiniWindow(prompts.find(p => p.id === btn.dataset.open)));
    });
  }

  function openMiniWindow(prompt) {
    if (!prompt) return;
    const existing = state.miniWindows.find(w => w.promptId === prompt.id) || { id: uid(), promptId: prompt.id, x: 80, y: 80, w: 300, h: 240 };
    const win = document.createElement('div');
    win.className = 'aiu6-mini';
    win.style.left = `${existing.x}px`; win.style.top = `${existing.y}px`; win.style.width = `${existing.w}px`; win.style.height = `${existing.h}px`;
    win.dataset.windowId = existing.id;
    win.innerHTML = `<div class="aiu6-mini-head"><strong>${escapeHTML(prompt.title || 'Prompt')}</strong><button data-insert>Insert</button><button data-close>×</button></div><pre>${escapeHTML(prompt.body || '')}</pre><div class="aiu6-resize"></div>`;
    win.querySelector('[data-insert]').onclick = () => insertIntoEditor(prompt.body || '');
    win.querySelector('[data-close]').onclick = () => { win.remove(); state.miniWindows = state.miniWindows.filter(w => w.id !== existing.id); saveJSON(STORAGE.miniWindows, state.miniWindows); };
    document.body.appendChild(win);
    makeMiniDraggable(win, win.querySelector('.aiu6-mini-head'));
    makeMiniResizable(win, win.querySelector('.aiu6-resize'));
    state.miniWindows = state.miniWindows.filter(w => w.id !== existing.id).concat(existing);
    saveJSON(STORAGE.miniWindows, state.miniWindows);
  }

  function makeMiniDraggable(win, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      sx = e.clientX; sy = e.clientY; ox = win.offsetLeft; oy = win.offsetTop; handle.setPointerCapture(e.pointerId);
      const move = ev => { win.style.left = `${Math.max(0, ox + ev.clientX - sx)}px`; win.style.top = `${Math.max(0, oy + ev.clientY - sy)}px`; };
      const up = ev => { handle.releasePointerCapture(ev.pointerId); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); persistMini(win); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    });
  }

  function makeMiniResizable(win, handle) {
    let sx = 0, sy = 0, ow = 0, oh = 0;
    handle.addEventListener('pointerdown', e => {
      sx = e.clientX; sy = e.clientY; ow = win.offsetWidth; oh = win.offsetHeight; handle.setPointerCapture(e.pointerId);
      const move = ev => { win.style.width = `${Math.max(220, ow + ev.clientX - sx)}px`; win.style.height = `${Math.max(160, oh + ev.clientY - sy)}px`; };
      const up = ev => { handle.releasePointerCapture(ev.pointerId); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); persistMini(win); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    });
  }

  function persistMini(win) {
    const id = win.dataset.windowId;
    const item = state.miniWindows.find(w => w.id === id);
    if (!item) return;
    item.x = win.offsetLeft; item.y = win.offsetTop; item.w = win.offsetWidth; item.h = win.offsetHeight;
    saveJSON(STORAGE.miniWindows, state.miniWindows);
  }

  function restoreMiniWindows() {
    const prompts = getPrompts();
    document.querySelectorAll('.aiu6-mini').forEach(el => el.remove());
    state.miniWindows.forEach(w => openMiniWindow(prompts.find(p => p.id === w.promptId)));
  }

  function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function openBuilderSelector() {
    const orchestrations = getOrchestrations();
    const rows = orchestrations.map(o => `<div class="aiu6-row"><strong>${escapeHTML(o.title)}</strong><span>${(o.steps || []).length} nodes</span><button data-open="${o.id}">Open</button></div>`).join('') || '<p>No orchestrations saved.</p>';
    openModal('Choose Orchestration', `<div class="aiu6-actions"><button data-new>New Visual Orchestration</button></div>${rows}`, modal => {
      modal.querySelector('[data-new]').onclick = () => openVisualBuilder();
      modal.querySelectorAll('[data-open]').forEach(btn => btn.onclick = () => openVisualBuilder(orchestrations.find(o => o.id === btn.dataset.open)));
    });
  }

  function createPanel() {
    if (state.panel) state.panel.remove();
    state.panel = document.createElement('div');
    state.panel.className = 'aiu6-panel';
    state.panel.innerHTML = `
      <strong>AIU Visual</strong>
      <button data-action="builder">Builder</button>
      <button data-action="graph">Graph</button>
      <button data-action="mini">Mini Windows</button>
      <button data-action="restore">Restore Mini</button>
    `;
    state.panel.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'builder') openBuilderSelector();
      if (action === 'graph') openGraphViewer();
      if (action === 'mini') openMiniWindowManager();
      if (action === 'restore') restoreMiniWindows();
    });
    document.body.appendChild(state.panel);
  }

  function injectStyles() {
    GM_addStyle(`
      .aiu6-panel,.aiu6-card,.aiu6-toast,.aiu6-mini{font:13px system-ui,sans-serif;background:#1e1b4b;color:#eef2ff}.aiu6-panel{position:fixed;left:16px;bottom:316px;z-index:999994;border:1px solid #818cf8;border-radius:12px;padding:10px;display:flex;gap:6px;flex-wrap:wrap;max-width:430px;box-shadow:0 12px 30px #0008}.aiu6-panel button,.aiu6-card button,.aiu6-mini button{background:#818cf8;color:#1e1b4b;border:0;border-radius:8px;padding:6px 9px;cursor:pointer}.aiu6-modal{position:fixed;inset:0;z-index:1000009;background:#0008;display:grid;place-items:center}.aiu6-card{width:min(1180px,94vw);max-height:90vh;overflow:auto;border-radius:14px;padding:18px;position:relative;border:1px solid #818cf8}.aiu6-close{position:absolute;right:12px;top:12px}.aiu6-card label{display:grid;gap:4px;margin:10px 0}.aiu6-card input,.aiu6-card textarea,.aiu6-card select{width:100%;box-sizing:border-box;background:#111827;color:#eef2ff;border:1px solid #818cf8;border-radius:8px;padding:8px}.aiu6-actions{display:flex;gap:6px;flex-wrap:wrap}.aiu6-row{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;border-bottom:1px solid #ffffff22;padding:8px 0}.aiu6-toast{position:fixed;left:18px;bottom:398px;z-index:1000010;padding:10px 14px;border-radius:10px;border:1px solid #818cf8}.aiu6-canvas,.aiu6-graph{position:relative;height:620px;min-width:900px;background:#0f172a;border:1px solid #818cf855;border-radius:12px;overflow:auto;margin-top:12px}.aiu6-node,.aiu6-graph-node{position:absolute;width:190px;min-height:92px;background:#312e81;border:1px solid #818cf8;border-radius:12px;padding:10px;box-shadow:0 10px 24px #0008;cursor:grab;z-index:2}.aiu6-node small,.aiu6-graph-node small{display:block;color:#c7d2fe;margin:4px 0}.aiu6-edges{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none}.aiu6-edge{fill:none;stroke:#818cf8;stroke-width:2;opacity:.8}.aiu6-graph .aiu6-edge{stroke:#fbbf24}.aiu6-mini{position:fixed;z-index:999993;border:1px solid #818cf8;border-radius:12px;box-shadow:0 12px 30px #0008;overflow:hidden;resize:none}.aiu6-mini-head{display:flex;align-items:center;gap:6px;justify-content:space-between;background:#312e81;padding:8px;cursor:move}.aiu6-mini pre{white-space:pre-wrap;margin:0;padding:10px;height:calc(100% - 54px);overflow:auto;background:#111827}.aiu6-resize{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;background:#818cf8}
    `);
  }

  function initMenu() {
    GM_registerMenuCommand('AIU Visual: Builder', openBuilderSelector);
    GM_registerMenuCommand('AIU Visual: Dependency Graph', openGraphViewer);
    GM_registerMenuCommand('AIU Visual: Mini Windows', openMiniWindowManager);
    GM_registerMenuCommand('AIU Visual: Restore Mini Windows', restoreMiniWindows);
  }

  function init() {
    injectStyles();
    createPanel();
    initMenu();
  }

  init();
})();
