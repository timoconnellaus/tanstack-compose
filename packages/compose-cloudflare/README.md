# `@tanstack/compose-cloudflare`

A **host** for [`@tanstack/compose`](../compose) that runs **plugin source** in a
Cloudflare Dynamic Worker. The client sees an ordinary **plugin instance**; the
written code sees its **stubs** and nothing else — no network, no bindings, no
loader.

Use it when an agent writes plugins and you would rather not run what it wrote
in the same isolate as everything else.

It also ships a **model provider** over a Workers AI binding, and a
chat-completions route for browser clients, so an agent on Cloudflare has a real
model and holds no **credential** to get it. See
[A model, with no credential](#a-model-with-no-credential).

## Installation

```sh
npm install @tanstack/compose @tanstack/compose-cloudflare
```

It runs in a Cloudflare Worker on a paid plan, and locally under `wrangler dev`
or `@cloudflare/vitest-pool-workers`.

## Three steps

### 1. Bind a Worker Loader

```jsonc
// wrangler.jsonc
{
  "compatibility_date": "2026-05-01",
  "worker_loaders": [{ "binding": "LOADER" }],
}
```

### 2. Re-export the loopback entrypoint

Stubs reach a hosted plugin as loopback entrypoints minted from your Worker's
own exports, so your entry module has to export the class. One line:

```ts
// src/index.ts
export { ComposeStubLoopback } from '@tanstack/compose-cloudflare'
```

### 3. Name the host on the client

```ts
import { createClient, createStub } from '@tanstack/compose'
import { createCloudflareHost } from '@tanstack/compose-cloudflare'

export default {
  async fetch(request: Request, env: Env) {
    const client = createClient({
      hosts: {
        cloudflare: createCloudflareHost({
          loader: env.LOADER,
          compatibilityDate: '2026-05-01',
        }),
      },
      plugins: [{ id: 'adder', source, host: 'cloudflare', stubs: [logStub] }],
    })
    await client.settled()
    // …
  },
}
```

An entry that names `host: 'cloudflare'` runs in an isolate of its own; an entry
that names no host runs in-process, unchanged.

## What the written plugin sees

The same thing it sees in every host: a module whose default export is setup and
whose other named exports are handlers.

```js
export default async function setup({ id, options, stubs }) {
  await stubs.log(`up as ${id}`)
  return () => {
    /* release what this module holds */
  }
}

export async function add({ a, b }) {
  return a + b
}
```

`stubs` has exactly the names the entry was granted. There is no `env`, no
`fetch`, no timer that can reach anything, and no way to name another plugin.

## Options

| Option               | Default                           | What it is                                                     |
| -------------------- | --------------------------------- | -------------------------------------------------------------- |
| `loader`             | —                                 | the Worker Loader binding                                      |
| `compatibilityDate`  | —                                 | the date every loaded isolate runs under                       |
| `compatibilityFlags` | none                              | flags for every loaded isolate                                 |
| `limits`             | `{ cpuMs: 200, subRequests: 50 }` | the platform limits set on every load                          |
| `callTimeoutMs`      | `5000`                            | the client-side wall clock on every `setup`, `call` and `stop` |
| `name`               | `'cloudflare'`                    | the name entries use to ask for this host                      |
| `hostId`             | the name                          | which host a loopback belongs to, if you run more than one     |

Outbound network is off unconditionally and is not an option.

## Credentials from bindings

A Worker has no process environment. Its vars and secrets arrive on `env`, so
this package also ships the **credential source** that reads them:

```ts
import { createClient } from '@tanstack/compose'
import { credentialsPlugin } from '@tanstack/compose-agent'
import { bindingCredentials } from '@tanstack/compose-cloudflare'
import { openaiModelPlugin } from '@tanstack/compose-agent-openai'

export default {
  async fetch(request: Request, env: Env) {
    const client = createClient({
      plugins: [
        {
          id: 'credentials',
          plugin: credentialsPlugin,
          options: { source: bindingCredentials(env) },
        },
        // Names the credential; never holds it.
        {
          id: 'model',
          plugin: openaiModelPlugin,
          options: { model: 'gpt-4o-mini', credential: 'OPENAI_API_KEY' },
        },
        // …the rest of the agent
      ],
    })
  },
}
```

```sh
pnpm --filter your-worker exec wrangler secret put OPENAI_API_KEY
```

It reads string bindings by name — a var or a secret. A binding that is not a
string, such as the Worker Loader itself, reads as `undefined`. `env` is held in
the source's closure: no value reaches the plugin list, a store, the session or
a tool result, and there is no way to list what is bound.

## A model, with no credential

The package also ships a **model provider** over a Workers AI binding, so an
agent on Cloudflare has a real model and nothing to configure. A binding is not a
secret: there is no key in the plugin list, no environment variable, and nothing
for the page to hold.

### Bind Workers AI

```jsonc
// wrangler.jsonc
{
  "ai": { "binding": "AI" },
}
```

### On the server: the binding directly

```ts
import {
  agentKey,
  loopPlugin,
  modelsPlugin,
  promptPlugin,
  sessionPlugin,
  toolsPlugin,
} from '@tanstack/compose-agent'
import { workersAiModelPlugin } from '@tanstack/compose-cloudflare'

const client = createClient({
  plugins: [
    { id: 'session', plugin: sessionPlugin },
    { id: 'tools', plugin: toolsPlugin },
    { id: 'prompt', plugin: promptPlugin },
    { id: 'models', plugin: modelsPlugin },
    {
      id: 'model',
      plugin: workersAiModelPlugin,
      options: { binding: env.AI, options: { max_tokens: 1024 } },
    },
    { id: 'loop', plugin: loopPlugin },
  ],
})
```

| Option    | Default                                    | What it is                                    |
| --------- | ------------------------------------------ | --------------------------------------------- |
| `binding` | —                                          | the `AI` binding from `env`                   |
| `model`   | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | any model with streaming and function calling |
| `name`    | the model                                  | the name it registers under in the registry   |
| `options` | none                                       | `max_tokens`, `temperature`, sent every step  |

The default model's own `max_tokens` is 256, which is short for an agent — pass
more, as above.

### In the browser: the same agent, over a route

A page cannot hold a binding, so the page's client runs the OpenAI-compatible
provider against your own origin, with no key at all, and the Worker answers it
out of the binding:

```ts
// the Worker
import { handleChatCompletions } from '@tanstack/compose-cloudflare'

if (new URL(request.url).pathname === '/ai/chat/completions') {
  return handleChatCompletions(request, env.AI)
}
```

```ts
// the page
import { openaiModelPlugin } from '@tanstack/compose-agent-openai'

{
  id: 'model',
  plugin: openaiModelPlugin,
  // `credential: null`: this endpoint needs none from the browser.
  options: { model: 'workers-ai', baseUrl: '/ai', credential: null },
}
```

`handleChatCompletions(request, binding, options?)` takes `{ model, cors, stallMs }`.
`model` is the model to run when the body names none. `stallMs` (default 30 000)
is how long the binding may go quiet before the request fails, so a proxy that
loses its upstream cannot hold a turn open forever; `0` waits. `cors` is off by
default:
a page on the same origin needs none, and a route that hands itself to every
origin is a route anyone can spend your inference through.

### Local development

There is no local simulation of Workers AI — inference always runs on
Cloudflare — so `wrangler dev` needs a logged-in account for any route that uses
the binding, and those requests spend the account's allocation (10,000 neurons a
day are free).

## Running the example

```sh
pnpm --filter @tanstack/compose-cloudflare exec wrangler dev
curl 'http://localhost:8787/?a=2&b=3'

# these two need `wrangler login`
curl 'http://localhost:8787/ask?q=say+pong'
curl -X POST http://localhost:8787/ai/chat/completions \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"say pong"}],"stream":true}'
```

`dev/worker.ts` is a loader Worker that starts one written plugin, calls the
handler it registered through a stub, and reports what the plugin logged. It also
serves both halves of the model provider: `/ask` runs an agent on the binding,
and `/ai/chat/completions` is the route a browser client talks to.

The suite runs against a fake binding and needs no account. The one test that
runs a real model asks for itself by name:

```sh
pnpm --filter @tanstack/compose-cloudflare exec wrangler login
COMPOSE_WORKERS_AI_SMOKE=1 pnpm --filter @tanstack/compose-cloudflare test:lib
```

How it all fits together is in [`DESIGN.md`](./DESIGN.md).
