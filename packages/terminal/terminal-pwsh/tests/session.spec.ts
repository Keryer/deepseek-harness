import { afterEach, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type { ResolvedConfig } from '@deepseek-ai/dsh-terminal-pwsh/src/config.ts'
import { PwshPtySession } from '@deepseek-ai/dsh-terminal-pwsh/src/session.ts'

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    backendType: 'pwsh', shellPath: 'pwsh.exe', shellArgs: [], rows: 24, cols: 80,
    scrollbackLines: 10, scrollbackMaxBytes: 1000, maxReadBytes: 200,
    startupTimeoutMs: 200, pollIntervalMs: 10, disposeGraceMs: 10,
    ...overrides,
  }
}

interface FakeHandle {
  handle: SubprocessTerminalHandle
  writes: string[]
  resizes: Array<[number, number]>
  emit(data: string): void
  exit(exitCode?: number | null, signal?: NodeJS.Signals | null): void
}

function fakeHandle(): FakeHandle {
  const output = new PassThrough()
  const outcome = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  const writes: string[] = []
  const resizes: Array<[number, number]> = []
  const handle: SubprocessTerminalHandle = {
    pid: 123,
    output,
    done: outcome.promise,
    write: async (data: string) => { writes.push(data) },
    resize: async (cols: number, rows: number) => { resizes.push([cols, rows]) },
    inspectForeground: async () => ({ processGroupId: 123, inputWaiting: false }),
    signalForeground: async () => 123,
    terminate: async () => {
      output.end()
      outcome.resolve({ exitCode: null, signal: 'SIGTERM' })
    },
  }
  return {
    handle,
    writes,
    resizes,
    emit: (data: string) => { output.write(data) },
    exit: (exitCode = 0, signal = null) => {
      output.end()
      outcome.resolve({ exitCode, signal })
    },
  }
}

afterEach(() => { vi.useRealTimers() })

describe('PwshPtySession', () => {
  it('forwards raw writes and resizes and streams raw output including ANSI', async () => {
    const fake = fakeHandle()
    const session = new PwshPtySession(fake.handle, config())
    const chunks: string[] = []
    session.onOutput((text) => { chunks.push(text) })

    fake.emit('\x1b[31mred\x1b[0m\r\n')
    await session.write('input\r')
    await session.resize({ cols: 120, rows: 40 })

    expect(fake.writes).toEqual(['input\r'])
    expect(fake.resizes).toEqual([[120, 40]])
    expect(chunks.join('')).toBe('\x1b[31mred\x1b[0m\r\n')
    await session.close('done')
  })

  it('captures the shell greeting as motd during initialize', async () => {
    const fake = fakeHandle()
    const session = new PwshPtySession(fake.handle, config())
    fake.emit('PS C:\\workspace> ')

    await session.initialize()

    expect(session.motd).toBe('PS C:\\workspace> ')
    await session.close('done')
  })

  it('bounds the startup wait and reports a shell that exited during startup', async () => {
    const fast = config({ startupTimeoutMs: 20, pollIntervalMs: 5 })
    const silent = fakeHandle()
    const silentSession = new PwshPtySession(silent.handle, fast)
    await silentSession.initialize()
    expect(silentSession.motd).toBe('')
    await silentSession.close('done')

    const exited = fakeHandle()
    const exitedSession = new PwshPtySession(exited.handle, fast)
    exited.exit(1)
    await expect(exitedSession.initialize()).rejects.toThrow('exited during startup')
    await exitedSession.close('done')
  })

  it('paginates bounded scrollback and reads the newest tail', () => {
    const fake = fakeHandle()
    const session = new PwshPtySession(fake.handle, config())
    fake.emit('one\ntwo\nthree')

    expect(session.read({})).toEqual({
      text: 'one\ntwo\nthree', totalLines: 3, lineBegin: 0, lineEnd: 3, truncated: false,
    })
    expect(session.read({ offset: 1, count: 1 })).toEqual({
      text: 'two', totalLines: 3, lineBegin: 1, lineEnd: 2, truncated: false,
    })
    expect(session.read({ offset: 99 })).toEqual({
      text: '', totalLines: 3, lineBegin: 99, lineEnd: 99, truncated: false,
    })
    expect(() => session.read({ offset: -1 })).toThrow('offset')
    expect(() => session.read({ count: 0 })).toThrow('count')
  })

  it('refuses line-oriented send and foreground signalling', async () => {
    const fake = fakeHandle()
    const session = new PwshPtySession(fake.handle, config())
    expect(() => session.startSend({ text: '', submit: true })).toThrow('line-oriented send')
    await expect(session.signal('SIGINT')).rejects.toThrow('foreground signalling')
    await session.close('done')
  })

  it('marks the session exited after the top-level process ends', async () => {
    const fake = fakeHandle()
    const session = new PwshPtySession(fake.handle, config())
    const chunks: string[] = []
    session.onOutput((text) => { chunks.push(text) })
    fake.emit('partial')
    fake.exit(7)

    await vi.waitFor(() => { expect(session.status()).toEqual({ kind: 'exited', exitCode: 7, signal: null }) })
    expect(chunks.join('')).toBe('partial')
    await session.close('done')
  })

  it('rejects write after exit and idempotently closes', async () => {
    const fake = fakeHandle()
    const session = new PwshPtySession(fake.handle, config())
    fake.exit(0)
    await vi.waitFor(() => { expect(session.status().kind).toBe('exited') })

    await expect(session.write('late')).rejects.toThrow('has exited')
    const first = session.close('done')
    expect(session.close('done')).toBe(first)
    await first
  })
})
