import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import packageJson from './package.json'

/**
 * A Workers AI binding is always remote — there is no local simulation of
 * inference — so the pool would open a remote proxy session for it, which needs
 * a logged-in account and would make the whole suite depend on one. Ordinary
 * runs therefore turn remote bindings off: `env.AI` is present but inert, and
 * every test drives a fake binding of its own.
 *
 * `COMPOSE_WORKERS_AI_SMOKE=1` turns them back on and lets the smoke test run
 * against the real binding, on the account `wrangler login` (and, where the
 * account is ambiguous, `CLOUDFLARE_ACCOUNT_ID`) names.
 */
const smoke = process.env.COMPOSE_WORKERS_AI_SMOKE === '1'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      additionalExports: { ComposeStubLoopback: 'WorkerEntrypoint' },
      remoteBindings: smoke,
      miniflare: {
        bindings: { COMPOSE_WORKERS_AI_SMOKE: smoke ? '1' : '' },
      },
    }),
  ],
  test: {
    name: packageJson.name,
    dir: './tests',
    watch: false,
  },
})
