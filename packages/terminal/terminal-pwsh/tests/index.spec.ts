import { describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import TerminalSessionService, { TerminalBackendCleanupError, TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import { PwshTerminalBackend } from '@deepseek-ai/dsh-terminal-pwsh'
import * as ptyPwsh from '@deepseek-ai/dsh-terminal-pwsh'
import type { ResolvedConfig } from '@deepseek-ai/dsh-terminal-pwsh/src/config.ts'
import type { PwshPtySession } from '@deepseek-ai/dsh-terminal-pwsh/src/session.ts'

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    backendType: 'pwsh', shellPath: 'pwsh.exe', shellArgs: [], rows: 24, cols: 80,
    scrollbackLines: 10, scrollbackMaxBytes: 1000, maxReadBytes: 200,
    startupTimeoutMs: 200, pollIntervalMs: 10, disposeGraceMs: 10,
    ...overrides,
  }
}

function owner(): Agent {
  return { id: 'agent-1' } as unknown as Agent
}

function spec(overrides: Partial<Parameters<PwshTerminalBackend['spawn']>[0]> = {}) {
  return { sessionId: TerminalSessionId('pty-1'), owner: owner(), type: 'pwsh', ...overrides }
}

function terminalHandle(): SubprocessTerminalHandle {
  const output = new PassThrough()
  return {
    pid: 123,
    output,
    done: Promise.resolve({ exitCode: 0, signal: null }),
    write: async () => {},
    resize: async () => {},
    inspectForeground: async () => ({ processGroupId: 123, inputWaiting: false }),
    signalForeground: async () => 123,
    terminate: async () => { output.end() },
  }
}

class StubSubprocessRuntime extends SubprocessRuntime {
  async resolveExecutable(command: string): Promise<string> { return command }
  spawn(_spec: SubprocessSpawnSpec): SubprocessHandle { throw new Error('unused') }
  async spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return terminalHandle()
  }
}

function stubSession(initialize: () => Promise<void> = () => Promise.resolve()): PwshPtySession {
  return { initialize } as unknown as PwshPtySession
}

