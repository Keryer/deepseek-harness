// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId, TerminalOutput } from '@deepseek-ai/dsh-client-runtime/client'
import { TerminalToggle, type TerminalToggleProps } from '../src/client/TerminalToggle.tsx'
import { TerminalPanel, type TerminalPanelProps, type TerminalFace } from '../src/client/TerminalPanel.tsx'
import { createTerminalStore } from '../src/client/stores.ts'

/** Test-selected xterm surface state: the selection and the captured key handler. */
const xtermMock = vi.hoisted(() => {
  const state: {
    selection: string
    keyHandler: ((event: {
      type?: string
      ctrlKey?: boolean
      shiftKey?: boolean
      metaKey?: boolean
      code?: string
      preventDefault?: () => void
    }) => boolean) | undefined
    writes: string[]
    onData: ((data: string) => void) | undefined
    theme: { foreground?: string; background?: string } | undefined
    resets: number
  } = { selection: '', keyHandler: undefined, writes: [], onData: undefined, theme: undefined, resets: 0 }
  return { state }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor(options: { theme?: { foreground?: string; background?: string } }) {
      xtermMock.state.theme = options?.theme
    }
    loadAddon(_addon: unknown): void {}
    open(_host: HTMLElement): void {}
    dispose(): void {}
    write(data: string): void { xtermMock.state.writes.push(data) }
    reset(): void { xtermMock.state.resets += 1 }
    cols = 80
    rows = 24
    onData(listener: (data: string) => void): { dispose(): void } {
      xtermMock.state.onData = listener
      return { dispose() {} }
    }
    getSelection(): string { return xtermMock.state.selection }
    attachCustomKeyEventHandler(handler: NonNullable<typeof xtermMock.state.keyHandler>): void {
      xtermMock.state.keyHandler = handler
    }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { fit(): void {} },
}))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

/** Captured ResizeObserver callback so a test can replay a panel resize. */
let resizeObserverCallback: (() => void) | undefined

class FakeResizeObserver {
  constructor(callback: () => void) { resizeObserverCallback = callback }
  observe(): void {}
  disconnect(): void {}
}

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S { return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot)) }
}

const useSessions = ((sel: (state: { current: SessionId | undefined }) => unknown) =>
  sel({ current: 's1' as SessionId })) as never
const useWorkspaces = (() => ({})) as never

function face(): TerminalFace {
  return {
    open: vi.fn(() => Promise.resolve({ id: 'pty-1', motd: 'prompt> ' })),
    write: vi.fn(() => Promise.resolve()),
    resize: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    onOutput: vi.fn((_listener: (output: TerminalOutput) => void) => () => {}),
    onReset: vi.fn((_listener: () => void) => () => {}),
  }
}

/** A live store instance whose dock is opened when `open` is true, plus typed test props. */
function mountPanel(open: boolean, f: TerminalFace = face()) {
  const instance = createTerminalStore().create()
  if (open) instance.actions.open()
  const props: TerminalPanelProps = {
    useStore: hookOf(instance),
    actions: instance.actions,
    useSessions,
    useWorkspaces,
    ...f,
  }
  return { instance, props }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  cleanup()
  document.body.removeAttribute('data-ds-dark-theme')
  resizeObserverCallback = undefined
  xtermMock.state.selection = ''
  xtermMock.state.keyHandler = undefined
  xtermMock.state.writes = []
  xtermMock.state.onData = undefined
  xtermMock.state.theme = undefined
  xtermMock.state.resets = 0
})

