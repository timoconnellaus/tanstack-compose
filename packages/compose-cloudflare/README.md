# `@tanstack/compose-cloudflare`

A **host** for [`@tanstack/compose`](../compose) that runs **plugin source** in a
Cloudflare Dynamic Worker. The client sees an ordinary **plugin instance**; the
written code sees its **stubs** and nothing else — no network, no bindings, no
loader.

Use it when an agent writes plugins and you would rather not run what it wrote
in the same isolate as everything else.

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

## Running the example

```sh
pnpm --filter @tanstack/compose-cloudflare exec wrangler dev
curl 'http://localhost:8787/?a=2&b=3'
```

`dev/worker.ts` is a loader Worker that starts one written plugin, calls the
handler it registered through a stub, and reports what the plugin logged.

How it all fits together is in [`DESIGN.md`](./DESIGN.md).
