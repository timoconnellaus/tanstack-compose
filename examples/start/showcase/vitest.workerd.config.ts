import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }
import { workspaceSourceAlias } from './workspace-alias'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.test.jsonc' },
      additionalExports: { ComposeStubLoopback: 'WorkerEntrypoint' },
    }),
  ],
  resolve: { alias: workspaceSourceAlias },
  test: {
    name: `${packageJson.name}-workerd`,
    dir: './tests-workerd',
    watch: false,
    // The pool's fallback service cannot serve TypeScript's 9 MB CommonJS
    // module, so bundle it into the test Worker before workerd starts.
    deps: { optimizer: { ssr: { enabled: true, include: ['typescript'] } } },
  },
})
