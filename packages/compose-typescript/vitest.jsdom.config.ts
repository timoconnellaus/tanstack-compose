import { defineConfig } from 'vitest/config'
import packageJson from './package.json'

/** The same suite again in a browser-like environment: the checker is portable. */
export default defineConfig({
  test: {
    name: `${packageJson.name} (jsdom)`,
    dir: './tests',
    // The budget test bundles from disk and belongs to the node run only.
    exclude: ['**/budget.test.ts'],
    watch: false,
    environment: 'jsdom',
  },
})
