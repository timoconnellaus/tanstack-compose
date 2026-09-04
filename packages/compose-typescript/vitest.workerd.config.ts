import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }

/** A smoke test of the compiler loading and checking source under workerd. */
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    name: `${packageJson.name} (workerd)`,
    dir: './tests/workerd',
    watch: false,
    // The pool serves node_modules through a fallback service that cannot
    // carry a 9 MB module; pre-bundle TypeScript for the worker instead.
    deps: { optimizer: { ssr: { enabled: true, include: ['typescript'] } } },
  },
})
