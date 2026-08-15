import { describe, expect, it } from 'vitest'
import type { Config } from '@deepseek-ai/dsh-terminal-bash-human/src/config.ts'
import { validateConfig } from '@deepseek-ai/dsh-terminal-bash-human/src/config.ts'

function config(overrides: Partial<Config> = {}): Config {
  return {
    backendType: 'bash-human', shellPath: '/bin/bash', shellArgs: [], rows: 40, cols: 160,
    scrollbackLines: 100, scrollbackMaxBytes: 1024, maxReadBytes: 512,
    startupTimeoutMs: 1000, pollIntervalMs: 25, disposeGraceMs: 100,
    ...overrides,
  }
}

describe('terminal-bash-human config', () => {
  it('accepts resolved positive bounds', () => {
    expect(() => { validateConfig(config()) }).not.toThrow()
  })

  it('rejects empty names, invalid numbers, and a read cap above retention', () => {
    expect(() => { validateConfig(config({ backendType: '' })) }).toThrow('backendType')
    expect(() => { validateConfig(config({ shellPath: '' })) }).toThrow('shellPath')
    expect(() => { validateConfig(config({ rows: 0 })) }).toThrow('rows')
    expect(() => { validateConfig(config({ rows: 1.5 })) }).toThrow('rows')
    expect(() => { validateConfig(config({ maxReadBytes: 2048 })) }).toThrow('must not exceed')
  })

  it('rejects a poll interval above the startup timeout', () => {
    expect(() => { validateConfig(config({ pollIntervalMs: 2000, startupTimeoutMs: 1000 })) }).toThrow('pollIntervalMs must not exceed startupTimeoutMs')
    expect(() => { validateConfig(config({ pollIntervalMs: 1000, startupTimeoutMs: 1000 })) }).not.toThrow()
  })
})
