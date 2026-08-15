/**
 * Floating terminal toggle: a button in the layout-owned `shell.overlay` list
 * slot that opens and closes the docked panel. The open/closed fact lives in
 * the shared terminal store, so this button and the docked panel stay in sync.
 */
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createTerminalStore } from './stores.ts'
import css from './TerminalLauncher.module.css'

/** Toggle props: the overlay runtime share plus the terminal store share. */
export type TerminalToggleProps = PropsRuntime<'shell.overlay'> & PropsStore<ReturnType<typeof createTerminalStore>>

/** Floating open/close button for the docked terminal panel. */
export function TerminalToggle({ useStore, actions }: TerminalToggleProps) {
  const open = useStore(s => s.open)
  return (
    <button
      type="button"
      className={css.launcher}
      aria-expanded={open}
      aria-label={open ? '关闭终端' : '打开终端'}
      onClick={actions.toggle}
    >
      终端
    </button>
  )
}
