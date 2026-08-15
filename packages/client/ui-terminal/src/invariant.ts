/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-terminal`.
 * @module @deepseek-ai/dsh-client-ui-terminal/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-terminal'

/** Cordis companion plugin name. */
export const name = 'client-ui-terminal-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the launcher is a `shell.overlay` slot registration
 * owned and observed by the slot registry, and this package holds no durable,
 * model-visible, or wire state of its own.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
