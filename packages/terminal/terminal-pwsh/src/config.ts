/** Validated configuration for the Windows PowerShell PTY backend. */

import z from '@deepseek-ai/schemastery'

/** Public plugin configuration. */
export interface Config {
  /** Backend registry type (default: `pwsh`). */
  backendType?: string
  /** Interactive shell executable; empty resolves the platform PowerShell (default). */
  shellPath?: string
  /** Shell arguments (default: `-NoLogo -NoProfile`). */
  shellArgs?: string[]
  /** Terminal rows. */
  rows?: number
  /** Terminal columns. */
  cols?: number
  /** Maximum retained logical lines. */
  scrollbackLines?: number
  /** Maximum retained UTF-8 bytes. */
  scrollbackMaxBytes?: number
  /** Maximum bytes returned by one read. */
  maxReadBytes?: number
  /** Bound on waiting for the shell's first output (the open motd). */
  startupTimeoutMs?: number
  /** Interval for the startup-output poll. */
  pollIntervalMs?: number
  /** Grace before teardown escalates to force termination. */
  disposeGraceMs?: number
}

/** Configuration after Schemastery defaults. */
export type ResolvedConfig = Required<Config>

/** Schemastery config exposed by the plugin. */
export const Config: z<Config> = z.object({
  backendType: z.string().default('pwsh'),
  shellPath: z.string().default(''),
  shellArgs: z.array(z.string()).default(['-NoLogo', '-NoProfile']),
  rows: z.number().default(40),
  cols: z.number().default(160),
  scrollbackLines: z.number().default(10_000),
  scrollbackMaxBytes: z.number().default(4 * 1024 * 1024),
  maxReadBytes: z.number().default(256 * 1024),
  startupTimeoutMs: z.number().default(1500),
  pollIntervalMs: z.number().default(25),
  disposeGraceMs: z.number().default(3000),
})

/**
 * Assert every numeric config field is a positive safe integer and bounds compose.
 * @param config - Schemastery-resolved plugin configuration.
 * @returns Narrows the input to the fully resolved configuration.
 */
export function validateConfig(config: Config): asserts config is ResolvedConfig {
  const resolved = config as ResolvedConfig
  if (resolved.backendType.length === 0) throw new Error('terminal-pwsh: backendType must be non-empty')
  for (const [name, value] of Object.entries(resolved)) {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`terminal-pwsh: ${name} must be a positive safe integer`)
    }
  }
  if (resolved.maxReadBytes > resolved.scrollbackMaxBytes) {
    throw new Error('terminal-pwsh: maxReadBytes must not exceed scrollbackMaxBytes')
  }
  if (resolved.pollIntervalMs > resolved.startupTimeoutMs) {
    throw new Error('terminal-pwsh: pollIntervalMs must not exceed startupTimeoutMs')
  }
}
