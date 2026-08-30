import { describe, expect, test } from 'vitest'
import { ComposeProvider, useComposition, useService } from '../src/index'

describe('@tanstack/react-compose', () => {
  test('exports the adapter entry points', () => {
    expect(ComposeProvider).toBeTypeOf('function')
    expect(useService).toBeTypeOf('function')
    expect(useComposition).toBeTypeOf('function')
  })

  test('the placeholders announce that they are not implemented', () => {
    expect(() => useComposition()).toThrow(/not implemented/)
  })
})
