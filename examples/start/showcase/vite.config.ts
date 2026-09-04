import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { workspaceSourceAlias } from './workspace-alias'
import { composeDeclarations } from '@tanstack/compose-typescript/generate'

export default defineConfig(({ mode }) => ({
  plugins: [
    composeDeclarations({ entry: 'src/base.ts', exportName: 'base' }),
    composeDeclarations({
      entry: 'src/base-v2.ts',
      exportName: 'baseV2',
      id: 'compose:declarations-v2',
    }),
    tanstackStart(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    react(),
  ],
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
}))
