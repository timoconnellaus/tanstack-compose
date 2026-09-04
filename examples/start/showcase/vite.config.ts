import { fileURLToPath } from 'node:url'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** A workspace package, resolved from its source rather than its `dist`. */
const source = (name: string): string =>
  fileURLToPath(
    new URL(`../../../packages/${name}/src/index.ts`, import.meta.url),
  )

export default defineConfig({
  plugins: [tanstackStart(), react()],
  resolve: {
    // The workspace packages export their `dist`, which a package build removes
    // and recreates. Resolving them from source keeps dev, tests and the build
    // independent of whether a build is in flight, and hot-reloads the kernel.
    alias: {
      '@tanstack/compose-typescript': source('compose-typescript'),
      '@tanstack/react-compose': source('react-compose'),
      '@tanstack/compose': source('compose'),
    },
  },
  server: { port: 3061 },
})
