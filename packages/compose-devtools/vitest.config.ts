import { defineConfig } from 'vitest/config'
import packageJson from './package.json'

export default defineConfig({
  // The UI kit is Solid; outside a browser Node would pick its server build.
  resolve: { conditions: ['browser'] },
  test: {
    server: { deps: { inline: [/solid-js/, /@tanstack\/devtools/] } },
    name: packageJson.name,
    dir: './tests',
    watch: false,
    environment: 'jsdom',
    coverage: { enabled: true, provider: 'istanbul', include: ['src/**/*'] },
    typecheck: { enabled: true },
  },
})
