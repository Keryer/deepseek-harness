# Agent Note: web terminal syncs its grid and supports selection copy

Status: implemented

English | [中文](2026-08-15-web-terminal-grid-and-copy.zh.md)

## Problem

The embedded web terminal (`@deepseek-ai/dsh-client-ui-terminal`, xterm in the layout `shell.panel` slot) had two defects a user hits on first use.

**Misaligned output.** The panel fits the xterm surface to the page with `FitAddon.fit()`, but the host PTY was spawned on the backend's default grid (`terminal-bash` defaults to `cols: 160, rows: 40`). `TerminalBody` only sent a resize from its `ResizeObserver`, whose first callback fires while `terminalId` is still `null` (the `open` RPC has not resolved), so no resize was ever sent on open. The PTY's `COLUMNS` stayed at 160 while the surface rendered at its fitted width, so `ls` and any COLUMNS-aware output formatted for 160 columns and the surface folded it at its own width — every line looked scrambled.

**No copy.** xterm renders to a canvas and deliberately leaves clipboard writes to the host. `TerminalBody` had no `attachCustomKeyEventHandler`, no selection listener, and no copy control, so a mouse selection could be highlighted but never copied.

## Decision

`TerminalBody` resizes the PTY to the fitted grid as soon as `open` resolves, and the panel wires copy through the shared `writeClipboard` primitive.

- **Grid sync on open.** After `face.open` resolves (and before the motd is written), the panel calls `face.resize(sessionId, terminalId, term.cols, term.rows)`. A rejected resize is swallowed — the terminal stays usable on the backend default grid. The `ResizeObserver` path is unchanged for later panel resizes.
- **Copy surface.** `TerminalBody` is now `forwardRef` + `useImperativeHandle`, exposing a `copy()` that reads `term.getSelection()` and, for a non-empty selection, writes it with `writeClipboard` from `dsh-client-ui-primitives`. Two entry points drive it:
  - a `attachCustomKeyEventHandler` that intercepts Ctrl+Shift+C (and Cmd+C) on `keydown`, calls `preventDefault`, and copies the selection, while leaving every other key — including plain Ctrl+C (SIGINT) — to xterm;
  - a header "复制" button that calls the same `copy()` and shows "复制成功" for one second after an accepted write.

## Alternatives considered

**Keyboard shortcut only.** Rejected: a hidden shortcut alone does not fix "I selected text and nothing let me copy it"; the header button mirrors the product's existing copy-control pattern and stays discoverable.

**Reuse `useCopyFeedback` from `dsh-client-ui-primitives`.** Rejected: that hook is not part of the package's public client API, and importing another client plugin's internal symbol is forbidden. The panel hand-rolls the same one-second feedback state over the public `writeClipboard`.

**Carry cols/rows on the `terminal.open` request instead of resizing after open.** Rejected: the wire `open` request carries no grid size and the backend spawns on its config defaults; the panel already owns a `resize` channel, so reusing it is the minimal change that also keeps the initial-fit logic in one place.

## Consequences

Column-aligned terminal output now lines up on open, and a selection is copyable by keyboard and button. The copy control copies the current selection, not the scrollback; a "copy all" affordance is deferred. The header now has two controls (copy + close), grouped in a right-aligned `.actions` container.

## Testing

`packages/client/ui-terminal/tests/terminal-panel.client.spec.tsx` covers the resize-on-open call and its refused path, the full copy-key routing (non-keydown, non-copy, empty-selection, Ctrl+Shift+C, Cmd+C), the header button's accepted/refused/empty-selection paths, the second-click guard and the one-second feedback reset, plus the existing dark-theme, `onOutput`, `onReset`, and observer listener paths so the file sits at the per-file 100% coverage gate.
