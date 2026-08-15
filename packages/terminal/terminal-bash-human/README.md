# @deepseek-ai/dsh-terminal-bash-human

English | [中文](README.zh.md)

Human embedded-terminal backend for `ctx.terminals` over `ctx.subprocess.spawnTerminal` on POSIX. It spawns `/bin/bash` through the subprocess terminal primitive (node-pty), streams raw UTF-8 output — ANSI intact — to the Web GUI's xterm surface, and forwards raw writes, resizes, and whole-tree teardown. The line-oriented, model-facing terminal surface stays on the sibling `@deepseek-ai/dsh-terminal-bash` backend (type `shell`), whose sanitized `TERM=dumb` output and controlled prompt do not suit an interactive human terminal.

## Plugin (`terminal-bash-human`)

The plugin injects `terminals` and `subprocess`, then registers the configured backend type (`bash-human`). At spawn the backend opens `shellPath` (`/bin/bash`) in the caller's cwd (the harness working directory when the caller omits one) with `shellArgs` (`-i`, so `.bashrc` sources the user's aliases, `LS_COLORS`, and prompt), waits up to `startupTimeoutMs` for the shell's first output to use as the open motd, and returns a session whose raw output streams to subscribers. `startSend` and `signal` refuse: the human terminal forwards keystrokes as raw writes (Ctrl+C arrives as `\x03`, which the PTY line discipline translates to the foreground interrupt), so no POSIX readiness or foreground process-group contract is honored. Close terminates the whole session tree through the subprocess primitive and awaits quiescence.

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
- Line-oriented send and foreground signalling are unsupported: this backend is the human-terminal half only, and the model-facing terminal stays on `terminal-bash`.
- The shell sources `.bashrc` (not the login profile), so startup output and colors follow the user's own `.bashrc`; a login-only setup (`~/.profile`) is not read unless sourced explicitly.
- Sessions do not survive harness process exit.
