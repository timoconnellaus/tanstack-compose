import { createPlugin, sourceCheckerKey } from '@tanstack/compose'
import { createTypeScriptChecker } from './checker'

/**
 * Type-checks plugin source before it is started, against the declarations
 * derived from exactly the stubs the entry was granted, and hands the host the
 * JavaScript it produced (self-modification D7, D9).
 *
 * It is one entry in the plugin list and provides `sourceCheckerKey`. A client
 * without it starts source as written; a client with it checks the same way for
 * every host, because the check happens client-side before any host is asked to
 * start anything.
 *
 * @example
 * ```ts
 * const client = createClient({
 *   plugins: [
 *     { id: 'checker', plugin: typescriptCheckerPlugin },
 *     { id: 'greeter', source, stubs: [toolsStub] },
 *   ],
 * })
 * ```
 */
export const typescriptCheckerPlugin = createPlugin({
  name: 'typescript-checker',
  provides: [sourceCheckerKey],
  setup(instance) {
    instance.provide(sourceCheckerKey, createTypeScriptChecker())
  },
})
