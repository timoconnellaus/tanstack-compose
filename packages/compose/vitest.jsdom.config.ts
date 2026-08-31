import { defineConfig } from 'vitest/config'
import packageJson from './package.json'

/** I1 — the same suite again in a browser-like environment. */
export default defineConfig({
  test: {
    name: `${packageJson.name} (jsdom)`,
    dir: './tests',
    exclude: ['**/workerd/**'],
    watch: false,
    environment: 'jsdom',
  },
})
