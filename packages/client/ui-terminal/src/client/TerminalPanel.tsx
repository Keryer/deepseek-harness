/**
 * Docked terminal panel (the layout-owned `shell.panel` single slot): a
 * horizontal split below the columns, resized by dragging its top divider. The
 * xterm surface is transparent so the panel's page-background token shows
 * through, and keystrokes/output flow through the injected terminal face.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { SessionId, TerminalOutput } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import './xterm.module.css'
import type { createTerminalStore } from './stores.ts'
import css from './TerminalLauncher.module.css'

/** The terminal business face the inject factory narrows the wire/feed into. */
export interface TerminalFace {
  open: (sessionId: SessionId) => Promise<{ id: string; motd: string }>
  write: (sessionId: SessionId, id: string, text: string) => Promise<void>
  resize: (sessionId: SessionId, id: string, cols: number, rows: number) => Promise<void>
  close: (sessionId: SessionId, id: string) => Promise<void>
  onOutput: (listener: (output: TerminalOutput) => void) => () => void
  onReset: (listener: () => void) => () => void
}

/** Panel props: the panel runtime share, the terminal store, and the terminal face. */
export type TerminalPanelProps =
  & PropsRuntime<'shell.panel'>
  & PropsStore<ReturnType<typeof createTerminalStore>>
  & TerminalFace

/** Read a resolved CSS color token from the page; '' (jsdom, missing sheet) falls back. */
function resolvedColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

/** Light-palette ANSI colors so PowerShell's syntax highlighting stays readable on a white page. */
const LIGHT_THEME: ITheme = {
  foreground: '#1f1f1f',
  background: '#00000000',
  cursor: '#1f1f1f',
  selectionBackground: '#c8e1ff',
  black: '#000000',
  red: '#cd3131',
  green: '#008000',
  yellow: '#8a7a00',
  blue: '#0451a5',
  magenta: '#b000b0',
  cyan: '#00838f',
  white: '#5c5c5c',
  brightBlack: '#767676',
  brightRed: '#cd3131',
  brightGreen: '#0a8a00',
  brightYellow: '#7a6a00',
  brightBlue: '#0451a5',
  brightMagenta: '#b000b0',
  brightCyan: '#00838f',
  brightWhite: '#a3a3a3',
}

/** Dark theme keeps xterm's default ANSI palette; only the page text + transparency are set. */
function xtermTheme(): ITheme {
  if (document.body.hasAttribute('data-ds-dark-theme')) {
    return {
      foreground: resolvedColor('--dsw-alias-label-primary', '#e6e6e6'),
      background: '#00000000',
    }
  }
  return LIGHT_THEME
}

/**
 * One horizontal resize divider: pointer capture, dy reports against the
 * drag-start origin. The owning panel freezes its base height at drag start so
 * consecutive dy deltas do not compound.
 */
function PanelDivider(props: { onStart: () => void; onDrag: (dy: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)

  return (
    <div
      className={css.divider}
      data-dragging={dragging || undefined}
      role="separator"
      aria-orientation="horizontal"
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        origin.current = e.clientY
        props.onStart()
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        props.onDrag(e.clientY - origin.current)
      }}
      onPointerUp={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        e.currentTarget.releasePointerCapture(e.pointerId)
        props.onDrag(e.clientY - origin.current)
        setDragging(false)
        props.onEnd()
      }}
    />
  )
}

/** How long the header copy control's success label stays after a copy, in ms. */
const COPIED_FEEDBACK_MS = 1000

/** Imperative surface the panel header's copy control reaches into. */
interface TerminalBodyHandle {
  /** Copy the current xterm selection; resolves false when nothing is selected or the host declined. */
  copy: () => Promise<boolean>
}

