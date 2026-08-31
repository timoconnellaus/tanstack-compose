import { defineConfig } from 'vitest/config'
import packageJson from './package.json'

/** The same suite again in a browser-like environment, as the kernel does. */
export default defineConfig({
  test: {
    name: `${packageJson.name} (jsdom)`,
    dir: './tests',
    exclude: ['**/workerd/**'],
    watch: false,
    environment: 'jsdom',
  },
})
