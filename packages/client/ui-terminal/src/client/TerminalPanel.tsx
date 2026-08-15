/**
 * Docked terminal panel (the layout-owned `shell.panel` single slot): a
 * horizontal split below the columns, resized by dragging its top divider. The
 * xterm surface is transparent so the panel's page-background token shows
 * through, and keystrokes/output flow through the injected terminal face.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionId, TerminalOutput } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
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

/** The xterm surface: opens one terminal, streams output, forwards keystrokes, resizes. */
function TerminalBody({ sessionId, face }: { sessionId: SessionId; face: TerminalFace }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      allowTransparency: true,
      theme: xtermTheme(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    let terminalId: string | null = null
    let disposed = false

    const offOutput = face.onOutput((output: TerminalOutput) => {
      if (output.sessionId === sessionId && output.id === terminalId) term.write(output.data)
    })
    const offReset = face.onReset(() => { term.reset() })

    void face.open(sessionId).then((created) => {
      if (disposed) return
      terminalId = created.id
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
      term.dispose()
    }
  }, [sessionId, face])

  return <div ref={hostRef} className={css.body} />
}

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
  if (!open || sessionId === undefined) return null

  return (
    <div className={css.panel} style={{ height }} role="region" aria-label="终端面板">
      <PanelDivider
        onStart={() => { heightBase.current = height }}
        onDrag={(dy) => { actions.setHeight(heightBase.current - dy) }}
        onEnd={() => {}}
      />
      <header className={css.header}>
        <span className={css.title}>终端</span>
        <button type="button" className={css.close} aria-label="关闭终端" onClick={actions.close}>✕</button>
      </header>
      <TerminalBody sessionId={sessionId} face={face} />
    </div>
  )
}
