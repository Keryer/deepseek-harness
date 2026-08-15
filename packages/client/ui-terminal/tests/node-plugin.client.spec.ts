import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, it } from 'vitest'
import { apply } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('ui-terminal node plugin', () => {
  it('is a no-op host half', () => {
    apply()
  })

  it('mounts on a bare context with no required services', async () => {
    ctx = new Context()
    await ctx.plugin({ apply }).await()
  })
})
