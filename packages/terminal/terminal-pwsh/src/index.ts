/**
 * Human embedded-terminal PTY backend over PowerShell. Registered under type
 * `pwsh` for Windows compositions: it spawns the platform PowerShell through
 * the subprocess terminal primitive (node-pty ConPTY on Windows), streams raw
 * UTF-8 output for xterm, and forwards raw writes, resizes, and teardown. The
 * model-facing line-oriented terminal surface stays POSIX-only.
 * @module @deepseek-ai/dsh-terminal-pwsh
 */

import { Context } from '@deepseek-ai/cordis'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import { TerminalBackendCleanupError } from '@deepseek-ai/dsh-terminal'
import type { TerminalBackend, TerminalBackendSpawnSpec } from '@deepseek-ai/dsh-terminal'
import type { SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { type Config, type ResolvedConfig, validateConfig } from './config.ts'
import { PwshPtySession } from './session.ts'

export { Config } from './config.ts'
export type { Config as TerminalPwshConfig } from './config.ts'

/** Cordis plugin name. */
export const name = 'terminal-pwsh'
/** Required services: PTY registry and the process substrate. */
export const inject = ['terminals', 'subprocess']

/** Terminal-specific environment layered after the provider's ambient scrub. */
function childEnvironment(spec: TerminalBackendSpawnSpec): Record<string, string> {
  return {
    TERM: 'xterm-256color',
    DSH_SHELL: '1',
    DSH_SESSION_ID: spec.owner.id,
    DSH_PTY_SESSION_ID: spec.sessionId,
  }
}

async function initializeSession(session: PwshPtySession, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) {
    await session.initialize(signal)
    return
  }
  const aborted = Promise.withResolvers<never>()
  const onAbort = (): void => { aborted.reject(signal.reason) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    signal.throwIfAborted()
    await Promise.race([session.initialize(signal), aborted.promise])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** PowerShell backend registered under the configured type. */
export class PwshTerminalBackend implements TerminalBackend {
  readonly type: string
  private readonly shellPath: string

  constructor(
    ctx: Context,
    private readonly config: ResolvedConfig,
    resolveShell: () => string = () =>
      resolvePwshPath(config.shellPath === '' ? undefined : config.shellPath),
    private readonly spawnTerminal: (
      spec: SubprocessTerminalSpawnSpec,
    ) => Promise<SubprocessTerminalHandle> = spec => ctx.subprocess.spawnTerminal(spec),
    private readonly createSession: (
      terminal: SubprocessTerminalHandle,
      config: ResolvedConfig,
    ) => PwshPtySession = (terminal, config) => new PwshPtySession(terminal, config),
  ) {
    this.type = config.backendType
    this.shellPath = resolveShell()
    if (this.shellPath.length === 0) throw new Error('terminal-pwsh: could not resolve a PowerShell executable')
  }

  async spawn(spec: TerminalBackendSpawnSpec): Promise<PwshPtySession> {
    spec.signal?.throwIfAborted()
    const terminal = await this.spawnTerminal({
      argv: [this.shellPath, ...this.config.shellArgs],
      cwd: spec.cwd ?? process.cwd(),
      env: childEnvironment(spec),
      rows: this.config.rows,
      cols: this.config.cols,
      graceMs: this.config.disposeGraceMs,
      signal: spec.signal,
    })
    const session = this.createSession(terminal, this.config)
    try {
      await initializeSession(session, spec.signal)
      return session
    } catch (error) {
      try {
        await session.close('PTY startup failed')
      } catch (closeError: unknown) {
        throw new TerminalBackendCleanupError(error, closeError)
      }
      throw error
    }
  }
}

/** Register the PowerShell PTY backend. */
export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  ctx.terminals.registerBackend(new PwshTerminalBackend(ctx, config))
}
