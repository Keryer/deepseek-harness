// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { TerminalToggle, type TerminalToggleProps } from '../src/client/TerminalToggle.tsx'
import { TerminalPanel, type TerminalPanelProps, type TerminalFace } from '../src/client/TerminalPanel.tsx'
import { createTerminalStore } from '../src/client/stores.ts'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon(_addon: unknown): void {}
    open(_host: HTMLElement): void {}
    dispose(): void {}
    write(_data: string): void {}
    reset(): void {}
    cols = 80
    rows = 24
    onData(_listener: (data: string) => void): { dispose(): void } { return { dispose() {} } }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { fit(): void {} },
}))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

class FakeResizeObserver {
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
    onOutput: vi.fn(() => () => {}),
    onReset: vi.fn(() => () => {}),
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
  vi.unstubAllGlobals()
  cleanup()
})

describe('TerminalToggle', () => {
  it('labels itself by dock state and toggles on click', () => {
    const instance = createTerminalStore().create()
    const props: TerminalToggleProps = {
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
})
