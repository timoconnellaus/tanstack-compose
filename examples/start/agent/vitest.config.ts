import { composeDeclarations } from '@tanstack/compose-typescript/generate'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }
import { workspaceSourceAlias } from './workspace-alias.ts'

export default defineConfig({
  plugins: [
    composeDeclarations({ entry: 'src/base.ts', exportName: 'base' }),
    react(),
  ],
  resolve: {
    alias: workspaceSourceAlias,
    conditions: ['browser', 'development'],
  },
  test: {
    name: packageJson.name,
    dir: './tests',
    watch: false,
    environment: 'jsdom',
    testTimeout: 15_000,
  },
})
