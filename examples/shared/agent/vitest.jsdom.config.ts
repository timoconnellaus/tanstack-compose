import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }

/** Repeat the portable runtime suite in a browser-like environment. */
export default defineConfig({
  test: {
    name: `${packageJson.name} (jsdom)`,
    dir: './tests',
    exclude: ['**/openai.test.ts', '**/smoke.test.ts'],
    watch: false,
    environment: 'jsdom',
  },
})
