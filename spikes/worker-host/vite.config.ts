import { defineConfig } from 'vite'

export default defineConfig({
  root: 'browser',
  server: { port: 5199 },
  // The host imports `node:worker_threads` behind a computed specifier so the
  // bundler never sees it; this keeps Vite from trying to pre-bundle it anyway.
  optimizeDeps: { exclude: ['node:worker_threads'] },
  worker: { format: 'es' },
})
