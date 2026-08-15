# @deepseek-ai/dsh-client-ui-terminal

English | [中文](README.zh.md)

Web embedded-terminal feature plugin: a toggle button in the sidebar's `sidebar.footer.action` seat (above Settings, styled like the Settings foot trigger) opens and closes the docked terminal panel (xterm) in the layout `shell.panel` bottom split. The panel docks below the center/details columns — the sidebar stays full height — follows the current session, streams live output over the `terminal/output` WebSocket downlink, writes keystrokes directly to the host PTY, syncs the PTY grid to the fitted panel on open, copies the selection through Ctrl+Shift+C / Cmd+C or the header copy control, resizes by dragging its top divider, matches the page background, and switches to a light ANSI palette in light theme.

The host half is empty on purpose: the terminal RPC domain lives in the host `apiproxy`, and the terminal object-layer state (`ctx.terminalFeed`) lives in the client `runtime`; this package narrows both into an inject face and renders the page surface through the slot system. One shared terminal store (open state + panel height) drives the toggle and the panel together.

## Model Experience

None, as this package renders a human-facing terminal surface and the model-facing PTY tools belong to `dsh-tool-terminal`.

#### KV Cache effect

None. No model-visible input or output flows through this package.

## Known Limitations and Deferred Work

- **Bottom dock only** — the panel docks below the center/details columns; a right-edge dock beside the details column and a position toggle are deferred.
- **Toggle-off closes the terminal** — collapsing the panel unmounts the xterm and closes the host PTY session; a hidden-but-live panel is deferred.
- **Theme switch while open** — the xterm palette (foreground and ANSI colors) is chosen once at mount, so a theme change needs a re-toggle to take effect.
