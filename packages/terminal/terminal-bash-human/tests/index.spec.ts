import { describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import TerminalSessionService, { TerminalBackendCleanupError, TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import * as ptyHuman from '@deepseek-ai/dsh-terminal-bash-human'
import { BashHumanTerminalBackend } from '@deepseek-ai/dsh-terminal-bash-human'
import type { ResolvedConfig } from '@deepseek-ai/dsh-terminal-bash-human/src/config.ts'
import type { BashHumanPtySession } from '@deepseek-ai/dsh-terminal-bash-human/src/session.ts'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

function config(): ResolvedConfig {
  return {
    backendType: 'bash-human', shellPath: '/bin/bash', shellArgs: ['-i'], rows: 24, cols: 80,
    scrollbackLines: 10, scrollbackMaxBytes: 100, maxReadBytes: 50,
    startupTimeoutMs: 100, pollIntervalMs: 10, disposeGraceMs: 10,
  }
}

function agent(ctx: Context): Agent {
  return { id: SessionId('agent'), ctx } as unknown as Agent
}

function spec(owner: Agent, signal?: AbortSignal) {
  return {
    sessionId: TerminalSessionId('pty-1'), owner, type: 'bash-human',
    ...signal !== undefined ? { signal } : {},
  }
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

describe('BashHumanTerminalBackend', () => {
  it('rejects a pre-aborted spawn', async () => {
    const ctx = new Context()
    const backend = new BashHumanTerminalBackend(ctx, config(), async () => terminalHandle())
    const controller = new AbortController()
    const reason = new Error('spawn aborted')
    controller.abort(reason)
    await expect(backend.spawn(spec(agent(ctx), controller.signal))).rejects.toBe(reason)
  })

  it('closes failed startup and aggregates cleanup failure', async () => {
    const ctx = new Context()
    const closed = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const failed = { initialize: () => Promise.reject(new Error('startup failed')), close: closed } as unknown as BashHumanPtySession
    const backend = new BashHumanTerminalBackend(ctx, config(), async () => terminalHandle(), () => failed)
    await expect(backend.spawn(spec(agent(ctx)))).rejects.toThrow('startup failed')
    expect(closed).toHaveBeenCalledWith('PTY startup failed')

    const startupFailure = new Error('startup failed')
    const cleanupFailure = new Error('cleanup failed')
    const doublyFailed = {
      initialize: () => Promise.reject(startupFailure),
      close: () => Promise.reject(cleanupFailure),
    } as unknown as BashHumanPtySession
    const aggregate = new BashHumanTerminalBackend(ctx, config(), async () => terminalHandle(), () => doublyFailed)
    await expect(aggregate.spawn(spec(agent(ctx)))).rejects.toEqual(expect.objectContaining({
      name: 'TerminalBackendCleanupError',
      spawnError: startupFailure,
      cleanupError: cleanupFailure,
    } satisfies Partial<TerminalBackendCleanupError>))
  })

  it('starts startup rollback when cancellation wins a stalled initialization', async () => {
    const ctx = new Context()
    const initialization = Promise.withResolvers<undefined>()
    const initializationStarted = Promise.withResolvers<undefined>()
    const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const session = {
      initialize: () => {
        initializationStarted.resolve(undefined)
        return initialization.promise
      },
      close,
    } as unknown as BashHumanPtySession
    const backend = new BashHumanTerminalBackend(ctx, config(), async () => terminalHandle(), () => session)
    const controller = new AbortController()
    const reason = new Error('cancel stalled startup')

    const spawning = backend.spawn(spec(agent(ctx), controller.signal))
    await initializationStarted.promise
    controller.abort(reason)

    await expect(spawning).rejects.toBe(reason)
    expect(close).toHaveBeenCalledWith('PTY startup failed')
    initialization.resolve(undefined)
  })

  it('spawns bash with the xterm terminal name and returns initialized sessions', async () => {
    const ctx = new Context()
    let spawned: SubprocessTerminalSpawnSpec | undefined
    const spawnTerminal = async (spawnSpec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> => {
      spawned = spawnSpec
      return terminalHandle()
    }
    const initialized = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const session = { initialize: initialized } as unknown as BashHumanPtySession
    const backend = new BashHumanTerminalBackend(ctx, config(), spawnTerminal, () => session)

    expect(await backend.spawn({ ...spec(agent(ctx)), cwd: '/work' })).toBe(session)

    expect(spawned).toMatchObject({
      argv: ['/bin/bash', '-i'],
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: '/work',
      graceMs: 10,
      env: { TERM: 'xterm-256color', DSH_SHELL: '1', DSH_SESSION_ID: 'agent', DSH_PTY_SESSION_ID: 'pty-1' },
    })
    expect(initialized).toHaveBeenCalledWith(undefined)
  })

  it('initializes with the caller signal when one is provided', async () => {
    const ctx = new Context()
    const controller = new AbortController()
    const initialized = vi.fn<(signal?: AbortSignal) => Promise<void>>().mockResolvedValue(undefined)
    const session = { initialize: initialized } as unknown as BashHumanPtySession
    const backend = new BashHumanTerminalBackend(ctx, config(), async () => terminalHandle(), () => session)
    await backend.spawn(spec(agent(ctx), controller.signal))
    expect(initialized).toHaveBeenCalledWith(controller.signal)
  })

  it('spawns through the default subprocess terminal and session factories', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSubprocessRuntime)
    const backend = new BashHumanTerminalBackend(ctx, config())
    const created = await backend.spawn(spec(agent(ctx)))
    expect(created.motd).toBe('')
    await created.close('done')
  })
})

describe('terminal-bash-human plugin shape', () => {
  it('keeps name, inject, and Config through Loader unwrapExports', () => {
    expect('default' in ptyHuman).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(ptyHuman) as Record<string, unknown>
    expect(unwrapped.name).toBe('terminal-bash-human')
    expect(unwrapped.inject).toEqual(['terminals', 'subprocess'])
    expect(unwrapped.Config).toBeDefined()
  })

  it('validates config and registers the configured backend', async () => {
    const ctx = new Context()
    await ctx.plugin(TerminalSessionService)
    await ctx.plugin(StubSubprocessRuntime)
    const fiber = await ctx.plugin(ptyHuman, config())
    expect(ctx.terminals.listBackends()).toEqual(['bash-human'])
    await fiber.dispose()
    expect(ctx.terminals.listBackends()).toEqual([])
  })
})
