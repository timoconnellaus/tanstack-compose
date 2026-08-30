import { describe, expect, test } from 'vitest'
import { createDevtools } from '../src/index'

describe('@tanstack/compose-devtools', () => {
  test('exports createDevtools', () => {
    expect(createDevtools).toBeTypeOf('function')
  })
})
