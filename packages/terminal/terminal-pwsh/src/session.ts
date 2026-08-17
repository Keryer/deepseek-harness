/**
 * Human-terminal PTY session over the subprocess seam's terminal primitive.
 * Output is passed through as raw UTF-8 (no ANSI stripping) so xterm renders
 * colors and cursor control exactly as the shell emits them; unlike the POSIX
 * `terminal-bash` backend, this session serves no model-facing line-oriented
 * consumer, so `startSend` and `signal` refuse rather than half-support the
 * POSIX readiness contract.
 */

import { Buffer } from 'node:buffer'
import type {
  SubprocessOutcome,
  SubprocessTerminalHandle,
} from '@deepseek-ai/dsh-subprocess'
import type {
  TerminalBackendSession,
  TerminalReadRequest,
  TerminalReadResult,
  TerminalResizeRequest,
  TerminalSendOperation,
  TerminalSendRequest,
  TerminalSessionStatus,
  TerminalSignal,
  TerminalSignalResult,
} from '@deepseek-ai/dsh-terminal'
import type { ResolvedConfig } from './config.ts'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function utf8Tail(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text) <= maxBytes) return { text, truncated: false }
  const chars = Array.from(text)
  let bytes = 0
  let start = chars.length
  while (start > 0) {
    const next = Buffer.byteLength(chars[start - 1] as string)
    if (bytes + next > maxBytes) break
    bytes += next
    start -= 1
  }
  return { text: chars.slice(start).join(''), truncated: true }
}

class BoundedTextBuffer {
  private value = ''
  private dropped = false

  constructor(
    private readonly maxBytes: number,
    private readonly maxLines?: number,
  ) {}

  append(text: string): void {
    /* v8 ignore next -- appendOutput already drops empty chunks before this buffer. */
    if (text.length === 0) return
    this.value += text
    /* v8 ignore next -- the session always passes its bounded scrollback line count. */
    if (this.maxLines !== undefined) {
      const lines = this.value.split('\n')
      if (lines.length > this.maxLines) {
        this.value = lines.slice(lines.length - this.maxLines).join('\n')
        this.dropped = true
      }
    }
    const tail = utf8Tail(this.value, this.maxBytes)
    this.value = tail.text
    this.dropped ||= tail.truncated
  }

  snapshot(): { text: string; truncated: boolean } {
    return { text: this.value, truncated: this.dropped }
  }
}

/** Backend session wrapping one provider-owned terminal process. */
export class PwshPtySession implements TerminalBackendSession {
  motd = ''
  readonly pid: number
  private readonly decoder = new TextDecoder()
  private readonly scrollback: BoundedTextBuffer
  private readonly outputListeners = new Set<(text: string) => void>()
  private readonly outputEnded = Promise.withResolvers<void>()
  private readonly completion: Promise<void>
  private statusValue: TerminalSessionStatus = { kind: 'running' }
  private closing = false
  private closePromise: Promise<void> | undefined
  private transportFailure: Error | undefined

  constructor(
    private readonly terminal: SubprocessTerminalHandle,
    private readonly config: ResolvedConfig,
  ) {
    this.pid = terminal.pid
    this.scrollback = new BoundedTextBuffer(config.scrollbackMaxBytes, config.scrollbackLines)
    terminal.output.on('data', this.onTerminalData)
    terminal.output.once('end', this.onTerminalEnd)
    terminal.output.once('error', this.onTerminalError)
    this.completion = terminal.done.then(
      outcome => this.onExit(outcome),
      (error: unknown) => { this.onTransportFailure(error) },
    )
  }

  /**
   * Wait for the shell's first output so `open` carries a bounded motd and an
   * early exit is detected before publication. Live output after publication
   * rides the `onOutput` stream, so the motd need not capture the full prompt.
   * @param signal - optional cancellation while the shell produces its greeting.
   */
  async initialize(signal?: AbortSignal): Promise<void> {
    const startedAt = Date.now()
    while (this.scrollback.snapshot().text.length === 0 && this.statusValue.kind === 'running' && !this.closing) {
      signal?.throwIfAborted()
      if (Date.now() - startedAt >= this.config.startupTimeoutMs) break
      await delay(this.config.pollIntervalMs)
    }
    signal?.throwIfAborted()
    if (this.statusValue.kind === 'exited') throw new Error('PTY shell exited during startup')
    this.motd = this.scrollback.snapshot().text
  }

