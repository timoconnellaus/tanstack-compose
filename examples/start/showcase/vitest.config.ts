import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import packageJson from './package.json' with { type: 'json' }
import { workspaceSourceAlias } from './workspace-alias'

export default defineConfig({
  plugins: [react()],
  // The devtools UI kit is Solid; outside a browser Node would pick its server build.
  resolve: {
    alias: workspaceSourceAlias,
    conditions: ['browser', 'development'],
  },
  test: {
    server: { deps: { inline: [/solid-js/, /@tanstack\/devtools/] } },
    name: packageJson.name,
    dir: './tests',
    watch: false,
    environment: 'jsdom',
    testTimeout: 15_000,
  },
})
