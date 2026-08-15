# @deepseek-ai/dsh-terminal-pwsh

English | [中文](README.zh.md)

Human embedded-terminal backend for `ctx.terminals` over `ctx.subprocess.spawnTerminal` on Windows. It spawns the platform PowerShell (PowerShell 7, then Windows PowerShell 5.1) through the subprocess terminal primitive (node-pty ConPTY), streams raw UTF-8 output — ANSI intact — to the Web GUI's xterm surface, and forwards raw writes, resizes, and whole-tree teardown. The line-oriented, model-facing terminal surface stays POSIX-only (`@deepseek-ai/dsh-terminal-bash`).

## Plugin (`terminal-pwsh`)

The plugin injects `terminals` and `subprocess`, then registers the configured backend type (`pwsh`). An empty `shellPath` resolves the platform PowerShell through `resolvePwshPath`; a non-empty value is trusted as-is, and a resolution that yields nothing fails at load. At spawn the backend opens PowerShell in the caller's cwd (the harness working directory when the caller omits one) with `-NoLogo -NoProfile`, waits up to `startupTimeoutMs` for the shell's first output to use as the open motd, and returns a session whose raw output streams to subscribers. `startSend` and `signal` refuse: the human terminal forwards keystrokes as raw writes (Ctrl+C arrives as `\x03`, which ConPTY translates to the console interrupt), so no POSIX readiness or foreground process-group contract is honored. Close terminates the whole session tree through the subprocess primitive (taskkill on Windows) and awaits quiescence.

## Model Experience

### Indirect consumer

#### What the model sees

Nothing directly. This backend registers no prompt or tool; `@deepseek-ai/dsh-tool-terminal` owns the visible PTY schemas and result text.

#### Token effect

None directly. Live terminal output stays process-local and never enters model history from this package.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix change.

## Known Limitations and Deferred Work

- Raw ANSI is preserved for xterm, so full-screen and color rendering depend on the client's terminal emulator; scrollback replay re-emits the retained raw bytes after a reconnect.
- Line-oriented send and foreground signalling are unsupported: this backend is the human-terminal half only, and the model-facing terminal remains POSIX-only.
- Sessions do not survive harness process exit.
