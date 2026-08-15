/**
 * React-free terminal output fan-out (`ctx.terminalFeed`): the runtime object
 * layer owns the wire terminal stream and hands each `terminal/output` frame
 * to subscribers. The presentation component (xterm) owns the screen buffer
 * and re-baselines on {@link onReset}, which fires each time a connection
 * generation re-establishes (the stream replays retained scrollback then).
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { RpcRequest, TerminalFrame, SessionId, TerminalSessionId } from '@deepseek-ai/dsh-client-connection/client'

/** One decoded terminal output frame. */
export interface TerminalOutput {
  sessionId: SessionId
  id: TerminalSessionId
  data: string
}

/** Fan-out of live terminal output plus the generation-reset signal. */
export class TerminalFeed extends Service {
  private readonly outputListeners = new Set<(output: TerminalOutput) => void>()
  private readonly resetListeners = new Set<() => void>()

  /** @param ctx - client root context. */
  constructor(ctx: Context) {
    super(ctx, 'terminalFeed')
  }

  /**
   * Route one terminal stream frame to output subscribers.
   * @param envelope - the decoded terminal stream frame.
   */
  handleTerminalEnvelope(envelope: RpcRequest<TerminalFrame>): void {
    const frame = envelope.payload
    if (frame.type !== 'terminal/output') return
    const output: TerminalOutput = { sessionId: frame.sessionId, id: frame.id, data: frame.data }
    for (const listener of this.outputListeners) listener(output)
  }

  /** Signal that a connection generation re-established (subscribers re-baseline). */
  handleConnected(): void {
    for (const listener of this.resetListeners) listener()
  }

  /**
   * Subscribe to live terminal output.
   * @param listener - receives each output frame as it arrives.
   * @returns disposer removing exactly this listener.
   */
  onOutput(listener: (output: TerminalOutput) => void): () => void {
    this.outputListeners.add(listener)
    return () => { this.outputListeners.delete(listener) }
  }

  /**
   * Subscribe to the connection-generation reset signal.
   * @param listener - runs after each re-established generation.
   * @returns disposer removing exactly this listener.
   */
  onReset(listener: () => void): () => void {
    this.resetListeners.add(listener)
    return () => { this.resetListeners.delete(listener) }
  }
}
