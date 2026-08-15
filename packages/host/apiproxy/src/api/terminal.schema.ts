/**
 * terminal domain zod schemas: the request and value schemas behind the
 * `terminal.*` unary routes. Brand casts are the only places a wire string
 * becomes a host brand.
 */

import { z } from 'zod'
import { sessionIdSchema } from './sessions.schema.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { rpcErrorSchema } from './rpc.schema.ts'
import type { TerminalFrame, TerminalSessionStatus } from './terminal.ts'

/** Wire terminal session id: non-empty opaque string. */
const terminalIdSchema = z.string().min(1)

/** Wire top-level PTY process status. */
const terminalSessionStatusSchema = z.union([
  z.object({ kind: z.literal('running') }),
  z.object({ kind: z.literal('exited'), exitCode: z.number().nullable(), signal: z.string().nullable() }),
]) as z.ZodType<Wire<TerminalSessionStatus>>

/** One terminal as the client sees it (shared by open and list). */
const terminalSessionViewSchema = z.object({
  id: terminalIdSchema,
  name: z.string().min(1).optional(),
  type: z.string().min(1),
  pid: z.number().int().positive().optional(),
  status: terminalSessionStatusSchema,
  motd: z.string().optional(),
})

/** Request schema for `terminal.open`. */
export const terminalOpenRequestSchema = z.object({
  sessionId: sessionIdSchema,
  type: z.string().min(1).optional(),
  cwd: z.string().optional(),
  name: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'terminal.open'>>>

/** Request schema for `terminal.send`. */
export const terminalSendRequestSchema = z.object({
  sessionId: sessionIdSchema,
  id: terminalIdSchema,
  text: z.string(),
  submit: z.boolean(),
}) satisfies z.ZodType<Wire<RequestPayload<'terminal.send'>>>

/** Request schema for `terminal.read`. */
export const terminalReadRequestSchema = z.object({
  sessionId: sessionIdSchema,
  id: terminalIdSchema,
  offset: z.number().int().nonnegative().optional(),
  count: z.number().int().positive().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'terminal.read'>>>

/** Request schema for `terminal.write`. */
export const terminalWriteRequestSchema = z.object({
  sessionId: sessionIdSchema,
  id: terminalIdSchema,
  text: z.string(),
}) satisfies z.ZodType<Wire<RequestPayload<'terminal.write'>>>

/** Request schema for `terminal.resize`. */
export const terminalResizeRequestSchema = z.object({
  sessionId: sessionIdSchema,
  id: terminalIdSchema,
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
}) satisfies z.ZodType<Wire<RequestPayload<'terminal.resize'>>>

/** Request schema for `terminal.signal`. */
export const terminalSignalRequestSchema = z.object({
  sessionId: sessionIdSchema,
  id: terminalIdSchema,
  signal: z.enum(['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP', 'SIGHUP']),
}) satisfies z.ZodType<Wire<RequestPayload<'terminal.signal'>>>

/** Request schema for `terminal.close`. */
export const terminalCloseRequestSchema = z.object({
  sessionId: sessionIdSchema,
  id: terminalIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'terminal.close'>>>

/** Request schema for `terminal.list`. */
export const terminalListRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'terminal.list'>>>

/** Value schema for `terminal.open`. */
export const terminalOpenValueSchema = terminalSessionViewSchema as z.ZodType<Wire<ResponseValue<'terminal.open'>>>

/** Value schema for `terminal.send`. */
export const terminalSendValueSchema = z.object({
  viewport: z.string(),
  waitReason: z.enum(['stdin_read', 'inferred_idle', 'timeout', 'session_exit']),
  sessionStatus: terminalSessionStatusSchema,
  truncated: z.boolean(),
}) as z.ZodType<Wire<ResponseValue<'terminal.send'>>>

/** Value schema for `terminal.read`. */
export const terminalReadValueSchema = z.object({
  text: z.string(),
  totalLines: z.number().int().nonnegative(),
  lineBegin: z.number().int().nonnegative(),
  lineEnd: z.number().int().nonnegative(),
  truncated: z.boolean(),
}) as z.ZodType<Wire<ResponseValue<'terminal.read'>>>

/** Value schema for `terminal.resize`. */
export const terminalResizeValueSchema = z.object({
  accepted: z.literal(true),
}) as z.ZodType<Wire<ResponseValue<'terminal.resize'>>>

/** Value schema for `terminal.write`. */
export const terminalWriteValueSchema = z.object({
  accepted: z.literal(true),
}) as z.ZodType<Wire<ResponseValue<'terminal.write'>>>

/** Value schema for `terminal.signal`. */
export const terminalSignalValueSchema = z.object({
  targetPgid: z.number(),
}) as z.ZodType<Wire<ResponseValue<'terminal.signal'>>>

/** Value schema for `terminal.close`. */
export const terminalCloseValueSchema = z.object({
  closed: z.boolean(),
}) as z.ZodType<Wire<ResponseValue<'terminal.close'>>>

/** Value schema for `terminal.list`. */
export const terminalListValueSchema = z.object({
  sessions: z.array(terminalSessionViewSchema),
}) as z.ZodType<Wire<ResponseValue<'terminal.list'>>>

/** TerminalFrame union (payload slot of a terminal-stream ServerRequest). */
export const terminalFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('terminal/output'), sessionId: sessionIdSchema, id: terminalIdSchema, data: z.string() }),
  z.object({ type: z.literal('stream/error'), error: rpcErrorSchema }),
]) as unknown as z.ZodType<TerminalFrame>
