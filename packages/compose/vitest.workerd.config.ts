import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import packageJson from './package.json'

/** I1 — a smoke test of the kernel running under workerd. */
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: '2026-08-01' } })],
  test: {
    name: `${packageJson.name} (workerd)`,
    dir: './tests/workerd',
    watch: false,
  },
})
