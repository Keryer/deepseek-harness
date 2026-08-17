/**
 * apply wiring on a real cordis Context + SlotRegistry: the toggle registered
 * into the layout-owned `shell.overlay` list slot and the panel into the
 * `shell.panel` single slot, both over one shared store handle, with
 * declaration-aware activation and fiber-teardown unregistration. Component
 * behavior is covered props-direct in terminal-panel.client.spec.tsx.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { TerminalToggle } from '../src/client/TerminalToggle.tsx'
import { TerminalPanel } from '../src/client/TerminalPanel.tsx'
import type { TerminalFace } from '../src/client/TerminalPanel.tsx'
import { apply, inject } from '../src/client/index.ts'

// xterm references browser globals at module scope; the node-env wiring test
// imports the components only to compare identities, so stub the renderer out.
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
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register(
    {
      name: 'root',
      children: {
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
        'shell.panel': { kind: 'single', scope: 'root' },
      },
    } as never,
    () => null,
  )
  // The plugin's inject face closes over these two services; the apply only
  // reads them inside the register's inject factory (never at mount), so plain
  // structural stubs satisfy the wiring.
  ctx.provide('connection', { api: { terminal: {
    open: () => Promise.resolve({ result: { ok: true, value: { id: 'pty-1', type: 'shell', status: { kind: 'running' }, motd: '' } } }),
    write: () => Promise.resolve({ result: { ok: true, value: { accepted: true } } }),
    resize: () => Promise.resolve({ result: { ok: true, value: { accepted: true } } }),
    close: () => Promise.resolve({ result: { ok: true, value: { closed: true } } }),
  } } })
  ctx.provide('terminalFeed', { onOutput: () => () => {}, onReset: () => () => {} })
  return { ctx, slots }
}

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'connection', 'terminalFeed'])
  })

  it('registers the toggle into the footer-action slot and the panel into the panel slot', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const action = slots.entries('sidebar.footer.action')
    const panel = slots.entries('shell.panel')
    expect(action).toHaveLength(1)
    expect(action[0]!.component).toBe(TerminalToggle)
    expect(panel).toHaveLength(1)
    expect(panel[0]!.component).toBe(TerminalPanel)
  })

  it('teardown unregisters both slot entries', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(1)
    expect(slots.entries('shell.panel')).toHaveLength(1)
    await fiber.dispose()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(slots.entries('shell.panel')).toHaveLength(0)
  })

  it('narrows the wire terminal and feed into the panel inject face', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register(
      {
        name: 'root',
        children: {
          'sidebar.footer.action': { kind: 'list', scope: 'root' },
          'shell.panel': { kind: 'single', scope: 'root' },
        },
      } as never,
      () => null,
    )

    const open = vi.fn()
    const write = vi.fn()
    const resize = vi.fn()
    const close = vi.fn()
    const onOutput = vi.fn(() => () => {})
    const onReset = vi.fn(() => () => {})

    ctx.provide('connection', { api: { terminal: { open, write, resize, close } } })
    ctx.provide('terminalFeed', { onOutput, onReset })
    await ctx.plugin({ inject: [...inject], apply }).await()

    const entry = slots.entries('shell.panel')[0]!
    const face = (entry.inject as unknown as () => TerminalFace)()

    // open: ok with motd, then ok without motd (falls back to '').
    open.mockResolvedValue({ result: { ok: true, value: { id: 'pty-1', type: 'shell', status: { kind: 'running' }, motd: 'prompt> ' } } })
    await expect(face.open('s1' as SessionId)).resolves.toEqual({ id: 'pty-1', motd: 'prompt> ' })
    expect(open).toHaveBeenCalledWith({ sessionId: 's1' })
    open.mockResolvedValue({ result: { ok: true, value: { id: 'pty-2', type: 'shell', status: { kind: 'running' } } } })
    await expect(face.open('s2' as SessionId)).resolves.toEqual({ id: 'pty-2', motd: '' })

    // write/resize/close forward the payload and surface a non-ok result.
    write.mockResolvedValue({ result: { ok: true, value: { accepted: true } } })
    await expect(face.write('s1' as SessionId, 'pty-1', 'ls\r')).resolves.toBeUndefined()
    expect(write).toHaveBeenCalledWith({ sessionId: 's1', id: 'pty-1', text: 'ls\r' })
    resize.mockResolvedValue({ result: { ok: true, value: { accepted: true } } })
    await expect(face.resize('s1' as SessionId, 'pty-1', 80, 24)).resolves.toBeUndefined()
    expect(resize).toHaveBeenCalledWith({ sessionId: 's1', id: 'pty-1', cols: 80, rows: 24 })
    close.mockResolvedValue({ result: { ok: true, value: { closed: true } } })
    await expect(face.close('s1' as SessionId, 'pty-1')).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledWith({ sessionId: 's1', id: 'pty-1' })

    // A non-ok response rejects with its message on every method.
    open.mockResolvedValue({ result: { ok: false, error: { code: 'x', message: 'open boom' } } })
    await expect(face.open('s1' as SessionId)).rejects.toThrow('open boom')
    write.mockResolvedValue({ result: { ok: false, error: { code: 'x', message: 'write boom' } } })
    await expect(face.write('s1' as SessionId, 'pty-1', 'x')).rejects.toThrow('write boom')
    resize.mockResolvedValue({ result: { ok: false, error: { code: 'x', message: 'resize boom' } } })
    await expect(face.resize('s1' as SessionId, 'pty-1', 1, 1)).rejects.toThrow('resize boom')
    close.mockResolvedValue({ result: { ok: false, error: { code: 'x', message: 'close boom' } } })
    await expect(face.close('s1' as SessionId, 'pty-1')).rejects.toThrow('close boom')

    // onOutput/onReset forward to the feed.
    const listener = () => {}
    face.onOutput(listener)
    expect(onOutput).toHaveBeenCalledWith(listener)
    face.onReset(listener)
    expect(onReset).toHaveBeenCalledWith(listener)
  })
})
