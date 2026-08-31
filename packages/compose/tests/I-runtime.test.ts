import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createClient, createContextKey, definePlugin } from '../src/index'
import packageJson from '../package.json' with { type: 'json' }

const here = dirname(fileURLToPath(import.meta.url))
const sourceDir = join(here, '../src')
const sources = readdirSync(sourceDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, text: readFileSync(join(sourceDir, name), 'utf8') }))

describe('I. Runtime and packaging', () => {
  it('the core has no framework dependencies and no runtime-specific imports', () => {
    expect(Object.keys(packageJson.dependencies)).toEqual(['@tanstack/store'])
    expect('peerDependencies' in packageJson).toBe(false)
    for (const source of sources) {
      expect(source.text).not.toMatch(/from '(node:|react|vue|svelte|solid)/)
    }
    // The suite itself runs under both the node and jsdom environments; see
    // vitest.config.ts and vitest.jsdom.config.ts.
    expect(typeof globalThis.queueMicrotask).toBe('function')
  })

  it('two copies of the package loaded at once interoperate', async () => {
    const copyA = await import('../src/index')
    vi.resetModules()
    const copyB = await import('../src/index')
    expect(copyA.createClient).not.toBe(copyB.createClient)

    // A key and a plugin from copy B, hosted by a client from copy A.
    const key = copyB.createContextKey<string>('greeting')
    const provider = copyB.definePlugin({
      name: 'provider',
      provides: [key],
      setup(instance) {
        instance.provide(key, 'hello')
      },
    })
    const consumer = copyA.definePlugin({
      name: 'consumer',
      deps: [key],
      setup() {},
    })

    const client = copyA.createClient({
      plugins: [
        { id: 'provider', plugin: provider },
        { id: 'consumer', plugin: consumer },
      ],
    })
    await client.settled()

    expect(client.inspect().map((entry) => entry.status)).toEqual([
      'active',
      'active',
    ])
    expect(client.getContext(key)).toBe('hello')
    // Identity never leans on `instanceof`: the only mentions are in comments.
    for (const source of sources) {
      const code = source.text
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
        .join('\n')
      expect(code).not.toMatch(/\binstanceof\b/)
    }
  })

  it('the core uses no Proxy and is checked against the size budget', () => {
    for (const source of sources) {
      expect(source.text).not.toMatch(/\bnew Proxy\b/)
    }
    const budget = readFileSync(
      join(here, '../../../scripts/check-size.ts'),
      'utf8',
    )
    expect(budget).toMatch(/BUDGET_BYTES = 6 \* 1024/)
  })

  it('every public export has JSDoc', () => {
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
        // An overloaded function only needs the doc on one of its signatures.
        documented.set(name, (documented.get(name) ?? false) || hasDoc)
      })
    }
    for (const [name, hasDoc] of documented) {
      expect(`${name}: ${String(hasDoc)}`).toBe(`${name}: true`)
    }
  })
})

// Used above only to keep the plugin honest about its shape.
void createClient
void createContextKey
void definePlugin