  startSend(_request: TerminalSendRequest): TerminalSendOperation {
    throw new Error('terminal-pwsh: line-oriented send requires the POSIX bash PTY backend')
  }

  async write(text: string): Promise<void> {
    if (this.closing) throw new Error('PTY session is closing')
    if (this.statusValue.kind === 'exited') throw new Error('PTY session has exited')
    await this.terminal.write(text)
  }

  async resize(request: TerminalResizeRequest): Promise<void> {
    if (this.closing) throw new Error('PTY session is closing')
    await this.terminal.resize(request.cols, request.rows)
  }

  read(request: TerminalReadRequest): TerminalReadResult {
    const snapshot = this.scrollback.snapshot()
    const lines = snapshot.text.split('\n')
    const totalLines = snapshot.text.length === 0 ? 0 : lines.length
    const offset = request.offset ?? 0
    const count = request.count ?? 500
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('PTY read offset must be a non-negative safe integer')
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error('PTY read count must be a positive safe integer')
    if (offset >= totalLines) {
      return { text: '', totalLines, lineBegin: offset, lineEnd: offset, truncated: snapshot.truncated }
    }
    const end = totalLines - offset
    const start = Math.max(0, end - count)
    const requested = lines.slice(start, end).join('\n')
    const bounded = utf8Tail(requested, this.config.maxReadBytes)
    /* v8 ignore next -- requested is never empty once offset is within totalLines. */
    const returnedLines = bounded.text.length === 0 ? 0 : bounded.text.split('\n').length
    return {
      text: bounded.text,
      totalLines,
      lineBegin: offset,
      lineEnd: offset + returnedLines,
      truncated: snapshot.truncated || bounded.truncated,
    }
  }

  onOutput(listener: (text: string) => void): () => void {
    this.outputListeners.add(listener)
    return () => { this.outputListeners.delete(listener) }
  }

  signal(_signal: TerminalSignal): Promise<TerminalSignalResult> {
    return Promise.reject(new Error('terminal-pwsh: foreground signalling is unsupported; write \\x03 for Ctrl+C'))
  }

  status(): TerminalSessionStatus {
    return this.statusValue
  }

  close(reason: string): Promise<void> {
    this.closing = true
    if (this.closePromise !== undefined) return this.closePromise
    const closing = this.closeOnce(reason).catch((error: unknown) => {
      this.closePromise = undefined
      throw error
    })
    this.closePromise = closing
    return closing
  }

  private readonly onTerminalData = (chunk: Buffer | Uint8Array | string): void => {
    /* v8 ignore next -- the local handle always emits Buffers; the string arm covers remote transports. */
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    this.appendOutput(this.decoder.decode(bytes, { stream: true }))
  }

  private readonly onTerminalEnd = (): void => {
    this.appendOutput(this.decoder.decode())
    this.outputEnded.resolve()
  }

  private readonly onTerminalError = (error: Error): void => {
    this.onTransportFailure(error)
    this.outputEnded.resolve()
  }

  private appendOutput(text: string): void {
    if (text.length === 0) return
    this.scrollback.append(text)
    for (const listener of this.outputListeners) listener(text)
  }

  private async onExit(outcome: SubprocessOutcome): Promise<void> {
    await this.outputEnded.promise
    if (this.transportFailure !== undefined) return
    this.statusValue = { kind: 'exited', exitCode: outcome.exitCode, signal: outcome.signal }
  }

  private onTransportFailure(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error))
    this.transportFailure ??= failure
    this.statusValue = { kind: 'exited', exitCode: null, signal: null }
    void this.terminal.terminate().catch(() => {})
  }

  private async closeOnce(reason: string): Promise<void> {
    try {
      await this.terminal.terminate()
    } catch (error: unknown) {
      throw new Error(`PTY cleanup failed (${reason})`, { cause: error })
    }
    await this.completion
    this.terminal.output.off('data', this.onTerminalData)
    this.terminal.output.off('end', this.onTerminalEnd)
    this.terminal.output.off('error', this.onTerminalError)
    if (this.transportFailure !== undefined) throw this.transportFailure
  }
}
