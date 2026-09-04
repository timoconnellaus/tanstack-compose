<img src="https://static.scarf.sh/a.png?x-pxid=tanstack-compose" />

# TanStack Compose

> **Status: pre-release, under active development.** The kernel, the Cloudflare host, the React adapter, the TanStack Start integration and pages 1–3 of the showcase are implemented and tested. The API is not stable and nothing is published to npm yet. This repository is public so colleagues can review the direction; see [ROADMAP.md](./ROADMAP.md) for what is done and what is next.

**A runtime extension surface for deployed applications.** You write your product as ordinary TypeScript. At the exact points you want to be changeable after deployment, you place a **slot**, declare an **action**, or offer a **grant**. Code that was not there at build time (written by an operator, a tenant, or an AI agent on a user's behalf) can then fill those slots, wrap those actions and use those grants while the application runs. It gets the same type-safety as the code you wrote yourself, and it can be taken back in one step.

The headline use case is an agent that updates the product it lives inside, in production, without a redeploy, and without being able to reach anything you did not hand it.

## What is possible

Everything below is demonstrated by one example application, [`examples/start/showcase`](./examples/start/showcase): a TanStack Start app on Cloudflare Workers where each page proves one property. The pages are the acceptance criteria of the project ([docs/acceptance/examples.md](./docs/acceptance/examples.md)).

| Page                | What it shows                                                                                                                                                                                                                                                       | Status   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Table**           | A button adds "export to CSV" to a data table as **plugin source**: a server half that reads the rows through a granted `data` stub, and a view that fills the toolbar slot. The button appears without a reload; removing the plugin removes it and leaks nothing. | done     |
| **Todo**            | A plugin changes **existing behaviour** without touching base code: middleware on the `list.sort` and `item.validate` actions sorts by due date and blocks empty titles. Removing it restores the original behaviour.                                               | done     |
| **Hostile gallery** | Source that throws, spins forever, calls `fetch`, forges another plugin's identity, smuggles a function, sends an oversized payload or reaches for `env` **fails the documented way**; sibling plugins stay active; the list can be reverted.                       | done     |
| **Digest**          | A plugin runs **unattended** on a schedule with no browser open, remembers its cursor across restarts and rewrites, and calls a model through the host's `ai` grant.                                                                                                | slice 8  |
| **Currency**        | A plugin reaches a **named service** with a server-side credential it can never read; any other origin is refused. No ambient network.                                                                                                                              | slice 8  |
| **Two tenants**     | One base, two isolated tenants: a plugin added for one never appears for the other; the same storage key holds different values.                                                                                                                                    | slice 8  |
| **Upgrade**         | The plugin list is a **log of generations**. Redeploying the base with a renamed API re-checks every plugin; the broken one lands in `error` with a readable diagnostic; you can revert to the last known good generation or fix the source.                        | slice 9  |
| **Pair**            | The **dependency graph** works for written code: plugin B waits for plugin A, is deactivated when A goes, and revives when A returns.                                                                                                                               | slice 9  |
| **Harness**         | An agent built on TanStack AI operates all of the above through compose's tool surface (list, add from catalog, write, rewrite, remove), with no compose code in its loop.                                                                                          | slice 10 |

Two things run through all of them:

- **Deployed.** One **client** per tenant lives in a Durable Object. Plugin source runs in isolated Dynamic Workers (server halves as Durable Object _facets_, so each keeps its own storage). Views are data, so the server renders every fill: a refresh is server-rendered with **no layout shift**, and while the page is open the browser follows live changes over a socket.
- **What type-checks is what runs.** Before source is started it is type-checked against declarations derived from exactly the grants it holds. A plugin cannot name a capability it was not given. The checker runs inside the Worker.

## Why a plugin system instead of bespoke code

Because the three authors are different people at different times ([ADR-0006](./docs/adr/0006-an-extension-surface-on-ordinary-code.md)):

- the **product developer** writes the base at build time, in ordinary TypeScript, and decides what is changeable;
- an **operator** edits the plugin list at runtime, with options validated by each plugin;
- an **agent** writes plugin _source_ at runtime, hosted and isolated, reaching only its **grants**.

A plugin is the unit of code that can be written by someone you do not trust, at a time you are not present, and taken back in one step. Your shell, routes and pages stay ordinary code; only the points you marked are open to plugins. The kernel is small (a few kB) because it carries nothing for the base to compose itself.

Authority is explicit ([ADR-0007](./docs/adr/0007-authority-is-named-grants.md)): a hosted plugin has no network, storage, timers or bindings of its own. `storage`, `schedule`, `http` (to a _named_ service, credential attached server-side), `ai` and `files` are grants the operator gives an entry, and every call is attributed to the calling instance so middleware can log, limit or refuse it.

## How it fits together

```
                    your application (ordinary TypeScript)
                      slots · actions · context keys · grants
                                      │
   ┌──────────────────────────────────┼──────────────────────────────────┐
   │  @tanstack/compose         the kernel: one client per tenant runs   │
   │                            an ordered plugin list; deps, actions,   │
   │                            middleware, events, cleanup, checker     │
   ├──────────────────────────────────┼──────────────────────────────────┤
   │  @tanstack/compose-typescript    type-checks written source against │
   │                                  its grants; runs in a Worker       │
   │  @tanstack/compose-cloudflare    hosts: isolate (Dynamic Worker)    │
   │                                  and facet (Durable Object facet)   │
   │  @tanstack/react-compose         provider, hooks, slots, view       │
   │                                  runtime (views are data)           │
   │  @tanstack/start-compose         TanStack Start: tenant Durable     │
   │                                  Object, server-rendered fills,     │
   │                                  follower socket, edits             │
   │  @tanstack/compose-devtools      panels on TanStack Devtools        │
   └─────────────────────────────────────────────────────────────────────┘
```

| Package                                                             | Description                                                                                                                                         |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@tanstack/compose`](./packages/compose)                           | The framework-agnostic kernel: plugin list, dependency graph, actions and middleware, events, resources, hosts.                                     |
| [`@tanstack/compose-typescript`](./packages/compose-typescript)     | Type-checks and transpiles written plugin source against the declarations of its granted stubs.                                                     |
| [`@tanstack/compose-cloudflare`](./packages/compose-cloudflare)     | Runs written source isolated on Cloudflare: Dynamic Worker isolates, Durable Object facets, loopback stubs, limits.                                 |
| [`@tanstack/react-compose`](./packages/react-compose)               | React adapter: provider, hooks, slots, and the framework-neutral view runtime.                                                                      |
| [`@tanstack/start-compose`](./packages/start-compose)               | TanStack Start integration: the tenant Durable Object, snapshot SSR and hydration, follower socket, edits.                                          |
| [`@tanstack/compose-devtools`](./packages/compose-devtools)         | Instances, unmet deps, resources, plugin list, context and errors on TanStack Devtools.                                                             |
| [`@tanstack/compose-agent`](./packages/compose-agent)               | The composer tool surface an agent operates, plus an agent loop used by an example. The loop is example code and is being moved out of the library. |
| [`@tanstack/compose-agent-openai`](./packages/compose-agent-openai) | An OpenAI-compatible model provider for that example.                                                                                               |

## A taste

The base declares what is changeable. Nothing else is.

```ts
import { createAction, createContextKey, createPlugin } from '@tanstack/compose'
import { createSlot } from '@tanstack/react-compose'

export const tableKey = createContextKey<TableData>('table')
export const tableActions = createSlot('table.actions') // a place a plugin may fill
export const listSortAction = createAction<{ items: Todo[] }, Todo[]>(
  'list.sort',
) // a behaviour a plugin may wrap

export const tablePlugin = createPlugin({
  name: 'table',
  provides: [tableKey, tableExportAction],
  setup(instance) {
    instance.provide(tableKey, { rows: demoRows })
    instance.defineAction(tableExportAction, () => toCsv(demoRows))
  },
})
```

A written plugin is a module. It receives only its grants, and it is type-checked against them before it starts:

```ts
// Source an agent (or a button in the showcase) adds at runtime. It holds one grant: `data`.
let api: Stubs
const setup: Setup = ({ stubs }) => {
  api = stubs
}
export default setup

export async function csv(): Promise<string> {
  const rows = await api.data({ operation: 'rows' }) // the only thing this plugin can reach
  return ['id,name,city,amount,due', ...rows.map(toRow)].join('\n')
}
```

Adding it is one edit to the plugin list. The kernel checks the source, starts it in a host, and settles; if it fails, it lands in `error` with the diagnostic and nothing else is affected.

```ts
await client.addPlugin({ id: 'export-csv', source, stubs: [dataStub] })
```

(Slice 9 replaces the tagged form `data({ operation: 'rows' })` with method calls, `data.rows()`, and generates the declarations from the base's types; see [ADR-0008](./docs/adr/0008-the-base-is-typed-once-and-versioned.md).)

## Running the showcase

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm --filter @tanstack/compose-example-showcase dev      # http://localhost:3061; the Worker runs in workerd with a real tenant Durable Object
pnpm --filter @tanstack/compose-example-showcase dev:browser  # the browser-only shape: client and host in the page, no Worker
pnpm --filter @tanstack/compose-example-showcase test:lib     # jsdom suite, then the deployed suite under vitest-pool-workers
pnpm test:ci                                                  # everything
```

Open the Table page, press **Add: export to CSV**, then **Export CSV**. Open the plugin panel to disable, remove or paste source. Refresh: the page is server-rendered with the button already there.

## Reading the repository

- [CONTEXT.md](./CONTEXT.md): the vocabulary (client, plugin, instance, host, stub, grant, slot, fill). Every document uses these words and no others.
- [docs/adr](./docs/adr): the decisions, each with what was rejected and why: types by inference, state in `@tanstack/store`, middleware over interception, the host contract, stubs as loopbacks, the extension-surface stance, named grants, generated declarations and generations.
- [docs/acceptance](./docs/acceptance): what "done" means, slice by slice; each criterion maps to a test.
- [ROADMAP.md](./ROADMAP.md): the build order and status.
- Each package has a `DESIGN.md` explaining how it meets its acceptance criteria and what it learned the hard way (the Cloudflare one records several Workers-runtime constraints worth knowing).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
