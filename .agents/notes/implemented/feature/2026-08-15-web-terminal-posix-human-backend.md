# Agent Note: web terminal serves a raw bash backend on POSIX and supports selection copy

Status: implemented

English | [中文](2026-08-15-web-terminal-posix-human-backend.zh.md)

## Problem

The human embedded terminal (`@deepseek-ai/dsh-client-ui-terminal`, xterm in the `shell.panel` slot) was broken on POSIX in three compounding ways.

- **`name: 'dumb'` was hardcoded.** `LocalSubprocessRuntime.spawnTerminal` always passed `name: 'dumb'` to node-pty, and node-pty's `name` overrides `env.TERM`, so every PTY child saw `TERM=dumb` — including the PowerShell human backend, whose `TERM=xterm-256color` env entry was silently discarded.
- **The human terminal reused the model-facing backend.** On POSIX the only registered backend was `terminal-bash` (type `shell`): `TERM=dumb`, ANSI-stripping sanitizer, and a controlled `dsh> ` prompt with a `PROMPT_COMMAND` marker. The host RPC picked it via `listBackends()[0]`, so the interactive terminal was line-oriented, colorless, and printed `dsh> ` instead of the user's prompt.
- **No copy.** xterm renders to a canvas and leaves clipboard writes to the host; the panel had no key or button to copy a selection, and a mouse selection could not leave the page.

## Decision

- `SubprocessTerminalSpawnSpec` gains an optional `name`, and `spawnTerminal` uses `spec.name ?? 'dumb'`. `terminal-bash` passes `dumb`; `terminal-pwsh` passes `xterm-256color`, restoring its intended `TERM`.
- A new backend `@deepseek-ai/dsh-terminal-bash-human` (type `bash-human`) serves the human terminal on POSIX. It mirrors `terminal-pwsh`: raw UTF-8 passthrough with no sanitizer, `TERM=xterm-256color`, `--noprofile --norc -i`, no controlled prompt, and `startSend`/`signal` refuse the model-facing readiness contract. Close terminates the whole tree.
- The host RPC selects the human backend deterministically: `terminal.open` resolves `request.payload.type ?? backends.find(name => name !== 'shell') ?? backends[0]`, so `shell` (the line-oriented model backend) never serves the human terminal when a raw backend is composed.
- The xterm surface copies a selection through Ctrl+Shift+C / Cmd+C, a header "复制" button, and Ctrl+C when a selection exists (the Windows/VS Code convention); Ctrl+C without a selection keeps its interrupt meaning. The panel also resizes the PTY to the fitted grid once `open` resolves.

## Alternatives considered

**Keep one POSIX backend and give `terminal-bash` a raw "human" config flag.** Rejected: the model-facing session (sanitizer, readiness polling, controlled prompt) and the human session (raw passthrough, no readiness) are different session classes; a flag would branch the whole session lifecycle. A separate backend keeps the model and human roles parallel with the Windows split (`terminal-pwsh`).

**Reuse `terminal-pwsh`'s session class from `terminal-bash-human`.** Rejected: cross-package imports of a sibling plugin's internal symbol are forbidden, and it would make a POSIX package depend on a Windows-only package. The raw session is a ~230-line boilerplate twin, acceptable under the pre-release duplication stance.

**Copy only via a keyboard shortcut.** Rejected: a hidden shortcut alone does not fix "I selected text and nothing let me copy it"; the header button and Ctrl+C-with-selection match the product's copy-control pattern and platform muscle memory.

## Consequences

The POSIX human terminal now renders colors and cursor control as xterm expects, uses the user's shell prompt, and copies selections. The model-facing `terminal-bash` surface is unchanged. Two raw backend twins (`terminal-bash-human`, `terminal-pwsh`) share a mirrored session shape; consolidating them into a shared raw-session package is deferred. The `shell`-type exclusion in `terminal.open` is a hardcoded one-line rule, not a declared "human" capability on the terminal registry.

## Testing

`terminal-bash-human` has `config`, `index`, and `session` suites at the per-file 100% gate (byte/line truncation, transport-failure, teardown, and default-factory paths). `terminal-pwsh` and `terminal-bash` now assert their `name`; the subprocess-local `??` fallback is covered through the real-composition test. The xterm copy routing is pinned in `terminal-panel.client.spec.tsx` (Ctrl+Shift+C, Cmd+C, Ctrl+C-with/without selection, header button, refused write, feedback reset).
