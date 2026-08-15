/**
 * Sidebar terminal toggle: a footer action in the layout-owned
 * `sidebar.footer.action` list slot, stacked above Settings and styled like the
 * Settings trigger row (icon + label when wide, icon-only rail when collapsed).
 * The open/closed fact lives in the shared terminal store, so this button and
 * the docked panel stay in sync.
 */
import clsx from 'clsx'
import { IconCodeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createTerminalStore } from './stores.ts'
import css from './TerminalLauncher.module.css'

/** Toggle props: the footer-action runtime share plus the terminal store share. */
export type TerminalToggleProps = PropsRuntime<'sidebar.footer.action'> & PropsStore<ReturnType<typeof createTerminalStore>>

/** Sidebar-foot open/close button for the docked terminal panel. */
export function TerminalToggle({ wide, useStore, actions }: TerminalToggleProps) {
  const open = useStore(s => s.open)
  return (
    <button
      type="button"
      className={clsx(css.trigger, !wide && css.rail)}
      aria-expanded={open}
      aria-label={open ? '关闭终端' : '打开终端'}
      onClick={actions.toggle}
    >
      <IconCodeOutline16 size={wide ? 16 : 18} />
      {wide && <span className={css.triggerLabel}>终端</span>}
    </button>
  )
}
