# Source & Attribution

This preset `router-standard-wsl` is an **adapted** version of:

- https://github.com/yjh051108/dsh-router-standard
  - MIT License, the original task-aware reasoning-mode router for
    DeepSeek Harness.

## Changes made in this copy

1. **Shell**: `tool-bash` is always enabled and `tool-pwsh` is always
   disabled, so Windows hosts use the DSH WSL bash + bubblewrap sandbox
   instead of PowerShell.
2. **Flash-only**: `isFlashModel` always returns `true` and the weak persona
   is always `WEAK_FLASH` — no Pro routing.
3. **Dynamic first-turn injection fixed**: listens to `agent/inbox/claimed`
   (before `system-prompt/assemble`) to capture the real first user message;
   near-field guidance moved from `session/event` to `agent/inbox/inserted`.
4. **First-round purity**: skill-catalog / agent-instructions injections are
   stripped during bootstrap.
5. **Path convention** is injected only after promotion (not in the first
   round).
6. **Runtime contexts preserved** after promotion (`contexts:
   assembled.contexts` instead of `[]`).
7. **`dev_mode_subagent`** uses a larger output budget and falls back to the
   reasoning tail when opencode-go puts the answer in `reasoning_content`.
8. **Tests fixed**: `router.test.mjs` import paths repaired and adapted to
   Flash-only; 14 tests pass.

## Files

- `agent.cordis.yml` — preset composition (modified)
- `preset.yml` — display metadata (modified)
- `router-bootstrap-v1.mjs` — router bootstrap (modified)
- `router-core.mjs` — routing/persona core (modified)
- `router.test.mjs` — fixed tests

## Related research

The original author's paper and correction are summarized in
[`docs/router-standard-paper-notes.md`](../../docs/router-standard-paper-notes.md).
