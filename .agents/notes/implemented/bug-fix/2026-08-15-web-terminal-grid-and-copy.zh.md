# Agent Note: web terminal syncs its grid and supports selection copy

Status: implemented

[English](2026-08-15-web-terminal-grid-and-copy.md) | 中文

## Problem

内嵌 Web 终端（`@deepseek-ai/dsh-client-ui-terminal`，布局 `shell.panel` 槽位里的 xterm）有两个用户第一次使用就会撞上的缺陷。

**输出错位。** 面板用 `FitAddon.fit()` 把 xterm 表面适配到页面，但宿主 PTY 是按后端默认网格 spawn 的（`terminal-bash` 默认 `cols: 160, rows: 40`）。`TerminalBody` 只从 `ResizeObserver` 里发送 resize，而它的首次回调触发时 `terminalId` 仍是 `null`（`open` RPC 尚未 resolve），所以打开时从未发送过 resize。PTY 的 `COLUMNS` 一直停留在 160，表面却按自己的适配宽度渲染，于是 `ls` 以及任何依赖 `COLUMNS` 的输出都按 160 列排版、再被表面按自身宽度折行——每一行看起来都是乱的。

**无法复制。** xterm 渲染到 canvas，刻意把剪贴板写入留给宿主。`TerminalBody` 既没有 `attachCustomKeyEventHandler`、没有选择监听，也没有复制控件，因此鼠标选中只能高亮、永远无法复制。

## Decision

`TerminalBody` 在 `open` resolve 后立刻把 PTY resize 到已适配的网格，面板则通过共享的 `writeClipboard` 原语接上复制。

- **打开时同步网格。** `face.open` resolve 后（写入 motd 之前），面板调用 `face.resize(sessionId, terminalId, term.cols, term.rows)`。被拒绝的 resize 会被吞掉——终端仍在后端默认网格上保持可用。`ResizeObserver` 路径保持不变，用于后续面板尺寸变化。
- **复制面。** `TerminalBody` 改为 `forwardRef` + `useImperativeHandle`，暴露 `copy()`：读取 `term.getSelection()`，非空时用 `dsh-client-ui-primitives` 的 `writeClipboard` 写入。两个入口驱动它：
  - 一个 `attachCustomKeyEventHandler`，在 `keydown` 上拦截 Ctrl+Shift+C（以及 Cmd+C），调用 `preventDefault` 并复制选中内容，其余按键——包括普通 Ctrl+C（SIGINT）——都交还给 xterm；
  - 标题栏的「复制」按钮，调用同一个 `copy()`，写入被接受后显示「复制成功」一秒。

## Alternatives considered

**只做快捷键。** 否决：只有隐藏快捷键并不能解决「选中了却没法复制」；标题栏按钮与产品既有的复制控件模式一致，且始终可被发现。

**复用 `dsh-client-ui-primitives` 的 `useCopyFeedback`。** 否决：该 hook 不属于包公开客户端 API，且禁止跨包导入另一个客户端插件的内部符号。面板在公开的 `writeClipboard` 之上手写了同样的一秒反馈状态。

**在 `terminal.open` 请求上携带 cols/rows，而不是打开后再 resize。** 否决：wire 的 `open` 请求不携带网格尺寸，后端按配置默认值 spawn；面板本就拥有 `resize` 通道，复用它是最小改动，也把初次适配逻辑保留在一处。

## Consequences

列对齐的终端输出在打开时即对齐，选中内容可通过键盘和按钮复制。复制控件复制的是当前选中内容而非 scrollback；「全部复制」暂缓。标题栏现在有两个控件（复制 + 关闭），归入右对齐的 `.actions` 容器。

## Testing

`packages/client/ui-terminal/tests/terminal-panel.client.spec.tsx` 覆盖了打开时 resize 调用及其被拒绝路径、完整的复制按键路由（非 keydown、非复制键、空选中、Ctrl+Shift+C、Cmd+C）、标题栏按钮的接受/拒绝/空选中路径、二次点击守卫与一秒反馈复位，以及既有的深色主题、`onOutput`、`onReset`、observer 监听路径，使该文件达到逐文件 100% 覆盖率门槛。
