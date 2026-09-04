import { cloudflare } from '@cloudflare/vite-plugin'
import { composeDeclarations } from '@tanstack/compose-typescript/generate'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { workspaceSourceAlias } from './workspace-alias.ts'

export default defineConfig({
  plugins: [
    composeDeclarations({ entry: 'src/base.ts', exportName: 'base' }),
    tanstackStart(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    react(),
  ],
  resolve: { alias: workspaceSourceAlias },
  server: { port: 3062 },
})
