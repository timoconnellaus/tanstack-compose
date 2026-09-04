import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { composeDeclarations } from '@tanstack/compose-typescript/generate'
import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }
import { workspaceSourceAlias } from './workspace-alias.ts'

export default defineConfig({
  plugins: [
    composeDeclarations({ entry: 'src/base.ts', exportName: 'base' }),
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
    deps: { optimizer: { ssr: { enabled: true, include: ['typescript'] } } },
  },
})
