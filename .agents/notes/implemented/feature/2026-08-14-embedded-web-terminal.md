# Agent Note: embedded web terminal

Status: implemented

English | [中文](2026-08-14-embedded-web-terminal.zh.md)

## Problem

The web GUI runs model sessions but has no human-facing terminal. A user who wants to run a command themselves must open a separate terminal window and switch contexts, losing the session's working directory and sandbox. The existing PTY capability (`ctx.terminals`) is model-owned and line-oriented: its six tools serve the agent, not a person typing interactively, and no wire surface exposes it to the browser.

## Decision

The web GUI ships an embedded interactive terminal: a floating toggle button in the layout-owned `shell.overlay` slot opens a session-scoped xterm panel docked in the layout `shell.panel` bottom split. A person opens one terminal per session and types directly into it; the terminal follows the current session, so its working directory and sandbox are the session's. A shared terminal store drives the toggle and the panel, and the panel's top divider resizes its height.

The feature spans four layers, each behind an existing seam:

### Host-plane PTY registry

The terminal registry and its local shell backend move from the `minimal` preset's `isolate: terminals` realm into the base bundle host plane, following the jobs/goals/skills precedent: one host instance of `TerminalSessionService`, keyed by owning `Agent`, serves every session. `dsh-tool-terminal` (the six model tools) stays preset-plane. The shell backend is per-platform: `terminal-bash` (POSIX-only) elsewhere, `terminal-pwsh` (PowerShell, human-terminal only) on Windows — see the [Windows backend note](2026-08-14-windows-terminal-pwsh-backend.md).

### PTY seam extensions

The seam gains two operations the model-facing line-oriented tools do not need:

- `resize(cols, rows)` — threaded `SubprocessTerminalHandle` → `TerminalBackendSession`/`TerminalSessionService` → `dsh-terminal-bash`, over node-pty's `IPty.resize` locally and the E2B SDK's `pty.resize` remotely.
- `write(text)` — raw terminal input with no readiness wait, threaded the same way. This is the interactive-input path: the line-oriented `startSend` is one-active-send and would reject fast typing with `SEND_ACTIVE`.
- `onOutput(listener)` — new sanitized-output subscription, notified from the backend's `appendOutput`.

### Terminal RPC domain and output stream

`apiproxy` gains a `terminal` domain (`open`/`send`/`read`/`write`/`resize`/`signal`/`close`/`list`) plus a `stream` method. The host resolves the exact owner with `ctx.agents.get(sessionId)` and maps `TerminalError` codes to `terminal-unavailable`/`terminal-not-found`/`terminal-busy` wire errors. The all-session `terminal/output` stream replays retained scrollback on open and then pushes live output; it rides a third WebSocket downlink (`/api/events.terminal`) beside mux and host, and the connection loop opens all three before declaring a generation connected. When the registry is absent the stream stays open but idle rather than emitting `stream/error`, so a deployment without PTY never trips the reconnect loop.

### Client object layer and surface

`dsh-client-runtime` owns a React-free `TerminalFeed` (`ctx.terminalFeed`) that fans each `terminal/output` frame to subscribers and emits a reset signal on every re-established connection generation. The `dsh-client-ui-terminal` narrows the wire domain and the feed into an inject face (`open`/`write`/`resize`/`close`/`onOutput`/`onReset`) and renders a docked, resizable xterm surface: `onOutput` → `term.write`, `term.onData` → `write`, a `ResizeObserver` → `fit` + `resize`, and `onReset` → `term.reset` with the stream re-baselining retained scrollback. The xterm canvas is transparent over the page background, and a horizontal drag divider on the panel's top edge writes the panel height through the shared store.

## Alternatives considered

**Reach into each agent's preset realm for its `terminals` service.** Rejected. `ctx.get` reads the global service store, not an entry-local realm, and the host-plane registry is the repository's established pattern for owner-keyed services the gateway must reach (jobs, goals, skills, subagents).

**Poll `terminals.read` for output.** Rejected. Polling adds latency and load; an `onOutput` subscription on the backend is the event-driven contract and the natural mirror of the "model-visible means logged" rule.

**Reuse `startSend` for interactive keystrokes.** Rejected. The line-oriented send is one-active-send and waits for readiness; typed input would collide with `SEND_ACTIVE`. A raw `write` keeps interactive input concurrent and readiness-free.

**Mount the panel in the `details` slot.** Rejected. `details` is occupied by ui-conversation's DetailsPanel and is a different surface; the panel uses the additive `shell.overlay` list slot, and a dedicated bottom-docked slot in `ui-layout` remains the eventual home.

**Ship xterm's CSS via a plain `.css` import.** Rejected. The client bundle's tsdown CSS guard rejects non-module CSS without `@tsdown/css`; the stylesheet is vendored as a `.module.css` with `:global` selectors so the existing CSS-modules pipeline compiles and injects it.

## Consequences

**One host terminal registry serves every session.** Moving the registry out of per-agent isolation shares one service keyed by owning `Agent`, which is what lets the gateway drive a human terminal and the model tools at once. Sessions no longer own a private registry instance.

**The output stream is baseline-at-open, not live-subscribe.** A terminal opened after the stream snapshot is not captured by that stream until reconnect; the client opens the terminal before the stream (or re-opens the stream) to stay covered.

**Interactive input needs the raw `write` seam.** The human terminal writes keystrokes directly rather than through the line-oriented send, so the model tools' readiness and one-send semantics are untouched.

**xterm is inlined into the client bundle.** The terminal plugin's browser bundle grows by xterm (about 79 KB gzip) plus the vendored stylesheet.
