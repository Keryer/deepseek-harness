# Agent Note：面向人类终端的 Windows PowerShell PTY 后端

状态：已实现

[English](2026-08-14-windows-terminal-pwsh-backend.md) | 中文

## 问题

内嵌 Web 终端（[2026-08-14](2026-08-14-embedded-web-terminal.md)）只带一个 shell 后端：`dsh-terminal-bash`，与 `tool-bash` 一样在 Windows 上被禁用。因此在 win32 上，人类终端只会渲染 `terminal-unavailable`（`no PTY backend registered`），无法打开。有两层是 POSIX-only：后端行被禁用，而且即使加载，`subprocess-local` 的 `createProcessInspector()` 也会抛出 `unsupported on platform win32`，导致任何终端进程都无法启动。

## 决策

新增一个仅限 Windows 的 PowerShell 后端，并让本地 subprocess 终端原语可在 win32 上启动。唯一消费方是人类终端（面向模型的 `dsh-tool-terminal` 仍为 POSIX-only）。

### Windows subprocess 终端支持

`subprocess-local` 新增 `WindowsProcessInspector`，并在 `createProcessInspector()` 中加入 win32 分支。Windows 没有 POSIX 进程组，也没有 `/proc` 的 stdin 等待证据，因此检查退化为：以 shell pid 作为自身前台、`isStdinWaiting` 返回 `false`、`processTree`/`processSession` 返回空（整树清理由 `taskkill /T /F` 负责，而非逐后代发信号）。`LocalTerminalHandle` 增加 `platform` 与 `taskkill`，在 win32 上通过 `closeOnce` 与 `terminateForHostExit` 里的 `taskkill /T /F` 清理整树，与普通 `spawn()` 的 Windows 路径保持一致。

### `dsh-terminal-pwsh` 后端

新增的宿主平面包在 `ctx.terminals` 下注册 `pwsh` 后端（注入 `terminals` + `subprocess`）。它解析平台 PowerShell（`resolvePwshPath`：先 PowerShell 7，再 Windows PowerShell 5.1），以 `-NoLogo -NoProfile` 在调用方 cwd 中通过 `spawnTerminal`（node-pty ConPTY）启动，并在 `startupTimeoutMs` 内捕获 shell 首段输出作为打开时的 motd。输出以原始字节流式传出——保留 ANSI——因为唯一消费方是 xterm，它自己渲染颜色与光标控制。`startSend` 与 `signal` 会拒绝：人类终端以原始方式写入按键（Ctrl+C 以 `\x03` 到达，由 ConPTY 映射为控制台中断），因此无需遵循 POSIX 就绪或前台进程组约定。

### Bundle 接线

基础 bundle 在 win32 上挂载 `terminal-pwsh`，在其他平台挂载 `terminal-bash`；每个平台只挂载一个 shell 后端，且注册类型不同（`pwsh` 与 `shell`），使宿主 `open` 对 `listBackends()[0]` 的解析没有歧义。

## 考虑过的替代方案

**让 `terminal-bash` 跨平台。** 拒绝。它的就绪机制（bash 的 `PS1`/`PROMPT_COMMAND` 标记、前台 pgid、Linux stdin 等待系统调用探测）与沙箱限定 argv 都是 POSIX 专属；把 PowerShell 塞进去只会伪造就绪，并复用错误的限定方案。

**在 win32 上复用 POSIX `ProcessInspector`。** 拒绝。Windows 上不存在进程组、`/proc` 系统调用证据和 `kill(-pgid)`；普通 `spawn()` 路径在那里已经使用 `taskkill /T /F`，终端路径据此保持一致。

**实现面向模型的逐行 pwsh 就绪。** 暂缓。`tool-terminal`/`tool-bash-persistent` 界面仍为 POSIX-only；带提示符检测的 Windows 持久 shell 工具是剩余的路线图事项，而非人类终端所必需。

## 后果

**人类终端可在 Windows 上打开并接受输入。** 其后端是 `pwsh`（PowerShell），与 POSIX 的 `shell`（bash）后端分离；面向模型的终端工具在 win32 上仍不可用。

**保留原始 ANSI 输出。** 与为逐行模型视图清洗输出的 `terminal-bash` 不同，`terminal-pwsh` 把原始字节直接交给 xterm。因此全屏与彩色渲染在 Windows 的人类终端中可用，但在仍提供清洗后模型面向流的 POSIX 后端中不可用。

**Windows 整树清理基于 taskkill。** 没有逐后代枚举或 PID 复用身份；shell 的退出回调是静默边界，与普通 subprocess 缝的 Windows 立场一致。
