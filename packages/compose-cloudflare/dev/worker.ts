/**
 * A loader Worker you can run with `wrangler dev` from this package. It is the
 * whole of what a consumer writes: a binding in `wrangler.jsonc`, this one
 * re-export, and a client whose `hosts` names the host.
 *
 * ```sh
 * pnpm --filter @tanstack/compose-cloudflare exec wrangler dev
 * curl 'http://localhost:8787/?a=2&b=3'
 * ```
 */
import { createClient, createStub } from '@tanstack/compose'
import { createCloudflareHost } from '../src/index'

export { ComposeStubLoopback } from '../src/index'

/** What the plugin the agent would have written looks like. */
const source = `
export default async function setup({ options, stubs }) {
  await stubs.expose({ name: 'add', handler: 'add' })
  await stubs.log('adder up, rounding to ' + options.places + ' places')
}

export async function add({ a, b }) {
  return Number((a + b).toFixed(2))
}
`

interface Env {
  LOADER: WorkerLoader
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const logged: Array<string> = []
    let add: ((input: unknown) => Promise<unknown>) | undefined

    const logStub = createStub<string, void>({
      name: 'log',
      declarations: 'declare const log: (message: string) => Promise<void>',
      handler: ({ instanceId, input }) => {
        logged.push(`${instanceId}: ${input}`)
      },
    })

    const exposeStub = createStub<{ name: string; handler: string }, void>({
      name: 'expose',
      declarations:
        'declare const expose: (tool: { name: string; handler: string }) => Promise<void>',
      handler: ({ input, call }) => {
        add = (argument) => call(input.handler, argument)
      },
    })

    // One client per request, which is what a loader Worker wants: the host,
    // the kernel and the stub handlers all live in this request's isolate.
    const client = createClient({
      hosts: {
        cloudflare: createCloudflareHost({
          loader: env.LOADER,
          compatibilityDate: '2026-05-01',
        }),
      },
      plugins: [
        {
          id: 'adder',
          source,
          host: 'cloudflare',
          stubs: [logStub, exposeStub],
          options: { places: 2 },
        },
      ],
    })
    await client.settled()

    const answer = await add?.({
      a: Number(url.searchParams.get('a') ?? 0),
      b: Number(url.searchParams.get('b') ?? 0),
    })
    await client.destroy()

    return Response.json({ answer, logged })
  },
}
