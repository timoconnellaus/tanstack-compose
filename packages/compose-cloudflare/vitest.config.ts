import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import packageJson from './package.json'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      additionalExports: { ComposeStubLoopback: 'WorkerEntrypoint' },
    }),
  ],
  test: {
    name: packageJson.name,
    dir: './tests',
    watch: false,
  },
})
