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
import { TerminalToggle } from '../src/client/TerminalToggle.tsx'
import { TerminalPanel } from '../src/client/TerminalPanel.tsx'
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
        'shell.overlay': { kind: 'list', scope: 'root' },
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

  it('registers the toggle into the overlay slot and the panel into the panel slot', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const overlay = slots.entries('shell.overlay')
    const panel = slots.entries('shell.panel')
    expect(overlay).toHaveLength(1)
    expect(overlay[0]!.component).toBe(TerminalToggle)
    expect(panel).toHaveLength(1)
    expect(panel[0]!.component).toBe(TerminalPanel)
  })

  it('teardown unregisters both slot entries', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('shell.overlay')).toHaveLength(1)
    expect(slots.entries('shell.panel')).toHaveLength(1)
    await fiber.dispose()
    expect(slots.entries('shell.overlay')).toHaveLength(0)
    expect(slots.entries('shell.panel')).toHaveLength(0)
  })
})
