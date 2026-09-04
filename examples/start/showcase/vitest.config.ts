import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import packageJson from './package.json' with { type: 'json' }
import { workspaceSourceAlias } from './workspace-alias'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: workspaceSourceAlias },
  test: {
    name: packageJson.name,
    dir: './tests',
    watch: false,
    environment: 'jsdom',
    testTimeout: 15_000,
  },
})
