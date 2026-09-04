import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { workspaceSourceAlias } from './workspace-alias'

export default defineConfig(({ mode }) => ({
  plugins: [tanstackStart(), react()],
  resolve: {
    alias: {
      '#showcase-browser-pages': fileURLToPath(
        new URL(
          mode === 'browser'
            ? './src/app/browser-pages.browser.tsx'
            : './src/app/browser-pages.production.tsx',
          import.meta.url,
        ),
      ),
      ...workspaceSourceAlias,
    },
  },
  server: { port: 3061 },
  build: { rolldownOptions: { external: ['cloudflare:workers'] } },
}))
