import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import packageJson from '../package.json' with { type: 'json' }

const here = dirname(fileURLToPath(import.meta.url))
const sourceDir = join(here, '../src')
const sources = readdirSync(sourceDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, text: readFileSync(join(sourceDir, name), 'utf8') }))

describe('Packaging', () => {
  it('depends on the kernel and the store and nothing else', () => {
    expect(Object.keys(packageJson.dependencies)).toEqual([
      '@tanstack/compose',
      '@tanstack/store',
    ])
    expect('peerDependencies' in packageJson).toBe(false)
  })

  it('has no framework dependencies and no runtime-specific imports', () => {
    for (const source of sources) {
      expect(source.text).not.toMatch(/from '(node:|react|vue|svelte|solid)/)
    }
    // The suite runs under node and jsdom, and a smoke test runs under workerd.
    expect(typeof globalThis.queueMicrotask).toBe('function')
    expect(typeof globalThis.AbortController).toBe('function')
  })

  it('documents every public export', () => {
    const documented = new Map<string, boolean>()
    for (const source of sources) {
      const lines = source.text.split('\n')
      lines.forEach((line, index) => {
        const declaration =
          /^export (?:const|function|type|interface|class) (\w+)/.exec(line)
        if (!declaration) return
        const name = `${source.name}:${declaration[1]!}`
        const previous = lines
          .slice(0, index)
          .reverse()
          .find((candidate) => candidate.trim() !== '')
        const hasDoc = previous !== undefined && previous.trim().endsWith('*/')
        documented.set(name, (documented.get(name) ?? false) || hasDoc)
      })
    }
    for (const [name, hasDoc] of documented) {
      expect(`${name}: ${String(hasDoc)}`).toBe(`${name}: true`)
    }
  })
})
