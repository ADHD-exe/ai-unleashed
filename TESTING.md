# AI Unleashed Testing Guide

This guide validates the modular AI Unleashed userscript platform after installing the core script and optional Agent modules.

## Test Environment

Supported targets:

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`
- `https://claude.ai/*`

Recommended userscript managers:

- Tampermonkey
- Violentmonkey

## Install Order Smoke Test

Install in this order:

1. `ai-unleashed.user.js`
2. `ai-unleashed.agent3-extension.user.js`
3. `ai-unleashed.agent4-dsl.user.js`
4. `ai-unleashed.agent5-orchestrator.user.js`
5. `ai-unleashed.agent6-visual-builder.user.js`
6. `ai-unleashed.agent7-persistence-performance.user.js`
7. `ai-unleashed.agent8-reactive-ai.user.js`
8. `ai-unleashed.agent9-sync-packaging.user.js`
9. `ai-unleashed.agent10-hardening.user.js`

Reload the page after installing the core script and again after installing extensions.

## Core Smoke Tests

### Prompt Lifecycle

1. Open AI Unleashed core panel.
2. Create a new prompt.
3. Save it.
4. Reopen Prompt Explorer.
5. Insert the prompt into the editor.

Expected result: prompt text appears in the ChatGPT/Claude input box.

### Placeholder Resolution

Create a prompt containing:

```text
Hello {{ name:Rabbit }}. Build a {{ thing:userscript }}.
```

Insert it.

Expected result: browser prompt dialogs request placeholder values, then rendered text is inserted.

### Autocomplete

1. Create a prompt with title `Code Review` and tag `review`.
2. Type `#rev` in the editor.

Expected result: autocomplete menu shows matching prompt.

## Agent 3 Tests

### Version Snapshot

1. Open Agent 3 panel.
2. Open Versions.
3. Snapshot a prompt.
4. Open History.
5. Restore it.

Expected result: restored prompt replaces current prompt content.

### Duplicate Detection

1. Create two prompts with identical title and body.
2. Open Duplicates.

Expected result: duplicate appears and can be removed.

## Agent 4 DSL Tests

Open DSL Playground and render:

```text
Write a {{ vars.tone|lower }} explanation about {{ vars.topic }}.

{% if vars.audience == "developer" %}
Include implementation details.
{% else %}
Keep it beginner friendly.
{% endif %}

{% each vars.points as point %}
- {{ point|trim }}
{% endeach %}
```

Variables:

```text
topic=AI Unleashed
tone=Technical
audience=developer
points=prompts, workflows, exports
```

Expected result: rendered output includes developer details and three bullet points.

## Agent 5 Orchestrator Tests

1. Open Orchestrator Manager.
2. Seed demo orchestration.
3. Run dry run.
4. Inspect report.
5. Run normally.

Expected result: dry run creates report without editor insertion; normal run inserts generated text.

## Agent 6 Visual Tests

1. Open Visual Builder.
2. Create visual orchestration.
3. Add two nodes.
4. Drag nodes.
5. Save orchestration.
6. Reopen builder.

Expected result: node positions persist.

## Agent 7 Persistence Tests

### Search Index

1. Open AIU Perf panel.
2. Reindex.
3. Search for a known prompt title.

Expected result: prompt appears in ranked results.

### Snapshot Restore

1. Create snapshot.
2. Change a prompt.
3. Restore snapshot.
4. Reload page.

Expected result: previous data state returns.

## Agent 8 Reactive Tests

1. Open Reactive settings.
2. Enable auto-capture.
3. Generate an assistant response.
4. Open Captured Responses.

Expected result: assistant response appears once and is deduplicated.

## Agent 9 Sync Tests

1. Export sync bundle.
2. Import same bundle.

Expected result: no destructive changes; merge succeeds.

## Agent 10 Hardening Tests

1. Open AIU Hardening.
2. Run Diagnose.
3. Run Migrate.
4. Run Diagnose again.

Expected result: missing IDs/legacy fields are normalized; diagnostics produce report.

## Failure Tests

### Invalid DSL

Use:

```text
{% if vars.x == "yes" %}
missing endif
```

Expected result: validation reports unclosed `if`.

### Missing References

Create orchestration step with missing `promptId`.

Expected result: hardening diagnostics warns about missing reference.

### Large Data

Create a very large prompt.

Expected result: hardening migration truncates according to configured limits.

## Known Risks

- ChatGPT/Claude DOM selector changes may break editor detection or response capture.
- Multiple floating panels may overlap on small screens.
- Full production merge build is not yet generated.
