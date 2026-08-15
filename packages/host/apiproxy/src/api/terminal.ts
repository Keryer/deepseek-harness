/**
 * terminal domain contract: the human-facing embedded terminal surface.
 * Unary methods mirror the owner-scoped PTY seam over the wire, keyed by
 * `sessionId`; the host resolves the exact owning Agent before each call.
 * Wire ids and unions are self-contained here so this contract stays
 * browser-importable without dragging the host-side PTY seam in.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcError, RpcRequest, RpcResponse } from './rpc.ts'

/** Wire terminal session id (host-minted, opaque to the client). */
export type TerminalSessionId = string

/** Wire top-level PTY process status. */
export type TerminalSessionStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: string | null }

/** Wire reason one send returned control to its caller. */
export type TerminalWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'

/** Wire permitted terminal signal. */
export type TerminalSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP'

/** Request to open one terminal for a session. */
export interface TerminalOpenRequest {
  sessionId: SessionId
  /** Backend type; omitted, the deployment's sole or default backend applies. */
  type?: string
  /** Optional initial working directory. */
  cwd?: string
  /** Optional owner-local display name. */
  name?: string
}

/** One terminal as the client sees it. */
export interface TerminalSessionView {
  /** Host-minted terminal id, echoed back on every operation. */
  id: TerminalSessionId
  /** Optional owner-local display name. */
  name?: string
  /** Backend type that created the session. */
  type: string
  /** Top-level process id when the backend has one. */
  pid?: number
  /** Current top-level process status. */
  status: TerminalSessionStatus
  /** Initial bounded output; present on `open`, absent from `list`. */
  motd?: string
}

/** Request to write one line-oriented input and wait for readiness. */
export interface TerminalSendRequest {
  sessionId: SessionId
  id: TerminalSessionId
  text: string
  submit: boolean
}

/** Settled result of one terminal send. */
export interface TerminalSendResult {
  viewport: string
  waitReason: TerminalWaitReason
  sessionStatus: TerminalSessionStatus
  truncated: boolean
}

/** Request for one bounded scrollback page. */
export interface TerminalReadRequest {
  sessionId: SessionId
  id: TerminalSessionId
  offset?: number
  count?: number
}

/** Wire bounded scrollback page. */
export interface TerminalReadResult {
  text: string
  totalLines: number
  lineBegin: number
  lineEnd: number
  truncated: boolean
}

/** Request to write raw text to the terminal input without a readiness wait. */
export interface TerminalWriteRequest {
  sessionId: SessionId
  id: TerminalSessionId
  text: string
}

/** Request to resize the terminal grid. */
export interface TerminalResizeRequest {
  sessionId: SessionId
  id: TerminalSessionId
  cols: number
  rows: number
}

/** Request to signal the foreground process group. */
export interface TerminalSignalRequest {
  sessionId: SessionId
  id: TerminalSessionId
  signal: TerminalSignal
}

/** Request to close one terminal. */
export interface TerminalCloseRequest {
  sessionId: SessionId
  id: TerminalSessionId
}

/** Request to list a session's terminals. */
export interface TerminalListRequest {
  sessionId: SessionId
}

/** One terminal stream frame (live output or a stream-level failure). */
export type TerminalFrame =
  | { type: 'terminal/output'; sessionId: SessionId; id: TerminalSessionId; data: string }
  | { type: 'stream/error'; error: RpcError }

/** Terminal-domain unary methods (the map keys `terminal.*` of `RpcMethodMap`). */
export interface TerminalApi {
  open(request: RpcRequest<TerminalOpenRequest>): Promise<RpcResponse<TerminalSessionView>>
  send(request: RpcRequest<TerminalSendRequest>): Promise<RpcResponse<TerminalSendResult>>
  read(request: RpcRequest<TerminalReadRequest>): Promise<RpcResponse<TerminalReadResult>>
  write(request: RpcRequest<TerminalWriteRequest>): Promise<RpcResponse<{ accepted: true }>>
  resize(request: RpcRequest<TerminalResizeRequest>): Promise<RpcResponse<{ accepted: true }>>
  signal(request: RpcRequest<TerminalSignalRequest>): Promise<RpcResponse<{ targetPgid: number }>>
  close(request: RpcRequest<TerminalCloseRequest>): Promise<RpcResponse<{ closed: boolean }>>
  list(request: RpcRequest<TerminalListRequest>): Promise<RpcResponse<{ sessions: TerminalSessionView[] }>>
  /**
   * All-session terminal output stream. On open it replays each live session's
   * retained scrollback and then pushes new sanitized output as it arrives;
   * frames carry their session and terminal ids for client-side filtering.
   */
  stream(request: RpcRequest<{}>, signal: AbortSignal): AsyncIterable<RpcRequest<TerminalFrame>>
}
