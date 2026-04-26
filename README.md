# AI Unleashed

AI Unleashed is a modular userscript platform for `chatgpt.com`, `chat.openai.com`, and `claude.ai`.

It started as a scaffold reconstruction and is now split into layered userscript modules. Install only the layers you need.

## Modules

| Layer | File | Purpose |
|---|---|---|
| Agent 1/2 Core | `ai-unleashed.user.js` | Core prompt store, placeholders, AI enhancement hook, panel UI, autocomplete, pins |
| Agent 3 | `ai-unleashed.agent3-extension.user.js` | Workflows, prompt versioning, duplicate detection, advanced import/export, audit log |
| Agent 4 | `ai-unleashed.agent4-dsl.user.js` | Programmable prompt DSL with variables, conditionals, loops, transforms, snippets |
| Agent 5 | `ai-unleashed.agent5-orchestrator.user.js` | Orchestration engine connecting prompts, DSL, workflows, and variables |
| Agent 6 | `ai-unleashed.agent6-visual-builder.user.js` | Visual node builder, dependency graph, floating prompt mini-windows |
| Agent 7 | `ai-unleashed.agent7-persistence-performance.user.js` | IndexedDB search, snapshots, rollback, queue system |
| Agent 8 | `ai-unleashed.agent8-reactive-ai.user.js` | AI response capture, structured extraction, reactive rules |
| Agent 9 | `ai-unleashed.agent9-sync-packaging.user.js` | Sync bundle export/import, conflict detection, latest-wins merge |

## Recommended Install Order

1. Install `ai-unleashed.user.js` first.
2. Reload ChatGPT or Claude.
3. Install optional modules in numerical order.
4. Reload again after installing multiple layers.

## Quick Start

1. Open a supported site.
2. Use the floating AI Unleashed panels.
3. Create prompts in the core panel.
4. Use `#keyword` in the editor to trigger prompt autocomplete.
5. Use Agent 3+ modules for workflows, DSL, visual graphs, search, and sync.

## Data Storage

AI Unleashed uses browser userscript storage and IndexedDB:

- `GM_getValue` / `GM_setValue` for source-of-truth records
- IndexedDB for pins, search indexes, snapshots, and queue mirrors

Important storage keys:

```text
ai-unleashed:prompts
ai-unleashed:settings
ai-unleashed:ui
ai-unleashed:workflows
ai-unleashed:dslSnippets
ai-unleashed:orchestrations
ai-unleashed:snapshots
ai-unleashed:capturedResponses
```

## Security Notes

- The DSL does not use JavaScript `eval`.
- API keys are stored in userscript manager storage if configured.
- Sync bundles can contain private prompt content. Treat exported JSON as sensitive.
- Reactive rules can insert text automatically; review rules before enabling broad triggers.

## Current Limitations

- Modules are additive and not yet merged into a single optimized build.
- There is no automated test harness yet.
- DOM selectors may need maintenance when ChatGPT or Claude changes UI.
- Gist sync exists in core, but Agent 9 sync bundles are file/manual based.

## Stabilization Roadmap

1. Add validation checklist.
2. Add smoke-test scenarios.
3. Add module compatibility matrix.
4. Merge modules into one production build after testing.
5. Create release ZIP with docs and scripts.
