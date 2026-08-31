import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import packageJson from './package.json'

/** A smoke test of the agent layer running under workerd, as the kernel does. */
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: '2026-08-01' } })],
  test: {
    name: `${packageJson.name} (workerd)`,
    dir: './tests/workerd',
    watch: false,
  },
})
