/**
 * createTerminalStore unit account: init shape, the action write set (open
 * flip and height clamp inside actions), and instance independence. Uses the
 * test-sanctioned path: factory self-call + .create() gives the real engine
 * instance (same create path as production).
 */
import { describe, expect, it } from 'vitest'
import {
  createTerminalStore,
  TERMINAL_HEIGHT_DEFAULT,
  TERMINAL_HEIGHT_MAX,
  TERMINAL_HEIGHT_MIN,
} from '@deepseek-ai/dsh-client-ui-terminal/src/client/stores.ts'

describe('createTerminalStore', () => {
  it('initializes closed at the default height', () => {
    const { store } = createTerminalStore().create()
    expect(store.getSnapshot()).toEqual({ open: false, height: TERMINAL_HEIGHT_DEFAULT })
  })

  it('each create() is an independent instance (factory is not a singleton)', () => {
    const a = createTerminalStore().create()
    const b = createTerminalStore().create()
    a.actions.open()
    expect(b.store.getSnapshot().open).toBe(false)
  })

  it('toggle/open/close flip the dock state', () => {
    const { store, actions } = createTerminalStore().create()
    actions.toggle()
    expect(store.getSnapshot().open).toBe(true)
    actions.close()
    expect(store.getSnapshot().open).toBe(false)
    actions.open()
    expect(store.getSnapshot().open).toBe(true)
  })

  it('setHeight clamps into the contract range', () => {
    const { store, actions } = createTerminalStore().create()
    actions.setHeight(1)
    expect(store.getSnapshot().height).toBe(TERMINAL_HEIGHT_MIN)
    actions.setHeight(9999)
    expect(store.getSnapshot().height).toBe(TERMINAL_HEIGHT_MAX)
    actions.setHeight(500)
    expect(store.getSnapshot().height).toBe(500)
  })
})
