import { defineConfig } from 'vitest/config'
import packageJson from './package.json'

export default defineConfig({
  test: {
    name: packageJson.name,
    dir: './tests',
    // The workerd smoke test has its own config and pool (I1).
    exclude: ['**/workerd/**'],
    watch: false,
    environment: 'node',
    coverage: { enabled: true, provider: 'istanbul', include: ['src/**/*'] },
    typecheck: { enabled: true },
  },
})
