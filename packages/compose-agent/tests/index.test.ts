import { describe, expect, test } from 'vitest'
import { AGENT_VOCABULARY } from '../src/index'

describe('@tanstack/compose-agent', () => {
  test('names the four capability seams', () => {
    expect(AGENT_VOCABULARY).toEqual(['model', 'tools', 'prompt', 'session'])
  })
})
