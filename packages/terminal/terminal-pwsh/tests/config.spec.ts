import { describe, expect, it } from 'vitest'
import type { Config } from '@deepseek-ai/dsh-terminal-pwsh/src/config.ts'
import { validateConfig } from '@deepseek-ai/dsh-terminal-pwsh/src/config.ts'

function config(overrides: Partial<Config> = {}): Config {
  return {
    backendType: 'pwsh', shellPath: '', shellArgs: ['-NoLogo', '-NoProfile'],
    rows: 24, cols: 80, scrollbackLines: 10, scrollbackMaxBytes: 100, maxReadBytes: 50,
    startupTimeoutMs: 200, pollIntervalMs: 10, disposeGraceMs: 10,
    ...overrides,
  }
}

describe('terminal-pwsh config', () => {
  it('accepts a complete valid config', () => {
    expect(() => { validateConfig(config()) }).not.toThrow()
  })

  it('rejects an empty backend type and non-positive numbers', () => {
    expect(() => { validateConfig(config({ backendType: '' })) }).toThrow('backendType must be non-empty')
    expect(() => { validateConfig(config({ rows: 0 })) }).toThrow('rows must be a positive safe integer')
    expect(() => { validateConfig(config({ rows: 1.5 })) }).toThrow('rows must be a positive safe integer')
  })

  it('rejects bounds that cannot compose', () => {
    expect(() => { validateConfig(config({ maxReadBytes: 101 })) }).toThrow('maxReadBytes must not exceed scrollbackMaxBytes')
    expect(() => { validateConfig(config({ pollIntervalMs: 201 })) }).toThrow('pollIntervalMs must not exceed startupTimeoutMs')
  })
})
