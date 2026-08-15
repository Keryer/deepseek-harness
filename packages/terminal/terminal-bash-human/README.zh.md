# @deepseek-ai/dsh-terminal-bash-human

[English](README.md) | 中文

这是面向 POSIX、基于 `ctx.subprocess.spawnTerminal` 的 `ctx.terminals` 人类内嵌终端后端。它通过 subprocess 终端原语（node-pty）启动 `/bin/bash`，将原始 UTF-8 输出——保留 ANSI——流式传给 Web GUI 的 xterm 界面，并转发原始写入、resize 和整树清理。逐行、面向模型的终端界面仍留在同族 `@deepseek-ai/dsh-terminal-bash` 后端（类型 `shell`）上，其被净化的 `TERM=dumb` 输出与受控提示符不适合交互式人类终端。

## 插件（`terminal-bash-human`）

该插件注入 `terminals` 和 `subprocess`，然后注册所配置的后端类型（`bash-human`）。spawn 时，后端在调用方 cwd（调用方省略时为 harness 工作目录）中以 `shellArgs`（`--noprofile --norc -i`）打开 `shellPath`（`/bin/bash`），最多等待 `startupTimeoutMs` 取得 shell 的首段输出作为打开时的 motd，并返回一个将原始输出流式传给订阅方的会话。`startSend` 与 `signal` 会拒绝：人类终端把按键作为原始写入转发（Ctrl+C 以 `\x03` 到达，由 PTY 行规程转译为前台中断），因此无需遵循 POSIX 就绪或前台进程组约定。关闭操作通过 subprocess 原语终止整个会话树并等待静默。

## 模型体验

### 间接消费方

#### 模型看到的内容

直接而言没有。该后端不注册任何提示词或工具；可见的 PTY schema 与结果文本由 `@deepseek-ai/dsh-tool-terminal` 负责。

#### Token 影响

直接而言没有。实时终端输出仅存在于进程内，不会经由此包进入模型历史。

#### KV Cache 影响

无直接影响；任何请求前缀变化都由上述具名消费方负责。

## 已知限制与暂缓事项

- 原始 ANSI 为 xterm 保留，因此全屏与彩色渲染取决于客户端的终端仿真器；重连后 scrollback 回放会重新发出保留的原始字节。
- 不支持逐行 send 与前台信号：该后端仅为人类终端这一半，面向模型的终端仍留在 `terminal-bash` 上。
- `shellArgs` 默认 `--noprofile --norc -i`，因此 shell 以干净 profile 启动；需要登录提示符和别名的用户须自行 source。
- harness 进程退出后，会话无法继续存在。
