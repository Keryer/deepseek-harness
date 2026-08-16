/**
 * Human embedded-terminal PTY backend over the user's login shell. Registered
 * under type `bash-human` for POSIX compositions: it spawns the login shell
 * (`$SHELL`, falling back to `/bin/zsh` on macOS and `/bin/bash` elsewhere)
 * through the subprocess terminal primitive, streams raw UTF-8 output for
 * xterm, and forwards raw writes, resizes, and teardown. The model-facing
 * line-oriented surface stays on the sibling `terminal-bash` backend under
 * type `shell`.
 * @module @deepseek-ai/dsh-terminal-bash-human
 */

import { Context } from '@deepseek-ai/cordis'
import { TerminalBackendCleanupError } from '@deepseek-ai/dsh-terminal'
import type { TerminalBackend, TerminalBackendSpawnSpec } from '@deepseek-ai/dsh-terminal'
import type { SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { type Config, type ResolvedConfig, validateConfig } from './config.ts'
import { BashHumanPtySession } from './session.ts'

export { Config } from './config.ts'
export type { Config as TerminalBashHumanConfig } from './config.ts'

/** Cordis plugin name. */
export const name = 'terminal-bash-human'
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

/**
 * Resolve the default interactive shell: the user's login shell when `$SHELL`
 * names one, otherwise the platform default (zsh on macOS, bash elsewhere).
 * @returns an absolute shell path, or '' when none can be derived.
 */
function defaultShellPath(): string {
  const shell = process.env.SHELL
  if (shell !== undefined && shell.length > 0) return shell
  /* v8 ignore next -- the OS-specific fallback is exercised by real composition per platform. */
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}

async function initializeSession(session: BashHumanPtySession, signal?: AbortSignal): Promise<void> {
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

/** Bash backend registered under the configured type. */
export class BashHumanTerminalBackend implements TerminalBackend {
  readonly type: string
  private readonly shellPath: string

  constructor(
    ctx: Context,
    private readonly config: ResolvedConfig,
    resolveShell: () => string = () => config.shellPath.length > 0 ? config.shellPath : defaultShellPath(),
    private readonly spawnTerminal: (
      spec: SubprocessTerminalSpawnSpec,
    ) => Promise<SubprocessTerminalHandle> = spec => ctx.subprocess.spawnTerminal(spec),
    private readonly createSession: (
      terminal: SubprocessTerminalHandle,
      config: ResolvedConfig,
    ) => BashHumanPtySession = (terminal, config) => new BashHumanPtySession(terminal, config),
  ) {
    this.type = config.backendType
    this.shellPath = resolveShell()
    if (this.shellPath.length === 0) throw new Error('terminal-bash-human: could not resolve a shell executable')
  }

  async spawn(spec: TerminalBackendSpawnSpec): Promise<BashHumanPtySession> {
    spec.signal?.throwIfAborted()
    const terminal = await this.spawnTerminal({
      argv: [this.shellPath, ...this.config.shellArgs],
      cwd: spec.cwd ?? process.cwd(),
      env: childEnvironment(spec),
      name: 'xterm-256color',
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

/** Register the bash human-terminal PTY backend. */
export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  ctx.terminals.registerBackend(new BashHumanTerminalBackend(ctx, config))
}
