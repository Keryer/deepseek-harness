# @deepseek-ai/dsh-client-ui-terminal

[English](README.md) | 中文

Web 内嵌终端功能插件：布局所有的 `shell.overlay` 槽里的悬浮切换按钮，打开/关闭布局 `shell.panel` 底部停靠的终端面板（xterm）。面板停靠在中间/详情列下方——会话栏保持全高——跟随当前会话，通过 `terminal/output` WebSocket 下行流实时推送输出，按键直接写入宿主 PTY，拖动顶部分割条可调整高度，跟随页面背景色，并在浅色主题下切换为浅色 ANSI 配色。

宿主半侧刻意留空：终端 RPC 域在宿主 `apiproxy`，终端对象层状态（`ctx.terminalFeed`）在客户端 `runtime`；本包把两者窄化成一个 inject 面，并通过插槽系统渲染页面。一个共享的终端 store（打开状态 + 面板高度）同时驱动切换按钮与面板。

## Model Experience

None, as 本包渲染人类终端界面，模型侧的 PTY 工具属于 `dsh-tool-terminal`。

#### KV Cache effect

无。没有模型可见的输入或输出流经本包。

## Known Limitations and Deferred Work

- **仅底部停靠** —— 面板停靠在中间/详情列下方；详情列旁的右缘停靠与位置切换暂缓。
- **关闭即终止终端** —— 收起面板会卸载 xterm 并关闭宿主 PTY 会话；隐藏但保持存活的面板暂缓。
- **打开期间切换主题** —— xterm 配色（前景与 ANSI 色）在挂载时选择一次，因此切换主题需重新开关面板才生效。
