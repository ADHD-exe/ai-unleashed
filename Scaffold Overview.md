— **3,166 lines**, **28 sections**, **22 `TODO` markers**.

---

## Scaffold Overview

### What's fully implemented (Phase 1 — working code)

| Section | What's in it |
|---|---|
| §1 Guard | `window.__unleashedPromptV1` double-load prevention |
| §2 Constants | All `KEYS`, `PENDING_PROMPT_KEY`, IDB names, timing constants |
| §3 State | `UIState`, `PromptState`, `ThemeState`, `NavState`, `AIState` — all namespaced |
| §4 Utilities | `sanitizeHexColor`, `clampNumber`, `sanitizeFontFamily`, `escapeHtml`, `el()` DOM builder, `waitFor`, `robustClick`, `makeDebounce`, `sleep`, `Store` (GM async cache wrapper) |
| §5 Platform adapters | `detectPlatform()`, full `ADAPTERS.chatgpt` (score-based composer detection + multi-strategy React insertion), `ADAPTERS.claude` |
| §6 Theming | Two-tag CSS strategy (structural written once, theme-vars rewritten only), all 14 preset themes (A's 9 + B's 5), `normalizeSettings()`, `applyBodyClasses()`, `applyPreset()` |
| §7 Prompt store | Full merged schema, `normalizePrompt`, `loadPrompts`, `savePrompts`, `addPrompt`, `updatePrompt`, `removePrompt`, `recordPromptUse`, `getFilteredPrompts` with all sort modes |
| §8 Insertion engine | `robustClearEditor`, `moveCursorToEnd`, full `insertPromptIntoComposer` pipeline |
| §9 Placeholder system | `hasPlaceholders`, `parsePlaceholders`, `fillPlaceholders`, `openPlaceholderModal` — full `[input]`, `##select{}`, `#file[]` support |
| §10 AI Enhancement | Provider routing for Gemini/OpenRouter/Groq, model string validation, `callAI_API`, Quick Enhance (composer-based), **AI Enhance with full diff modal** (Phase 1 elevated per your instruction) |
| §11 Inline suggest | Full `#` autocomplete — input handler, keyboard nav (arrows/enter/tab/esc), menu render, highlight |
| §12 Chat management | Current chat Markdown export, **Bulk export/delete modal** (Phase 1 elevated), sidebar item discovery, `bulkDeleteChats`, `deleteChatFromSidebarItem`, quick-delete 🗑 buttons, `startNewChatWithPrompt` / pending prompt via sessionStorage |
| §13 IndexedDB | `openPinDB`, `loadPinsFromDB`, `savePinsToDB` |
| §17 Shortcuts | `loadShortcuts`, `isShortcutPressed`, 8 default actions |
| §18 Update checker | Self-contained `fetch()`-based checker, `semverGt`, raw.githubusercontent.com domain lock |
| §19 Shared UI | `showNotification` (toast), `createDialogo` (alert/confirm), `createCustomTooltip`, `downloadTextFile` |
| §20 Floating panel | 7-page panel, drag, launcher, all page renderers (Home, Themes, Layout stub, Font stub, Prompts, Settings with AI config + import/export, UI-Theme stub) |
| §21 Toolbar pill | Two-half pill (Enhance + Prompts), `refreshPromptMenu`, search, sort, right-click-to-edit, settings link |
| §22 Modals | Full prompt editor modal (create/edit/delete, all fields + toggles) |
| §23 DOM watcher | `observeDom` with pause/resume, `refreshAllStyling`, score-based bubble class injection, `checkComposerPresence`, `history.pushState` interception (replaces `setInterval`) |
| §24–28 | GM menu commands (7), settings load/save debounced, global keyboard handler, self-heal timer (1200ms), `init()` with parallel `Promise.all` loads |

### Phase 2 stubs (wired into init, safe no-ops for now)
`createNavInterface()` · `initGistIntegration()` · `exportAllData()` · Layout/Font/UI-Theme panel pages · `openPromptExplorerModal()` · Smart editor brackets/macros

### TODO markers (22 total)
Each is tagged `// TODO(§N):` pointing to the exact section where the implementation belongs, with a description of what goes there.
