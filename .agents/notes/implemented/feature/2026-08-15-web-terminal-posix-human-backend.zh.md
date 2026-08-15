# Agent Note: web terminal serves a raw bash backend on POSIX and supports selection copy

Status: implemented

[English](2026-08-15-web-terminal-posix-human-backend.md) | 中文

## Problem

人类内嵌终端（`@deepseek-ai/dsh-client-ui-terminal`，`shell.panel` 槽位里的 xterm）在 POSIX 上以三种方式叠加地坏掉。

- **`name: 'dumb'` 被硬编码。** `LocalSubprocessRuntime.spawnTerminal` 总是把 `name: 'dumb'` 传给 node-pty，而 node-pty 的 `name` 会覆盖 `env.TERM`，于是每个 PTY 子进程看到的都是 `TERM=dumb`——包括 PowerShell 人类后端，其 `TERM=xterm-256color` 环境项被静默丢弃。
- **人类终端复用了面向模型的后端。** 在 POSIX 上唯一注册的后端是 `terminal-bash`（类型 `shell`）：`TERM=dumb`、剥离 ANSI 的 sanitizer，以及带 `PROMPT_COMMAND` 标记的受控 `dsh> ` 提示符。宿主 RPC 通过 `listBackends()[0]` 选中它，于是交互式终端是逐行、无彩色，并打印 `dsh> ` 而非用户自己的提示符。
- **无法复制。** xterm 渲染到 canvas，把剪贴板写入留给宿主；面板既没有复制快捷键也没有复制按钮，鼠标选中无法离开页面。

## Decision

- `SubprocessTerminalSpawnSpec` 新增可选的 `name`，`spawnTerminal` 使用 `spec.name ?? 'dumb'`。`terminal-bash` 传 `dumb`；`terminal-pwsh` 传 `xterm-256color`，恢复其本意的 `TERM`。
- 新后端 `@deepseek-ai/dsh-terminal-bash-human`（类型 `bash-human`）在 POSIX 上服务人类终端。它镜像 `terminal-pwsh`：原始 UTF-8 透传、不净化、`TERM=xterm-256color`、`-i`（从而由 `.bashrc` 载入用户的别名、`LS_COLORS` 与提示符）、无受控提示符，`startSend`/`signal` 拒绝模型侧就绪契约。关闭会终止整棵进程树。
- 宿主 RPC 确定性地选择人类后端：`terminal.open` 解析 `request.payload.type ?? backends.find(name => name !== 'shell') ?? backends[0]`，因此当组合了原始后端时，`shell`（逐行的模型后端）不再服务人类终端。
- xterm 表面通过 Ctrl+Shift+C / Cmd+C、标题栏「复制」按钮，以及存在选中时的 Ctrl+C（Windows/VS Code 惯例）复制选中内容；无选中时的 Ctrl+C 保留中断含义。面板还在 `open` resolve 后把 PTY resize 到已适配的网格。

## Alternatives considered

**只保留一个 POSIX 后端，给 `terminal-bash` 加一个原始「人类」配置开关。** 否决：面向模型的会话（sanitizer、就绪轮询、受控提示符）与人类会话（原始透传、无就绪）是不同的会话类；一个开关会让整个会话生命周期分叉。独立后端让模型与人类角色与 Windows 的拆分（`terminal-pwsh`）保持对称。

**从 `terminal-bash-human` 复用 `terminal-pwsh` 的会话类。** 否决：跨包导入兄弟插件内部符号被禁止，且会让 POSIX 包依赖一个仅限 Windows 的包。原始会话是约 230 行的样板孪生，在预发布阶段接受这种重复。

**只通过快捷键复制。** 否决：仅靠隐藏快捷键无法解决「选中了却没法复制」；标题栏按钮和带选中的 Ctrl+C 符合产品的复制控件模式与平台肌肉记忆。

## Consequences

POSIX 人类终端现在按 xterm 期望渲染颜色与光标控制，使用用户的 shell 提示符，并可复制选中内容。面向模型的 `terminal-bash` 表面保持不变。两个原始后端孪生（`terminal-bash-human`、`terminal-pwsh`）共享镜像的会话形状；把它们合并进共享原始会话包暂缓。`terminal.open` 中对 `shell` 类型的排除是一行硬编码规则，而非终端注册表上声明的「人类」能力。

## Testing

`terminal-bash-human` 拥有 `config`、`index`、`session` 三个套件，达到逐文件 100% 门槛（字节/行截断、传输失败、拆解、默认工厂路径）。`terminal-pwsh` 与 `terminal-bash` 现在断言各自的 `name`；subprocess-local 的 `??` 回退经真实组合测试覆盖。xterm 复制路由在 `terminal-panel.client.spec.tsx` 中被钉住（Ctrl+Shift+C、Cmd+C、有无选中的 Ctrl+C、标题栏按钮、拒绝写入、反馈复位）。
