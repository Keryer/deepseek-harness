# Agent Note: 内嵌 Web 终端

Status: implemented

[English](2026-08-14-embedded-web-terminal.md) | 中文

## Problem

Web GUI 能跑模型会话，但没有给人用的终端。用户想自己跑一条命令时，只能另开一个终端窗口并来回切换，丢掉会话的工作目录和沙箱。已有的 PTY 能力（`ctx.terminals`）是模型所有、面向行的：它的六个工具服务于智能体，不服务于交互打字的人，也没有任何线上接口把它暴露给浏览器。

## Decision

Web GUI 内嵌一个交互式终端：布局所有的 `shell.overlay` 槽里的悬浮切换按钮，打开停靠在布局 `shell.panel` 底部分割里的会话作用域 xterm 面板。用户每个会话开一个终端、直接打字；终端跟随当前会话，所以工作目录和沙箱就是会话的。一个共享的终端 store 同时驱动切换按钮与面板，面板顶部的分割条可调整高度。

这个功能分四层，各自挂在已有的 seam 后面：

### 宿主平面的 PTY 注册表

终端注册表及其本地 shell 后端，从 `minimal` preset 的 `isolate: terminals` realm 迁到 base bundle 的宿主平面，遵循 jobs/goals/skills 的先例：一个宿主实例的 `TerminalSessionService` 按所属 `Agent` 分键，服务所有会话。`dsh-tool-terminal`（六个模型工具）留在 preset 平面。shell 后端按平台区分：非 Windows 上用 `terminal-bash`（POSIX-only），Windows 上用 `terminal-pwsh`（PowerShell，仅限人类终端）——见 [Windows 后端笔记](2026-08-14-windows-terminal-pwsh-backend.md)。

### PTY seam 扩展

seam 增加两个面向行的模型工具用不到的操作：

- `resize(cols, rows)` —— 沿 `SubprocessTerminalHandle` → `TerminalBackendSession`/`TerminalSessionService` → `dsh-terminal-bash` 一路透传，本地走 node-pty 的 `IPty.resize`，远程走 E2B SDK 的 `pty.resize`。
- `write(text)` —— 无就绪等待的原始终端输入，同样透传。这是交互输入路径：面向行的 `startSend` 同一时刻只允许一个 send，快速打字会撞 `SEND_ACTIVE`。
- `onOutput(listener)` —— 新的净化后输出订阅，从后端的 `appendOutput` 通知。

### 终端 RPC 域与输出流

`apiproxy` 增加 `terminal` 域（`open`/`send`/`read`/`write`/`resize`/`signal`/`close`/`list`）外加一个 `stream` 方法。宿主用 `ctx.agents.get(sessionId)` 解析精确 owner，把 `TerminalError` 码映射成 `terminal-unavailable`/`terminal-not-found`/`terminal-busy` 线上错误。全会话的 `terminal/output` 流在打开时重放保留的 scrollback，随后推送实时输出；它走第三条 WebSocket downlink（`/api/events.terminal`），与 mux、host 并列，连接循环要等三条流都打开才算连接建立。注册表缺失时流保持打开但空闲，而不是发 `stream/error`，这样没装 PTY 的部署不会误触发重连循环。

### 客户端对象层与界面

`dsh-client-runtime` 拥有一个 React-free 的 `TerminalFeed`（`ctx.terminalFeed`），把每条 `terminal/output` 帧转发给订阅者，并在每次连接代重建时发重置信号。`dsh-client-ui-terminal` 把线上域和 feed 窄化成一个 inject 面（`open`/`write`/`resize`/`close`/`onOutput`/`onReset`），渲染一个停靠、可缩放的 xterm 界面：`onOutput` → `term.write`，`term.onData` → `write`，`ResizeObserver` → `fit` + `resize`，`onReset` → `term.reset` 并由流重基线保留 scrollback。xterm 画布在页面背景上透明，面板顶部的水平分割条通过共享 store 写入面板高度。

## Alternatives considered

**钻进每个 agent 的 preset realm 拿它的 `terminals` 服务。** 否决。`ctx.get` 读的是全局服务仓库而非入口本地 realm，而宿主平面注册表正是仓库里"网关要够到的按 owner 分键服务"的既定模式（jobs、goals、skills、subagents）。

**轮询 `terminals.read` 取输出。** 否决。轮询增加延迟和负载；后端上的 `onOutput` 订阅是事件驱动契约，也是"模型可见即可日志"规则的自然镜像。

**交互按键复用 `startSend`。** 否决。面向行的 send 同一时刻只允许一个且等待就绪；打字输入会撞 `SEND_ACTIVE`。原始 `write` 让交互输入并发且免就绪。

**面板挂到 `details` 槽。** 否决。`details` 被 ui-conversation 的 DetailsPanel 占用且是另一种界面；面板用可叠加的 `shell.overlay` 列表槽，ui-layout 里专用的底部停靠槽仍是最终归宿。

**用普通 `.css` 导入 xterm 样式。** 否决。client bundle 的 tsdown CSS guard 在没装 `@tsdown/css` 时拒绝非模块 CSS；样式以 `:global` 选择器 vendor 成 `.module.css`，走现成的 CSS-modules 管线编译并注入。

## Consequences

**一个宿主终端注册表服务所有会话。** 把注册表移出按 agent 隔离后，一个按 `Agent` 分键的服务被共享，这让网关既能驱动人类终端也能驱动模型工具。会话不再各自拥有私有注册表实例。

**输出流是"打开时快照"而非"实时订阅"。** 在流快照之后才打开的终端，要等重连才被那条流捕获；客户端先开终端再开流（或重开流）来保持覆盖。

**交互输入需要原始 `write` seam。** 人类终端直接写按键而不是走面向行的 send，所以模型工具的就绪与单 send 语义不受影响。

**xterm 内联进 client bundle。** 终端插件浏览器 bundle 因 xterm 增大约 79 KB gzip，外加 vendor 的样式表。