describe('TerminalToggle', () => {
  it('labels itself by dock state and toggles on click', () => {
    const instance = createTerminalStore().create()
    const props: TerminalToggleProps = {
      wide: true,
      useStore: hookOf(instance),
      actions: instance.actions,
      useSessions,
      useWorkspaces,
    }
    const { rerender } = render(<TerminalToggle {...props} />)
    const button = screen.getByRole('button', { name: '打开终端' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    rerender(<TerminalToggle {...props} />)
    expect(screen.getByRole('button', { name: '关闭终端' }).getAttribute('aria-expanded')).toBe('true')
    expect(instance.store.getSnapshot().open).toBe(true)
  })

  it('renders the icon-only rail while collapsed', () => {
    const instance = createTerminalStore().create()
    const props: TerminalToggleProps = {
      wide: false,
      useStore: hookOf(instance),
      actions: instance.actions,
      useSessions,
      useWorkspaces,
    }
    render(<TerminalToggle {...props} />)
    const button = screen.getByRole('button', { name: '打开终端' })
    expect(button.textContent).toBe('')
  })
})

describe('TerminalPanel', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', FakeResizeObserver) })

  it('renders nothing while closed, and the region while open with a session', () => {
    const closed = mountPanel(false)
    const { rerender } = render(<TerminalPanel {...closed.props} />)
    expect(screen.queryByRole('region', { name: '终端面板' })).toBeNull()
    const open = mountPanel(true)
    rerender(<TerminalPanel {...open.props} />)
    expect(screen.getByRole('region', { name: '终端面板' })).toBeTruthy()
  })

  it('opens a terminal for the current session and the close button closes the dock', async () => {
    const f = face()
    const { instance, props } = mountPanel(true, f)
    render(<TerminalPanel {...props} />)
    await vi.waitFor(() => { expect(f.open).toHaveBeenCalledWith('s1') })
    fireEvent.click(screen.getByRole('button', { name: '关闭终端' }))
    expect(instance.store.getSnapshot().open).toBe(false)
  })

  it('resizes the panel height by dragging the top divider', () => {
    // jsdom lacks pointer capture: emulate per-element so hasPointerCapture gates pass.
    const captured = new WeakSet<Element>()
    Element.prototype.setPointerCapture = function () { captured.add(this) }
    Element.prototype.releasePointerCapture = function () { captured.delete(this) }
    Element.prototype.hasPointerCapture = function () { return captured.has(this) }

    const { instance, props } = mountPanel(true)
    render(<TerminalPanel {...props} />)
    const divider = screen.getByRole('separator')
    fireEvent.pointerDown(divider, { pointerId: 1, clientY: 500 })
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 380 })
    fireEvent.pointerUp(divider, { pointerId: 1, clientY: 380 })
    // 320 default − (−120 dy) = 440.
    expect(instance.store.getSnapshot().height).toBe(440)
  })

  it('resizes the PTY to the fitted grid once the terminal opens', async () => {
    const f = face()
    const { props } = mountPanel(true, f)
    render(<TerminalPanel {...props} />)
    await vi.waitFor(() => { expect(f.resize).toHaveBeenCalledWith('s1', 'pty-1', 80, 24) })
  })

  it('keeps the terminal usable when the initial resize is refused', async () => {
    const f = face()
    f.resize = vi.fn(() => Promise.reject(new Error('resize denied')))
    const { props } = mountPanel(true, f)
    render(<TerminalPanel {...props} />)
    await vi.waitFor(() => { expect(xtermMock.state.writes).toContain('prompt> ') })
    expect(xtermMock.state.writes.some(w => w.startsWith('[terminal]'))).toBe(false)
  })

  it('writes the open failure into the terminal', async () => {
    const f = face()
    f.open = vi.fn(() => Promise.reject(new Error('open failed')))
    const { props } = mountPanel(true, f)
    render(<TerminalPanel {...props} />)
    await vi.waitFor(() => {
      expect(xtermMock.state.writes.some(w => w.includes('open failed'))).toBe(true)
    })
  })

  it('renders a non-Error open failure message', async () => {
    const f = face()
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercises the String(error) arm for a non-Error rejection.
    f.open = vi.fn(() => Promise.reject('string failure'))
    const { props } = mountPanel(true, f)
    render(<TerminalPanel {...props} />)
    await vi.waitFor(() => {
      expect(xtermMock.state.writes.some(w => w.includes('string failure'))).toBe(true)
    })
  })

  it('skips writing an empty motd', async () => {
    const f = face()
    f.open = vi.fn(() => Promise.resolve({ id: 'pty-1', motd: '' }))
    const { props } = mountPanel(true, f)
    render(<TerminalPanel {...props} />)
    await vi.waitFor(() => { expect(f.resize).toHaveBeenCalledWith('s1', 'pty-1', 80, 24) })
    expect(xtermMock.state.writes).toEqual([])
  })

  it('ignores a terminal that opens after the panel closed', async () => {
    let resolveOpen: (value: { id: string; motd: string }) => void = () => {}
    const f = face()
    f.open = vi.fn(() => new Promise<{ id: string; motd: string }>((resolve) => { resolveOpen = resolve }))
    const { props } = mountPanel(true, f)
    const { unmount } = render(<TerminalPanel {...props} />)
    unmount()
    resolveOpen({ id: 'pty-1', motd: 'prompt> ' })
    await act(async () => { await Promise.resolve() })
    expect(f.resize).not.toHaveBeenCalled()
    expect(xtermMock.state.writes).toEqual([])
  })

  it('forwards keystrokes only after the terminal opens', async () => {
    const f = face()
    const { props } = mountPanel(true, f)
    render(<TerminalPanel {...props} />)
    // Before open resolves the PTY id is unknown, so keystrokes are dropped.
    xtermMock.state.onData?.('ls')
    expect(f.write).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(f.open).toHaveBeenCalledWith('s1') })
    xtermMock.state.onData?.('ls\r')
    expect(f.write).toHaveBeenCalledWith('s1', 'pty-1', 'ls\r')
  })

  it('re-fits and resizes from the observer once the terminal is open', async () => {
    const f = face()
    const { props } = mountPanel(true, f)
    render(<TerminalPanel {...props} />)
    // The observer's first callback runs before open resolves: it re-fits but drops the resize.
    resizeObserverCallback?.()
    expect(f.resize).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(f.open).toHaveBeenCalledWith('s1') })
    resizeObserverCallback?.()
    await vi.waitFor(() => { expect(f.resize).toHaveBeenCalledWith('s1', 'pty-1', 80, 24) })
  })

  it('streams live output to the matching terminal and ignores the rest', async () => {
    const f = face()
    const { props } = mountPanel(true, f)
    render(<TerminalPanel {...props} />)
    await vi.waitFor(() => { expect(f.open).toHaveBeenCalledWith('s1') })
    const onOutput = vi.mocked(f.onOutput).mock.calls[0]![0] as (output: { sessionId: string; id: string | null; data: string }) => void
    const before = xtermMock.state.writes.length
    onOutput({ sessionId: 'other', id: 'pty-1', data: 'a' })
    onOutput({ sessionId: 's1', id: 'other', data: 'b' })
    expect(xtermMock.state.writes.length).toBe(before)
    onOutput({ sessionId: 's1', id: 'pty-1', data: 'c' })
    expect(xtermMock.state.writes[xtermMock.state.writes.length - 1]).toBe('c')
  })

  it('resets the surface when the connection generation re-establishes', async () => {
    const f = face()
    const { props } = mountPanel(true, f)
    render(<TerminalPanel {...props} />)
    const onReset = vi.mocked(f.onReset).mock.calls[0]![0]
    onReset()
    expect(xtermMock.state.resets).toBe(1)
  })

  it('picks the dark theme foreground from a resolved page token', async () => {
    document.body.setAttribute('data-ds-dark-theme', '')
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => ' #123456 ' }) as unknown as typeof getComputedStyle)
    const f = face()
    const { props } = mountPanel(true, f)
    render(<TerminalPanel {...props} />)
    await vi.waitFor(() => { expect(f.open).toHaveBeenCalled() })
    expect(xtermMock.state.theme).toEqual({ foreground: '#123456', background: '#00000000' })
  })

  it('falls back for the dark theme foreground when the token is absent', async () => {
    document.body.setAttribute('data-ds-dark-theme', '')
    const f = face()
    const { props } = mountPanel(true, f)
    render(<TerminalPanel {...props} />)
    await vi.waitFor(() => { expect(f.open).toHaveBeenCalled() })
    expect(xtermMock.state.theme).toEqual({ foreground: '#e6e6e6', background: '#00000000' })
  })

  it('ignores divider pointer moves without a captured pointer', () => {
    Element.prototype.hasPointerCapture = () => false
    const { instance, props } = mountPanel(true)
    render(<TerminalPanel {...props} />)
    const divider = screen.getByRole('separator')
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 100 })
    fireEvent.pointerUp(divider, { pointerId: 1, clientY: 100 })
    expect(instance.store.getSnapshot().height).toBe(320)
  })

  describe('copy', () => {
    function installClipboard(writeText: (text: string) => Promise<void>): void {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    }

    it('routes copy keys to the clipboard and leaves other keys to xterm', async () => {
      const writeText = vi.fn(() => Promise.resolve())
      installClipboard(writeText)
      const f = face()
      const { props } = mountPanel(true, f)
      render(<TerminalPanel {...props} />)
      await vi.waitFor(() => { expect(xtermMock.state.keyHandler).toBeDefined() })
      const handler = xtermMock.state.keyHandler!

      // Non-keydown and non-copy keys pass through to xterm unchanged.
      expect(handler({ type: 'keyup', ctrlKey: true, shiftKey: true, code: 'KeyC' })).toBe(true)
      expect(handler({ type: 'keydown', ctrlKey: false })).toBe(true)
      expect(handler({ type: 'keydown', ctrlKey: true, shiftKey: false })).toBe(true)
      expect(handler({ type: 'keydown', ctrlKey: true, shiftKey: true, code: 'KeyA' })).toBe(true)
      expect(handler({ type: 'keydown', metaKey: true, code: 'KeyA' })).toBe(true)
      expect(writeText).not.toHaveBeenCalled()

      // Ctrl+C without a selection keeps its interrupt meaning.
      xtermMock.state.selection = ''
      expect(handler({ type: 'keydown', ctrlKey: true, code: 'KeyC' })).toBe(true)
      expect(writeText).not.toHaveBeenCalled()

      // A copy key with an empty selection consumes the key but writes nothing.
      const preventDefault = vi.fn()
      expect(handler({ type: 'keydown', ctrlKey: true, shiftKey: true, code: 'KeyC', preventDefault })).toBe(false)
      expect(preventDefault).toHaveBeenCalled()
      expect(writeText).not.toHaveBeenCalled()

      // Ctrl+Shift+C copies the selection.
      xtermMock.state.selection = 'hello'
      expect(handler({ type: 'keydown', ctrlKey: true, shiftKey: true, code: 'KeyC', preventDefault: vi.fn() })).toBe(false)
      expect(writeText).toHaveBeenCalledWith('hello')

      // Ctrl+C with a selection copies too (Windows/VS Code convention).
      xtermMock.state.selection = 'ctrl-c'
      expect(handler({ type: 'keydown', ctrlKey: true, code: 'KeyC', preventDefault: vi.fn() })).toBe(false)
      expect(writeText).toHaveBeenCalledWith('ctrl-c')

      // Ctrl+Cmd+C is a copy shortcut, not an interrupt.
      xtermMock.state.selection = 'both'
      expect(handler({ type: 'keydown', ctrlKey: true, metaKey: true, code: 'KeyC', preventDefault: vi.fn() })).toBe(false)
      expect(writeText).toHaveBeenCalledWith('both')

      // Cmd+C copies the selection too.
      xtermMock.state.selection = 'world'
      expect(handler({ type: 'keydown', metaKey: true, code: 'KeyC', preventDefault: vi.fn() })).toBe(false)
      expect(writeText).toHaveBeenCalledWith('world')
    })

    it('copies the selection through the header button and shows success', async () => {
      const writeText = vi.fn(() => Promise.resolve())
      installClipboard(writeText)
      const f = face()
      const { props } = mountPanel(true, f)
      render(<TerminalPanel {...props} />)
      await vi.waitFor(() => { expect(f.open).toHaveBeenCalledWith('s1') })
      xtermMock.state.selection = 'abc'
      fireEvent.click(screen.getByRole('button', { name: '复制' }))
      expect(writeText).toHaveBeenCalledWith('abc')
      expect(await screen.findByRole('button', { name: '复制成功' })).toBeTruthy()
    })

    it('does not copy when nothing is selected', async () => {
      const writeText = vi.fn(() => Promise.resolve())
      installClipboard(writeText)
      const f = face()
      const { props } = mountPanel(true, f)
      render(<TerminalPanel {...props} />)
      await vi.waitFor(() => { expect(f.open).toHaveBeenCalledWith('s1') })
      fireEvent.click(screen.getByRole('button', { name: '复制' }))
      await act(async () => { await Promise.resolve() })
      expect(writeText).not.toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: '复制成功' })).toBeNull()
    })

    it('shows no success label when the clipboard write is refused', async () => {
      installClipboard(vi.fn(() => Promise.reject(new Error('denied'))))
      const f = face()
      const { props } = mountPanel(true, f)
      render(<TerminalPanel {...props} />)
      await vi.waitFor(() => { expect(f.open).toHaveBeenCalledWith('s1') })
      xtermMock.state.selection = 'abc'
      fireEvent.click(screen.getByRole('button', { name: '复制' }))
      await act(async () => { await Promise.resolve() })
      expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: '复制成功' })).toBeNull()
    })

    it('ignores a second click while the success label is showing', async () => {
      const writeText = vi.fn(() => Promise.resolve())
      installClipboard(writeText)
      const f = face()
      const { props } = mountPanel(true, f)
      render(<TerminalPanel {...props} />)
      await vi.waitFor(() => { expect(f.open).toHaveBeenCalledWith('s1') })
      xtermMock.state.selection = 'abc'
      fireEvent.click(screen.getByRole('button', { name: '复制' }))
      await screen.findByRole('button', { name: '复制成功' })
      fireEvent.click(screen.getByRole('button', { name: '复制成功' }))
      expect(writeText).toHaveBeenCalledTimes(1)
    })

    it('clears the success label after the feedback window', async () => {
      vi.useFakeTimers()
      const writeText = vi.fn(() => Promise.resolve())
      installClipboard(writeText)
      const f = face()
      const { props } = mountPanel(true, f)
      render(<TerminalPanel {...props} />)
      xtermMock.state.selection = 'abc'
      fireEvent.click(screen.getByRole('button', { name: '复制' }))
      await act(async () => { await Promise.resolve() })
      expect(screen.getByRole('button', { name: '复制成功' })).toBeTruthy()
      await vi.advanceTimersByTimeAsync(1000)
      expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
    })
  })
})
