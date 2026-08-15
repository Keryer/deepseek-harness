/**
 * The embedded terminal's transient store: dock open state and panel height in
 * px. Module level exports the factory only — a module-level handle would pin
 * the store's identity in the module cache (a de-facto singleton surviving
 * plugin reloads). apply() calls the factory once and shares the handle between
 * the overlay toggle and the docked panel, so one state drives both.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Panel height before any user drag. */
export const TERMINAL_HEIGHT_DEFAULT = 320
/** Panel drag clamp floor. */
export const TERMINAL_HEIGHT_MIN = 120
/** Panel drag clamp ceiling. */
export const TERMINAL_HEIGHT_MAX = 800

/** Terminal store state: dock open and panel height in px. */
type TerminalState = { open: boolean; height: number }

/** Annotation twin of the actions literal below (the export needs a declared return type). */
type TerminalActions = {
  toggle: (d: TerminalState) => void
  open: (d: TerminalState) => void
  close: (d: TerminalState) => void
  setHeight: (d: TerminalState, px: number) => void
}

/**
 * Create the terminal store handle. Height is the drag preference, clamped into
 * the panel's contract range by the action; open/close are separate so the
 * toggle and the panel's close button share one audited mutation path.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createTerminalStore(): EngineStoreHandle<TerminalState, TerminalActions> {
  return defineStore({
    init: (): TerminalState => ({ open: false, height: TERMINAL_HEIGHT_DEFAULT }),
    actions: {
      toggle: (d) => { d.open = !d.open },
      open: (d) => { d.open = true },
      close: (d) => { d.open = false },
      setHeight: (d, px: number) => {
        d.height = Math.min(TERMINAL_HEIGHT_MAX, Math.max(TERMINAL_HEIGHT_MIN, Math.round(px)))
      },
    },
  })
}
