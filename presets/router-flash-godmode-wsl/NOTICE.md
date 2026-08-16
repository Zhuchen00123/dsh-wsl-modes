# Source & Attribution

This preset `router-flash-godmode-wsl` is an **adapted** version of:

- https://github.com/SheberDavid/v4-flash-godmode-opencode-go
  - "V4 Flash 神模式 (opencode-go)" — adapted preset for opencode-go's
    `deepseek-v4-flash`.
  - Upstream has **no LICENSE file**; use at your own risk.
- which is based on:
  - https://github.com/yjh051108/dsh-router-standard
  - MIT License, the original task-aware reasoning-mode router for
    DeepSeek Harness.

## Changes made in this copy

1. **Shell**: `tool-bash` is always enabled and `tool-pwsh` is always
   disabled, so Windows hosts use the DSH WSL bash + bubblewrap sandbox
   instead of PowerShell.
2. **Compaction**: uses `dsh-compaction-cacheaware` (Reasonix-style)
   instead of `@deepseek-ai/dsh-compaction-basic`.
3. **Metadata**: renamed to "Router Flash Godmode (WSL)".

## Files

- `agent.cordis.yml` — preset composition (modified)
- `preset.yml` — display metadata (modified)
- `router-bootstrap.mjs` — bootstrap/router plugin (from upstream, unchanged)
- `router-core.mjs` — routing/persona core (from upstream, unchanged)
