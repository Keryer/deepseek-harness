import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { RpcRequest, SessionId, TerminalFrame } from '@deepseek-ai/dsh-client-connection/client'
import { RpcId } from '@deepseek-ai/dsh-client-connection/client'
import { TerminalFeed } from '../src/client/terminal-feed.ts'

function frame(payload: TerminalFrame): RpcRequest<TerminalFrame> {
  return { rpcId: RpcId('f1'), payload }
}

describe('TerminalFeed', () => {
  it('fans terminal/output frames to subscribers, ignores other frames, and honors disposal', () => {
    const feed = new TerminalFeed(new Context())
    const seen: string[] = []
    const off = feed.onOutput((output) => { seen.push(`${output.sessionId}:${output.id}:${output.data}`) })
    feed.handleTerminalEnvelope(frame({ type: 'terminal/output', sessionId: 's1' as SessionId, id: 'p1', data: 'hi' }))
    feed.handleTerminalEnvelope(frame({ type: 'stream/error', error: { code: 'internal', message: 'x', details: {} } }))
    expect(seen).toEqual(['s1:p1:hi'])
    off()
    feed.handleTerminalEnvelope(frame({ type: 'terminal/output', sessionId: 's1' as SessionId, id: 'p1', data: 'ignored' }))
    expect(seen).toEqual(['s1:p1:hi'])
  })

  it('signals a reset on every handleConnected and honors disposal', () => {
    const feed = new TerminalFeed(new Context())
    let resets = 0
    const off = feed.onReset(() => { resets += 1 })
    feed.handleConnected()
    expect(resets).toBe(1)
    off()
    feed.handleConnected()
    expect(resets).toBe(1)
  })
})