/** The xterm surface: opens one terminal, streams output, forwards keystrokes, resizes. */
const TerminalBody = forwardRef<TerminalBodyHandle, { sessionId: SessionId; face: TerminalFace }>(
  function TerminalBody({ sessionId, face }, ref) {
    const hostRef = useRef<HTMLDivElement>(null)
    const termRef = useRef<Terminal | null>(null)

    useImperativeHandle(ref, () => ({
      copy: async () => {
        const term = termRef.current
        /* v8 ignore next -- ref-null guard: copy is only reachable while the xterm is mounted. */
        if (term === null) return false
        const selection = term.getSelection()
        if (selection.length === 0) return false
        return writeClipboard(selection)
      },
    }), [])

    useEffect(() => {
      const host = hostRef.current
      /* v8 ignore next -- ref-null guard: the effect runs only after the body div commits. */
      if (host === null) return
      const term = new Terminal({
        convertEol: false,
        cursorBlink: true,
        allowTransparency: true,
        theme: xtermTheme(),
      })
      termRef.current = term
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(host)
      fit.fit()

      // xterm renders to a canvas and leaves clipboard writes to the host, so
      // copy must be wired here. Ctrl+Shift+C / Cmd+C copies the selection;
      // other keys (including plain Ctrl+C → SIGINT) keep xterm's handling.
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return true
        const copyKey = (event.ctrlKey && event.shiftKey && event.code === 'KeyC')
          || (event.metaKey && event.code === 'KeyC')
        if (!copyKey) return true
        event.preventDefault()
        const selection = term.getSelection()
        if (selection.length > 0) void writeClipboard(selection)
        return false
      })

      let terminalId: string | null = null
      let disposed = false

      const offOutput = face.onOutput((output: TerminalOutput) => {
        if (output.sessionId === sessionId && output.id === terminalId) term.write(output.data)
      })
      const offReset = face.onReset(() => { term.reset() })

      void face.open(sessionId).then((created) => {
        if (disposed) return
        terminalId = created.id
        // The PTY spawns on the backend's default grid while the surface is
        // already fitted to the panel. Sync before any command so COLUMNS-aware
        // output (ls, tables) aligns instead of wrapping at the wrong width.
        void face.resize(sessionId, terminalId, term.cols, term.rows).catch(() => {
          // A rejected initial resize keeps the backend default grid; the terminal stays usable.
        })
        if (created.motd.length > 0) term.write(created.motd)
      }).catch((error: unknown) => {
        term.write(`\r\n[terminal] ${error instanceof Error ? error.message : String(error)}\r\n`)
      })

      const input = term.onData((data) => {
        if (terminalId !== null) void face.write(sessionId, terminalId, data)
      })

      const observer = new ResizeObserver(() => {
        fit.fit()
        if (terminalId !== null) void face.resize(sessionId, terminalId, term.cols, term.rows)
      })
      observer.observe(host)

      return () => {
        disposed = true
        offOutput()
        offReset()
        input.dispose()
        observer.disconnect()
        if (terminalId !== null) void face.close(sessionId, terminalId)
        termRef.current = null
        term.dispose()
      }
    }, [sessionId, face])

    return <div ref={hostRef} className={css.body} />
  },
)

/**
 * The docked terminal: renders nothing while closed or session-less (so the
 * bottom row collapses), and otherwise a resizable, page-colored panel with a
 * header, a top divider, and the xterm body.
 */
export function TerminalPanel(props: TerminalPanelProps) {
  const { useStore, useSessions, actions } = props
  const open = useStore(s => s.open)
  const height = useStore(s => s.height)
  const sessionId = useSessions(s => s.current)

  const face = useMemo<TerminalFace>(() => ({
    open: props.open,
    write: props.write,
    resize: props.resize,
    close: props.close,
    onOutput: props.onOutput,
    onReset: props.onReset,
  }), [props.open, props.write, props.resize, props.close, props.onOutput, props.onReset])

  const heightBase = useRef(0)
  const bodyRef = useRef<TerminalBodyHandle>(null)
  const [copied, setCopied] = useState(false)
  if (!open || sessionId === undefined) return null

  const copySelection = () => {
    if (copied) return
    const body = bodyRef.current
    /* v8 ignore next -- ref-null guard: the copy button renders only alongside the mounted terminal body. */
    if (body === null) return
    void body.copy().then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, COPIED_FEEDBACK_MS)
    })
  }

  return (
    <div className={css.panel} style={{ height }} role="region" aria-label="终端面板">
      <PanelDivider
        onStart={() => { heightBase.current = height }}
        onDrag={(dy) => { actions.setHeight(heightBase.current - dy) }}
        onEnd={() => {}}
      />
      <header className={css.header}>
        <span className={css.title}>终端</span>
        <div className={css.actions}>
          <button type="button" className={css.copy} onClick={copySelection}>
            {copied ? '复制成功' : '复制'}
          </button>
          <button type="button" className={css.close} aria-label="关闭终端" onClick={actions.close}>✕</button>
        </div>
      </header>
      <TerminalBody ref={bodyRef} sessionId={sessionId} face={face} />
    </div>
  )
}
