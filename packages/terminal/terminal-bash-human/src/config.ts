/** Validated configuration for the POSIX bash human-terminal PTY backend. */

import z from '@deepseek-ai/schemastery'

/** Public plugin configuration. */
export interface Config {
  /** Backend registry type (default: `bash-human`). */
  backendType?: string
  /** Interactive shell executable; empty resolves the login shell (`$SHELL`), else zsh on macOS, bash elsewhere. */
  shellPath?: string
  /** Shell arguments (default: `-i`, an interactive shell that sources `.bashrc`). */
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
  backendType: z.string().default('bash-human'),
  shellPath: z.string().default(''),
  shellArgs: z.array(z.string()).default(['-i']),
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
  if (resolved.backendType.length === 0) throw new Error('terminal-bash-human: backendType must be non-empty')
  for (const [name, value] of Object.entries(resolved)) {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`terminal-bash-human: ${name} must be a positive safe integer`)
    }
  }
  if (resolved.maxReadBytes > resolved.scrollbackMaxBytes) {
    throw new Error('terminal-bash-human: maxReadBytes must not exceed scrollbackMaxBytes')
  }
  if (resolved.pollIntervalMs > resolved.startupTimeoutMs) {
    throw new Error('terminal-bash-human: pollIntervalMs must not exceed startupTimeoutMs')
  }
}
