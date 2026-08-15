/**
 * Embedded-terminal UI plugin, browser half: a floating toggle button in the
 * layout-owned `shell.overlay` list slot plus the docked panel in the layout
 * `shell.panel` single slot. One terminal store (shared handle) drives both, so
 * the toggle and the panel's close button stay in sync. The inject face narrows
 * the host terminal RPC domain and the runtime terminal feed into the panel's
 * callbacks, so the components never reach the wire or the object layer.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { TerminalFeed } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls ui-layout's SlotMap merge (the 'shell.overlay'/'shell.panel' entries).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { TerminalToggle } from './TerminalToggle.tsx'
import { TerminalPanel, type TerminalFace } from './TerminalPanel.tsx'
import { createTerminalStore } from './stores.ts'

export type { TerminalFace } from './TerminalPanel.tsx'

/** Required services: the slot registry, the wire client, and the terminal feed. */
export const inject = ['slots', 'connection', 'terminalFeed']

/**
 * Client plugin body: register the toggle and the panel over one shared store.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const terminalFeed = ctx.get('terminalFeed') as TerminalFeed
  const terminal = connection.api.terminal

  const face = (): TerminalFace => ({
    async open(sessionId) {
      const response = await terminal.open({ sessionId })
      if (!response.result.ok) throw new Error(response.result.error.message)
      return { id: response.result.value.id, motd: response.result.value.motd ?? '' }
    },
    async write(sessionId, id, text) {
      const response = await terminal.write({ sessionId, id, text })
      if (!response.result.ok) throw new Error(response.result.error.message)
    },
    async resize(sessionId, id, cols, rows) {
      const response = await terminal.resize({ sessionId, id, cols, rows })
      if (!response.result.ok) throw new Error(response.result.error.message)
    },
    async close(sessionId, id) {
      const response = await terminal.close({ sessionId, id })
      if (!response.result.ok) throw new Error(response.result.error.message)
    },
    onOutput: listener => terminalFeed.onOutput(listener),
    onReset: listener => terminalFeed.onReset(listener),
  })

  const store = createTerminalStore()

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'terminal', store },
    TerminalToggle,
  ))

  ctx.slots.inject('shell.panel', () => ctx.slots.register(
    { name: 'shell.panel', store, inject: () => face() },
    TerminalPanel,
  ))
}
