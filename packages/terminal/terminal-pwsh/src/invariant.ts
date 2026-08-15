/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-terminal-pwsh`.
 * @module @deepseek-ai/dsh-terminal-pwsh/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-terminal-pwsh'

/** Cordis companion plugin name. */
export const name = 'terminal-pwsh-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the backend publishes no independent lifecycle stream
 * or snapshot; terminal buffers and process state are private per-session
 * implementation state owned by the subprocess seam.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
