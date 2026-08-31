// @ts-check

import { defineConfig } from 'eslint/config'
import rootConfig from '../../eslint.config.js'

export default defineConfig([
  ...rootConfig,
  // The declaration library is generated from TypeScript's own `lib` files.
  { ignores: ['src/generated/**'] },
])