describe('PwshTerminalBackend spawn', () => {
  it('rejects pre-aborted setup', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSubprocessRuntime)
    const backend = new PwshTerminalBackend(ctx, config(), () => 'pwsh.exe', async () => terminalHandle())
    const controller = new AbortController()
    const abortReason = new Error('spawn aborted')
    controller.abort(abortReason)
    await expect(backend.spawn(spec({ signal: controller.signal }))).rejects.toBe(abortReason)
  })

  it('spawns pwsh with the session cwd and environment and returns the initialized session', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSubprocessRuntime)
    const terminal = terminalHandle()
    let spawned: SubprocessTerminalSpawnSpec | undefined
    const spawnTerminal = async (spawnSpec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> => {
      spawned = spawnSpec
      return terminal
    }
    const initialized = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const backend = new PwshTerminalBackend(
      ctx,
      config({ shellArgs: ['-NoLogo'] }),
      () => 'C:\\pwsh\\pwsh.exe',
      spawnTerminal,
      () => stubSession(initialized),
    )
    expect(await backend.spawn(spec({ cwd: 'C:\\work' }))).toBeTruthy()

    expect(spawned).toMatchObject({
      argv: ['C:\\pwsh\\pwsh.exe', '-NoLogo'],
      cwd: 'C:\\work',
      cols: 80,
      rows: 24,
      graceMs: 10,
      env: {
        TERM: 'xterm-256color', DSH_SHELL: '1', DSH_SESSION_ID: 'agent-1', DSH_PTY_SESSION_ID: 'pty-1',
      },
    })
    expect(initialized).toHaveBeenCalledWith(undefined)
  })

  it('resolves an empty shellPath through the injected resolver', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSubprocessRuntime)
    let spawned: SubprocessTerminalSpawnSpec | undefined
    const backend = new PwshTerminalBackend(
      ctx,
      config({ shellPath: '' }),
      () => 'C:\\pwsh\\pwsh.exe',
      async (spawnSpec) => { spawned = spawnSpec; return terminalHandle() },
      () => stubSession(),
    )
    await backend.spawn(spec())
    expect(spawned?.argv).toEqual(['C:\\pwsh\\pwsh.exe'])
  })

  it('rejects an unresolvable shell path at construction', () => {
    expect(() => new PwshTerminalBackend(new Context(), config(), () => '')).toThrow(
      'could not resolve a PowerShell executable',
    )
  })

  it('closes failed startup and aggregates cleanup failure', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSubprocessRuntime)
    const spawnTerminal = async (): Promise<SubprocessTerminalHandle> => terminalHandle()

    const closed = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const failed = { initialize: () => Promise.reject(new Error('startup failed')), close: closed } as unknown as PwshPtySession
    const backend = new PwshTerminalBackend(ctx, config(), () => 'pwsh.exe', spawnTerminal, () => failed)
    await expect(backend.spawn(spec())).rejects.toThrow('startup failed')
    expect(closed).toHaveBeenCalledWith('PTY startup failed')

    const startupFailure = new Error('startup failed')
    const cleanupFailure = new Error('cleanup failed')
    const doublyFailed = {
      initialize: () => Promise.reject(startupFailure),
      close: () => Promise.reject(cleanupFailure),
    } as unknown as PwshPtySession
    const aggregate = new PwshTerminalBackend(ctx, config(), () => 'pwsh.exe', spawnTerminal, () => doublyFailed)
    await expect(aggregate.spawn(spec())).rejects.toEqual(expect.objectContaining({
      name: 'TerminalBackendCleanupError',
      spawnError: startupFailure,
      cleanupError: cleanupFailure,
    } satisfies Partial<TerminalBackendCleanupError>))
  })

  it('forwards terminal allocation cancellation directly', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSubprocessRuntime)
    const controller = new AbortController()
    const seen = Promise.withResolvers<AbortSignal>()
    const backend = new PwshTerminalBackend(
      ctx,
      config(),
      () => 'pwsh.exe',
      async spawnSpec => await new Promise<SubprocessTerminalHandle>((_resolve, reject) => {
        const setupSignal = spawnSpec.signal as AbortSignal
        seen.resolve(setupSignal)
        const onAbort = (): void => {
          reject(setupSignal.reason instanceof Error ? setupSignal.reason : new Error(String(setupSignal.reason)))
        }
        setupSignal.addEventListener('abort', onAbort, { once: true })
      }),
      () => stubSession(),
    )
    const spawning = backend.spawn(spec({ signal: controller.signal }))
    const setupSignal = await seen.promise
    const reason = new Error('cancel pending allocation')
    controller.abort(reason)
    await expect(spawning).rejects.toBe(reason)
    expect(setupSignal.aborted).toBe(true)
  })

  it('initializes with the caller signal when one is provided', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSubprocessRuntime)
    const controller = new AbortController()
    const initialized = vi.fn<(signal?: AbortSignal) => Promise<void>>().mockResolvedValue(undefined)
    const backend = new PwshTerminalBackend(
      ctx,
      config(),
      () => 'pwsh.exe',
      async () => terminalHandle(),
      () => stubSession(initialized),
    )
    await backend.spawn(spec({ signal: controller.signal }))
    expect(initialized).toHaveBeenCalledWith(controller.signal)
  })

  it('spawns through the default resolver and session factory', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSubprocessRuntime)
    const backend = new PwshTerminalBackend(ctx, config())
    const created = await backend.spawn(spec())
    expect(created.motd).toBe('')
    await created.close('done')
  })

  it('resolves an empty shellPath through the default resolver', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSubprocessRuntime)
    let spawned: SubprocessTerminalSpawnSpec | undefined
    const backend = new PwshTerminalBackend(
      ctx,
      config({ shellPath: '' }),
      undefined,
      async (spawnSpec) => { spawned = spawnSpec; return terminalHandle() },
      () => stubSession(),
    )
    await backend.spawn(spec())
    expect(spawned?.argv[0]).toBeTruthy()
  })

  it('starts startup rollback when cancellation wins a stalled initialization', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSubprocessRuntime)
    const initialization = Promise.withResolvers<undefined>()
    const initializationStarted = Promise.withResolvers<undefined>()
    const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const session = {
      initialize: () => {
        initializationStarted.resolve(undefined)
        return initialization.promise
      },
      close,
    } as unknown as PwshPtySession
    const backend = new PwshTerminalBackend(
      ctx,
      config(),
      () => 'pwsh.exe',
      async () => terminalHandle(),
      () => session,
    )
    const controller = new AbortController()
    const reason = new Error('cancel stalled startup')

    const spawning = backend.spawn(spec({ signal: controller.signal }))
    await initializationStarted.promise
    controller.abort(reason)

    await expect(spawning).rejects.toBe(reason)
    expect(close).toHaveBeenCalledWith('PTY startup failed')
    initialization.resolve(undefined)
  })
})

describe('terminal-pwsh plugin shape', () => {
  it('keeps name, inject, and Config through Loader unwrapExports', () => {
    expect('default' in ptyPwsh).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(ptyPwsh) as Record<string, unknown>
    expect(unwrapped.name).toBe('terminal-pwsh')
    expect(unwrapped.inject).toEqual(['terminals', 'subprocess'])
    expect(unwrapped.Config).toBeDefined()
  })

  it('validates config and registers the configured backend', async () => {
    const ctx = new Context()
    await ctx.plugin(TerminalSessionService)
    await ctx.plugin(StubSubprocessRuntime)
    const fiber = await ctx.plugin(ptyPwsh, config())
    expect(ctx.terminals.listBackends()).toEqual(['pwsh'])
    await fiber.dispose()
    expect(ctx.terminals.listBackends()).toEqual([])
  })
})
