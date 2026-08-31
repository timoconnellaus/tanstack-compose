/**
 * Where a **credential** value comes from in one runtime. This is the shape the
 * agent layer's credentials plugin takes as its `source`; it is declared here
 * structurally so a **host** package needs no dependency on the agent layer.
 */
export interface CredentialSource {
  /** The value of the credential with this name, or `undefined`. */
  get: (name: string) => string | undefined
}

/**
 * A **credential source** over a Worker's `env`: the plain-text vars and the
 * secrets bound to this Worker, read by name. A binding that is not a string —
 * a Worker Loader, a KV namespace, a Durable Object — is not a credential and
 * reads as `undefined`.
 *
 * A Worker has no process environment, so this is what a Worker hands the
 * credentials plugin. Nothing here reads `process.env`.
 *
 * @example
 * ```ts
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const client = createClient({
 *       plugins: [
 *         {
 *           id: 'credentials',
 *           plugin: credentialsPlugin,
 *           options: { source: bindingCredentials(env) },
 *         },
 *         { id: 'model', plugin: openaiModelPlugin, options: { model: 'gpt-4o-mini' } },
 *       ],
 *     })
 *   },
 * }
 * ```
 */
export const bindingCredentials = (env: unknown): CredentialSource => {
  // `env` is captured here and nowhere else, so no binding value reaches the
  // plugin list, a store or a tool result.
  const bindings = (env ?? {}) as Record<string, unknown>
  return {
    get: (name: string) => {
      const value = bindings[name]
      return typeof value === 'string' ? value : undefined
    },
  }
}
