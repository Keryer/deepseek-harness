# Agent Note: Windows PowerShell PTY backend for the human terminal

Status: implemented

English | [中文](2026-08-14-windows-terminal-pwsh-backend.zh.md)

## Problem

The embedded web terminal ([2026-08-14](2026-08-14-embedded-web-terminal.md)) ships a single shell backend: `dsh-terminal-bash`, disabled on Windows like `tool-bash`. On win32 the human terminal therefore renders `terminal-unavailable` (`no PTY backend registered`) and cannot open. Two layers are POSIX-only: the backend row is disabled, and even if loaded, `subprocess-local`'s `createProcessInspector()` throws `unsupported on platform win32`, so no terminal process can spawn.

## Decision

Add a Windows-only PowerShell backend and make the local subprocess terminal primitive spawnable on win32. The human terminal (not the model-facing `dsh-tool-terminal`, which stays POSIX-only) is the only consumer.

### Windows subprocess terminal support

`subprocess-local` gains a `WindowsProcessInspector` and a win32 branch in `createProcessInspector()`. Windows has no POSIX process groups or `/proc` stdin-wait evidence, so inspection reduces to the shell pid as its own foreground, `isStdinWaiting` returns `false`, and `processTree`/`processSession` return empty (tree teardown is `taskkill /T /F`, not per-descendant signalling). `LocalTerminalHandle` takes a `platform` and `taskkill` and, on win32, takes the whole tree through `taskkill /T /F` in `closeOnce` and `terminateForHostExit`, mirroring the ordinary `spawn()` Windows path.

### `dsh-terminal-pwsh` backend

A new host-plane package registers a `pwsh` backend under `ctx.terminals` (inject `terminals` + `subprocess`). It resolves the platform PowerShell (`resolvePwshPath`: PowerShell 7, then Windows PowerShell 5.1), spawns it with `-NoLogo -NoProfile` in the caller's cwd through `spawnTerminal` (node-pty ConPTY), and captures the shell's first output as the open motd within `startupTimeoutMs`. Output is streamed raw — ANSI intact — because the only consumer is xterm, which renders color and cursor control itself. `startSend` and `signal` refuse: the human terminal writes keystrokes raw (Ctrl+C arrives as `\x03`, which ConPTY maps to the console interrupt), so no POSIX readiness or foreground process-group contract is honored.

### Bundle wiring

The base bundle mounts `terminal-pwsh` on win32 and `terminal-bash` elsewhere, one shell backend per platform under distinct registry types (`pwsh` vs `shell`), so the host `open` resolves `listBackends()[0]` without ambiguity.

## Alternatives considered

**Make `terminal-bash` cross-platform.** Rejected. Its readiness (bash `PS1`/`PROMPT_COMMAND` markers, foreground-pgid, Linux stdin-wait syscall probes) and sandbox-confined argv are POSIX-specific; forcing PowerShell into them would fake readiness and reuse the wrong confinement story.

**Reuse the POSIX `ProcessInspector` on win32.** Rejected. Process groups, `/proc` syscall evidence, and `kill(-pgid)` do not exist on Windows; the ordinary `spawn()` path already uses `taskkill /T /F` there, so the terminal path mirrors it.

**Implement model-facing line-oriented pwsh readiness.** Deferred. The `tool-terminal`/`tool-bash-persistent` surface stays POSIX-only; a Windows persistent-shell tool with prompt detection is the remaining roadmap item, not required for the human terminal.

## Consequences

**The human terminal opens and accepts input on Windows.** Its backend is `pwsh` (PowerShell), separate from the POSIX `shell` (bash) backend; the model-facing terminal tools remain unavailable on win32.

**Raw ANSI output is preserved.** Unlike `terminal-bash`, which sanitizes output for the line-oriented model view, `terminal-pwsh` passes raw bytes to xterm. Full-screen and color rendering therefore work in the human terminal on Windows but not in the POSIX backend, which still serves the sanitized model-facing stream.

**Windows tree teardown is taskkill-based.** No per-descendant enumeration or PID-reuse identities; the shell's exit callback is the quiescence boundary, matching the ordinary subprocess seam's Windows stance.
