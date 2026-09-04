import { describe, expect, it, vi } from 'vitest'
import { createTypeScriptChecker } from '../src/index'

const compilerModule = vi.hoisted(() => ({ evaluated: false }))

vi.mock('typescript', () => {
  compilerModule.evaluated = true
  return { default: {} }
})

describe('loading the compiler', () => {
  it('waits until the first check to evaluate TypeScript', async () => {
    const checker = createTypeScriptChecker()

    expect(compilerModule.evaluated).toBe(false)

    await expect(
      checker.check({
        instanceId: 'lazy',
        source: 'const setup: Setup = () => {}\nexport default setup',
        declarations: '',
        grants: [],
      }),
    ).rejects.toThrow()
    expect(compilerModule.evaluated).toBe(true)
  })
})
