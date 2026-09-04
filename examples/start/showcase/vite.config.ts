import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { workspaceSourceAlias } from './workspace-alias'

export default defineConfig({
  plugins: [tanstackStart(), react()],
  resolve: { alias: workspaceSourceAlias },
  server: { port: 3061 },
})
