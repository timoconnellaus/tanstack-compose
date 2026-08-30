import { describe, expect, test } from 'vitest'
import {
  createRuntime,
  defineEvent,
  definePlugin,
  defineService,
} from '../src/index'

describe('@tanstack/compose', () => {
  test('exports the kernel entry points', () => {
    expect(createRuntime).toBeTypeOf('function')
    expect(definePlugin).toBeTypeOf('function')
    expect(defineService).toBeTypeOf('function')
    expect(defineEvent).toBeTypeOf('function')
  })

  test('the placeholders announce that they are not implemented', () => {
    expect(() => createRuntime()).toThrow(/not implemented/)
  })
})
