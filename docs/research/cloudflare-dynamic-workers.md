# Cloudflare Dynamic Workers (Worker Loader binding) for hot-loaded, agent-written plugins

Research for `tanstack-compose`. All sources are primary: developers.cloudflare.com, blog.cloudflare.com, the `cloudflare/workerd` and `cloudflare/workers-sdk` repos, and `@cloudflare/workers-types`. Everything marked **[verified locally]** was reproduced on this machine on **2026-08-30/31** with `wrangler` 4.127.1 (details in §5). Docs accessed **2026-08-30/31 UTC**.

## Executive summary

- The feature is called **Dynamic Workers**; the binding is the **Worker Loader** binding, configured as `worker_loaders` in Wrangler config, and exposed as `env.LOADER` with two methods: `load(code)` and `get(id, callback)`. It has its own docs product area at `developers.cloudflare.com/dynamic-workers/`.
- Status: announced closed beta 2025-09-26, **open beta 2026-03-24**, billing switched on **2026-05-26**. Docs no longer use the word "beta" anywhere in the Dynamic Workers section; it is **Workers Paid plan only**, no waitlist. I found no explicit "GA" announcement — treat "post-beta, generally available to paid accounts" as the practical status (**UNVERIFIED** as a formal GA label).
- It does exactly what the POC needs: load a Worker from source strings at runtime, per-isolate, with `compatibilityDate`/`compatibilityFlags`, ESM/CJS/text/data/json/wasm/python modules, a custom `env`, `globalOutbound: null` to cut off the network, `tails` for logs, and `limits: { cpuMs, subRequests }`.
- Calling in: `worker.getEntrypoint(name?, { props, limits }?)` returns a `Fetcher` you can `fetch()` **or** call RPC methods on (`WorkerEntrypoint` subclasses). `worker.getDurableObjectClass(name)` yields a DO class usable as a **Durable Object Facet** with its own SQLite DB.
- **It works fully locally.** `wrangler dev` runs Worker Loader in `local` mode with no flags, and it works inside `@cloudflare/vitest-pool-workers` — I ran both, including RPC into the child, `ctx.exports` custom bindings, egress blocking, and a Durable Object stub passed straight into the child's `env`. **[verified locally]**
- Main gotchas: pricing counts **unique (id, code) pairs per day**, so version your ids; caching is best-effort (callback may re-run, never assume one isolate); no source maps for child stack traces (workerd#6870); `worker_loaders` is **absent from the Wrangler configuration reference docs**; and a busy-loop child **wedged my local dev server** despite `limits.cpuMs` **[verified locally]**.
- Recommendation: Dynamic Workers is the right primitive for this POC. Assume one dynamic Worker per plugin version, `get("<plugin>:<contentHash>")`, `globalOutbound: null`, capabilities passed as `ctx.exports` RPC stubs, and DO Facets if a plugin needs state.

---

## 1. What it is, naming, status, pricing

### Names (exact)

| Thing               | Exact name                                                                      |
| ------------------- | ------------------------------------------------------------------------------- |
| Product / docs area | **Dynamic Workers** — `https://developers.cloudflare.com/dynamic-workers/`      |
| The loaded isolate  | **Dynamic Worker**                                                              |
| The binding         | **Worker Loader** binding                                                       |
| Wrangler JSON key   | `worker_loaders` (array of `{ "binding": "LOADER" }`)                           |
| Wrangler TOML key   | `[[worker_loaders]]` with `binding = "LOADER"`                                  |
| Runtime object      | `WorkerLoader` (methods `get`, `load`)                                          |
| Returned stub       | `WorkerStub` (methods `getEntrypoint`, `getDurableObjectClass`)                 |
| Code descriptor     | `WorkerCode`                                                                    |
| Older/legacy name   | "Dynamic Worker Loader API" / "Worker Loaders" (Sept 2025 blog + old docs page) |

The old page `https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/` now **301-redirects to `/dynamic-workers/`** (verified with `curl -I`, 2026-08-30).

### Status timeline (primary sources)

- **2025-09-26** — "Code Mode: the better way to use MCP" blog: _"The Dynamic Worker Loader API is in closed beta. To use it in production, sign up today"_ (Google Form), and _"Dynamic Worker Loading is fully available today when developing locally with Wrangler and `workerd`"_.
- **2026-03-24** — "Sandboxing AI agents, 100x faster" blog: _"Dynamic Worker Loader is now in open beta, available to all paid Workers users."_ Pricing stated as $0.002 per unique Worker loaded daily, **waived during beta**.
- **2026-05-26** — Pricing docs: _"Starting May 26, 2026, Dynamic Workers created daily are billed as part of Dynamic Workers pricing."_
- **2026-08-28** — Changelog: Durable Objects concurrent Dynamic Workers limit raised from 4 to 10.
- **Today (2026-08-31)**: the string "beta" does **not** appear anywhere in `https://developers.cloudflare.com/dynamic-workers/llms-full.txt` (grep, 0 hits). No allowlist/waitlist requirement is documented any more.

### Pricing / billing (docs: `/dynamic-workers/pricing/`)

> "Dynamic Workers are currently only available on the **Workers Paid plan**."

| Dimension                     | Included                               | Additional                         |
| ----------------------------- | -------------------------------------- | ---------------------------------- |
| Dynamic Workers created daily | 1,000 unique Dynamic Workers per month | +$0.002 per Dynamic Worker per day |
| Requests                      | 10 million per month                   | +$0.30 per million                 |
| CPU time                      | 30 million CPU-ms per month            | +$0.02 per million CPU-ms          |

Billing rules that matter for a plugin system:

- "A Dynamic Worker is uniquely identified by its **Worker ID** and **code** — if either changes, it counts as a new Dynamic Worker. The count resets daily."
- Same code + same id, many invocations = 1. Same id, different code versions = 1 per version. **`.load(code)` or no id = 1 per invocation.**
- Each `fetch()` into a Dynamic Worker and **each RPC method call on a Dynamic Worker stub** is a billed request (RPC billed like Durable Objects). Stubs returned from an RPC call (`RpcTarget`) share the session and are not re-billed.
- CPU time bills **startup time (isolate init + code parse) plus execution time** — unlike normal Workers, where startup is not billed.
- Usage visible in dash under Workers & Pages > Overview, or via GraphQL `workersInvocationsByOwnerAndScriptGroups { uniq { distinctDynamicWorkerCount } }` (data only from 2026-06-01).

Free-plan accounts get error **10195** on deploy (workers-sdk issues #13235, #13264).

---

## 2. The binding and the API

### Config

```jsonc
{
  "worker_loaders": [{ "binding": "LOADER" }],
}
```

That is the whole surface in Wrangler. `packages/config/src/bindings.ts` (workers-sdk) defines it as `interface WorkerLoaderBinding { type: "worker-loader" }` — **no other options**. Note that `workerd`'s own capnp schema (`src/workerd/server/workerd.capnp`, `workerLoader :group { id @27 :Text }`) supports an optional loader `id` so that _multiple bindings share one loader cache_; **this is not exposed through Wrangler config** — UNVERIFIED whether the production control plane exposes it.

⚠️ `worker_loaders` does **not** appear in the Wrangler configuration reference (`/workers/wrangler/configuration/`, grep = 0 hits, 2026-08-30). Documented only in the Dynamic Workers pages.

### Methods (docs `/dynamic-workers/api-reference/`)

```
env.LOADER.load(code: WorkerCode): WorkerStub
env.LOADER.get(id: string, getCodeCallback: () => Promise<WorkerCode>): WorkerStub
```

- `get()` returns the stub **synchronously** — no `await`. Requests made on it queue until the isolate loads; load failure throws on the request.
- `load()` never caches by id: "Each call creates a fresh Worker." Use for one-shot AI-generated code.
- `get(id, cb)`: the callback runs **only on a cache miss**. Docs: _"the isolate may be kept warm in memory for a while… But there is no guarantee: a later call with the same ID may instead start a new isolate from scratch."_

Authoritative TypeScript (from `@cloudflare/workers-types@5.20260830.1`, `experimental/index.d.ts` — also present in the stable `index.d.ts`):

```ts
interface WorkerLoader {
  get(
    name: string | null,
    getCode: () => WorkerLoaderWorkerCode | Promise<WorkerLoaderWorkerCode>,
  ): WorkerStub
  load(code: WorkerLoaderWorkerCode): WorkerStub
}
interface WorkerStub {
  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(
    name?: string,
    options?: WorkerStubEntrypointOptions,
  ): Fetcher<T>
  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>(
    name?: string,
    options?: WorkerStubEntrypointOptions,
  ): DurableObjectClass<T>
}
interface WorkerStubEntrypointOptions {
  props?: any
  limits?: workerdResourceLimits
}
interface WorkerLoaderWorkerCode {
  compatibilityDate: string
  compatibilityFlags?: string[]
  allowExperimental?: boolean
  limits?: workerdResourceLimits // { cpuMs?: number; subRequests?: number }
  mainModule: string
  modules: Record<string, string | WebAssembly.Module | WorkerLoaderModule>
  env?: any
  globalOutbound?: Fetcher | null
  tails?: Fetcher[]
  streamingTails?: Fetcher[]
}
interface WorkerLoaderModule {
  js?
  cjs?
  text?
  data?: ArrayBuffer
  json?: any
  py?
  wasm?: ArrayBuffer | ArrayBufferView | WebAssembly.Module
}
```

`wrangler types` generates `LOADER: WorkerLoader` into `worker-configuration.d.ts` **[verified locally]**.

`streamingTails` exists in `workerd` (`src/workerd/api/worker-loader.h`) and in the public types but is **not documented** on the Dynamic Workers docs pages — treat as UNVERIFIED/unsupported for now.

### Module formats

Plain string values infer type from extension: `.js` = ES module, `.py` = Python. Otherwise use an object with exactly one of `js` (ESM), `cjs` (CommonJS), `text` (imports as string), `data` (ArrayBuffer), `json` (parsed object; never actually serialized across), `py`, `wasm` (bytes or an already-compiled `WebAssembly.Module`, which shares compiled code with the child). Python requires `compatibilityFlags: ["python_workers"]` and docs warn Python Workers are "much slower to start" — use JS for agent code.

**There is no build step.** TypeScript/npm must be compiled first; Cloudflare ships `@cloudflare/worker-bundler` (`createWorker({ files })` → `{ mainModule, modules }`) which does TS compilation + npm resolution _inside_ a Worker.

### `compatibilityDate` / `compatibilityFlags` / `allowExperimental`

`compatibilityDate` is required and has the same meaning as `compatibility_date`. `allowExperimental: true` permits experimental flags in the child, but only if the **parent** Worker itself has the `"experimental"` compat flag — and "Experimental flags cannot be enabled in production."

Local caveat: the compat date you give the child must be ≤ the date supported by the bundled `workerd`. With an older wrangler (4.93.0) a 2026-08-01 date failed with _"This Worker requires compatibility date "2026-08-01", but the newest date supported by this server binary is "2026-05-25""_ **[verified locally]**. `workerd` also validates compat dates differently in workerd vs production (`CompatibilityDateValidation` is a constructor parameter of `api::WorkerLoader`, `src/workerd/api/worker-loader.h`).

### `env` — what you can pass into the child

Docs: `env` "is serialized and transferred into the dynamic Worker, where it is used directly as the value of `env` there. It may contain: structured clonable types; Service Bindings, including loopback bindings from `ctx.exports`."

- Passing a raw KV/R2/D1 binding is **not** the documented path. Docs explicitly say: "To pass resources like a KV namespace or R2 bucket to a Dynamic Worker, you need to bind the resource to your loader Worker and **create a custom binding that wraps it**" (a `WorkerEntrypoint` subclass exposing only the methods you want, scoped with `ctx.props`).
- The `workerd` source comment on the `env` field is broader: `// Any RPC-serializable value!` (`src/workerd/api/worker-loader.h`).
- **[verified locally]** I passed `env.COUNTER.getByName("shared")` (a **Durable Object stub**) directly into the child `env` and called an RPC method on it from inside the dynamic Worker — it worked and state persisted across calls (`DO ok: 1`, then `DO ok: 2`). Also passed a plain number. This is not documented, so treat DO-stub-passing as working-but-undocumented; the supported/portable pattern is a `WorkerEntrypoint` wrapper.
- `env` has a **1 MB** serialized size cap: `MAX_DYNAMIC_WORKER_ENV_SIZE = 1 * 1024 * 1024` in `src/workerd/api/worker-loader.c++`, enforced with "Dynamic Worker env size (N bytes) exceeds the maximum allowed size of 1048576".

### `globalOutbound` — egress control

- Omitted → child **inherits the parent's** global outbound, "which usually means the dynamic Worker will have full access to the public Internet". Default is _open_; you must opt in to isolation.
- `null` → "totally cut off from the network. Both `fetch()` and `connect()` will throw exceptions."
- Any `Fetcher` (service binding or `ctx.exports.X({ props })`) → all `fetch()`/`connect()` go to that entrypoint's `fetch()` instead, letting you allowlist hosts, inject credentials, or audit.

**[verified locally]** With `globalOutbound: null`, `fetch("https://example.com")` inside the child throws:

> `This worker is not permitted to access the internet via global functions like fetch(). It must use capabilities (such as bindings in 'env') to talk to the outside world.`

(matching `NullGlobalOutboundChannel` in `src/workerd/server/server.c++`).

### Caching / eviction semantics

From the API reference, verbatim points:

- Caching is keyed by the `id` string you pass to `get()`. "When a new ID is seen the first time, a new isolate is loaded. But, the isolate may be kept warm in memory for a while."
- "Because of the caching, you should ensure that the callback always returns exactly the same content, when called for the same ID. If anything about the content changes, you must use a new ID." Suggested ids: `<worker-name>:<version-number>` or a hash of code+config.
- "**It is never guaranteed that two requests will go to the same isolate.** Even if you use the same `WorkerStub`… they could execute in different isolates. The callback passed to `loader.get()` could be called any number of times."
- `workerd` confirms even `load()` (no id) can be evicted and re-created: _"The runtime can actually evict the isolate while a stub still exists, as long as there is no active request on the stub, and then recreate the isolate on the next request"_ (`worker-loader.c++`).
- No documented TTL, no cross-colo or cross-isolate sharing guarantee. **Warmth across colos is UNVERIFIED / assume none.** Playground docs note a cache hit shows "0ms cold start".

### Limits

| Limit                                                                                  | Value                                                                                                                 | Source                                      |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Total uncompressed module code per Dynamic Worker                                      | **64 MB** (`MAX_DYNAMIC_WORKER_CODE_SIZE`)                                                                            | `workerd/src/workerd/api/worker-loader.c++` |
| Serialized `env` size                                                                  | **1 MB** (`MAX_DYNAMIC_WORKER_ENV_SIZE`)                                                                              | same file                                   |
| Distinct Dynamic Workers with in-flight requests, per Worker request (per I/O context) | **4**                                                                                                                 | `/dynamic-workers/platform/limits/`         |
| Same, per Durable Object (shared I/O context)                                          | **10** (raised from 4 on 2026-08-28)                                                                                  | same + changelog                            |
| Per-invocation CPU / subrequests                                                       | your plan's Workers limits by default; lower them with `limits: { cpuMs, subRequests }`                               | `/dynamic-workers/usage/limits/`            |
| Number of Dynamic Workers you may create                                               | "unlimited"; blog: "Dynamic Worker Loader has no such limits" on concurrent sandboxes/creation rate                   | `/dynamic-workers/` index, blog             |
| Memory per isolate                                                                     | **not documented** — UNVERIFIED (blog only says "megabytes… 10x-100x more memory efficient than a typical container") |
| Startup time budget                                                                    | **not documented** — UNVERIFIED (blog: "milliseconds")                                                                |

Custom limits can also be applied at call time: `worker.getEntrypoint(null, { limits: { cpuMs: 10, subRequests: 5 } })`; "if limits were already specified as part of the worker code, the lower of the two limits is used". Exceeding either "will immediately throw an exception".

---

## 3. Calling into a loaded Worker

`worker.getEntrypoint(name?, options?)` returns a `Fetcher`:

- No name (or `"default"`) → the child's `export default`. `workerd` normalises the literal string `"default"` to the default entrypoint (`worker-loader.c++`).
- With a name → a named export that extends `WorkerEntrypoint`, e.g. `worker.getEntrypoint("Agent").run()`.
- `options` = `{ props, limits }`. `props` becomes `this.ctx.props` **inside the child entrypoint**.
- **fetch**: `await worker.getEntrypoint().fetch(request)`.
- **RPC**: call methods directly on the stub — `await worker.getEntrypoint("Plugin").add(2, 3)` **[verified locally]** (returned `5`). Nested/returned `RpcTarget` stubs share the RPC session.

`worker.getDurableObjectClass(name?, options?)` returns a `DurableObjectClass` used with **Durable Object Facets** (§6). Ordinary DO _namespaces_ cannot be declared by a dynamic Worker — a dynamic DO class only becomes live when a supervisor DO instantiates it as a facet.

Whole-Worker stub, not per-entrypoint: the `workerd` header describes `WorkerStub` as "not a stub for a specific entrypoint, but instead the entire Worker, allowing the caller to call any entrypoint (and specify arbitrary props)".

---

## 4. Isolation and security

What Cloudflare claims:

- Each Dynamic Worker is a **separate V8 isolate**, the same primitive that separates Cloudflare's own tenants; the blog frames it as a container replacement ("100x faster and 10x-100x more memory efficient than a typical container"), citing V8 patching within hours, custom sandboxing layers, hardware features (MPK) and malicious-code scanning.
- The Workers security model (`/workers/reference/security-model/`) is the underlying guarantee: `Date.now()` is frozen while code executes, no other timers, no concurrency/multi-threading, so code "cannot measure its own execution time locally" — the core anti-Spectre design. Cloudflare sometimes moves a Worker into its own process for extra isolation.
- **Capability-based sandboxing** is the documented security story: "a Dynamic Worker can only access what you explicitly give it. If it hasn't received a stub for something, it can't access it… Stubs have no global identifier and cannot be forged, the only way to obtain one is to receive it." Backed by Workers RPC / Cap'n Web.
- Egress default-open, so the sandbox is only as tight as your `globalOutbound`.
- `ctx.props` on a stub are readable only by the loader Worker: "the Dynamic Worker never sees them".
- Facet storage: "The dynamic code cannot read the supervisor's database."

What is **not** guaranteed / not stated:

- No formal statement that a Dynamic Worker is a security boundary _equivalent to_ a container or VM; the security-model page is explicit that "There is no fix for Spectre" and that Workers relies on removing timers rather than on process/VM isolation. Cross-tenant side channels are mitigated, not eliminated.
- No documented guarantee that two different Dynamic Workers never share a process/isolate group — **UNVERIFIED**.
- `eval` and `new Function` are **available inside the child** (`typeof eval === "function"`) **[verified locally]**; V8 is not locked down beyond the normal Workers API surface.
- No memory cap is documented per Dynamic Worker; a runaway allocation's blast radius is UNVERIFIED.
- CPU limits are enforced "immediately throw" per docs, but see the local-dev failure in §5/§8.
- No content scanning/AV of the code you load is promised on your behalf.
- The `WorkerCode` object is **not validated** for unknown/typo'd fields — open workerd issue #5681 "Should the Dynamic Worker Loader API validate the `WorkerCode` object passed to it?" (a typo'd `globalOutbound` silently means "inherit parent egress", i.e. fail-open).

---

## 5. Local development and testing — verified

### `wrangler dev`

Works, no flags, no account, `local` mode. Wrangler prints:

```
Binding            Resource           Mode
env.LOADER         Worker Loader      local
```

**Minimum version:** `worker_loaders` shipped as an _unsafe/experimental_ binding in **wrangler 4.32.0** ("Support unsafe dynamic worker loading bindings", PR #10012) and was **stabilised in wrangler 4.39.0** ("Stabilise Worker Loader bindings", PR #10721); a binding-type fix landed in 4.40.2. **Use ≥ 4.39.0; I tested 4.127.1.** Miniflare implements it as a first-class plugin (`packages/miniflare/src/plugins/worker-loader/index.ts`, `WORKER_LOADER_PLUGIN_NAME = "worker-loader"`), emitting a `workerLoader: {}` runtime binding — nothing to configure.

Minimal repro I ran (`wrangler.jsonc` + `src/index.ts`, wrangler 4.127.1, macOS, 2026-08-30):

| Behaviour                                                                      | Result                                                                                                               |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `env.LOADER.get(id, cb)` + `getEntrypoint().fetch()`                           | ✅ `hello from dynamic`                                                                                              |
| Named entrypoint RPC `getEntrypoint("Plugin").add(2,3)`                        | ✅ `5`                                                                                                               |
| Custom binding via `ctx.exports.Host({ props: { tenant } })` called from child | ✅ `pong:acme`, props invisible to child                                                                             |
| `globalOutbound: null` blocking `fetch()`                                      | ✅ throws the "not permitted to access the internet" error                                                           |
| Child `console.log`                                                            | ✅ appears directly in `wrangler dev` output (no Tail Worker needed locally)                                         |
| Child `fetch` handler throwing                                                 | ✅ parent catches; `e.message === "child fetch exploded"`                                                            |
| Child RPC method throwing                                                      | ✅ parent catches; message preserved, **stack points at the parent bundle** (no child source map)                    |
| DO stub passed in `env`, RPC'd from child                                      | ✅ `DO ok: 1` → `DO ok: 2`                                                                                           |
| `typeof eval` inside child                                                     | ✅ `"function"`                                                                                                      |
| `limits: { cpuMs: 50 }` + `while(true){}` in child                             | ❌ **request never returns and the whole `wrangler dev` server becomes permanently unresponsive** (reproduced twice) |

That last row is the significant local-only hazard: **do not let a test run untrusted/agent-written code with unbounded loops under `wrangler dev`** — CPU limits appear not to be enforced by local `workerd`, and the process wedges. Add your own wall-clock timeout around child calls in tests, or pre-screen code.

### `wrangler.jsonc` used

```jsonc
{
  "name": "dwtest",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-01",
  "worker_loaders": [{ "binding": "LOADER" }],
}
```

### Vitest

**Yes — verified.** With `@cloudflare/vitest-pool-workers@0.22.0` + `vitest@4.1.11`, 4/4 tests passed, including `SELF.fetch()` through the loader **and** using `env.LOADER` directly inside the test isolate (`loader.load({...}).getEntrypoint().fetch()`).

Two API notes discovered while doing this:

- `@cloudflare/vitest-pool-workers@0.22.0` **requires `vitest@^4.1.0`** (peer dep) and **no longer exports `./config`** — `defineWorkersConfig` from `@cloudflare/vitest-pool-workers/config` fails with `Missing "./config" specifier`. The current shape is a Vite plugin:

```ts
// vitest.config.mts
import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
})
```

- The package is being renamed: in `workers-sdk` `main` the directory is now `packages/vitest-plugin` publishing **`@cloudflare/vitest-plugin`** (v1.1.2), and the docs' known-issues page already imports `cloudflareTest` from `@cloudflare/vitest-plugin`. Both packages are published and current; `@cloudflare/vitest-pool-workers` 0.22.0 was published 2026-08-18. There is a codemod `@cloudflare/vitest-pool-workers/codemods/vitest-v3-to-v4`. Prefer `@cloudflare/vitest-plugin` for new code.

There is an official fixture in workers-sdk: `fixtures/dynamic-worker-loading/` (wrangler.jsonc + `src/index.ts` + a `createTestHarness` integration test).

### Local vs production differences

- **Compat-date validation differs by design**: `api::WorkerLoader` takes a `CompatibilityDateValidation` that "will differ between workerd vs. production"; `workerd` uses `FUTURE_FOR_TEST` / `CODE_VERSION` modes (`server.c++`). Locally you are capped by the workerd binary bundled with your wrangler version.
- **Logs**: locally child `console.log` surfaces in the dev output; in production you must attach a Tail Worker (§7).
- **CPU limits**: not enforced locally in my test (production docs say they throw immediately).
- **Caching/eviction**: local workerd keeps a simple per-namespace `HashMap` of named isolates (`Server::WorkerLoaderNamespace::loadIsolate`, `server.c++`); production eviction is opaque. Do not tune for local warmth.
- **Billing/plan**: no plan gate locally; production requires Workers Paid.

---

## 6. Durable Objects and other bindings

- **A Durable Object can hold and use a Worker Loader binding.** The Facets docs show `this.env.LOADER.get(...)` called from inside a DO class. That DO gets the higher concurrency allowance (10 distinct Dynamic Workers in flight vs 4 for a plain Worker request).
- **Dynamic Workers can hold state via Durable Object Facets.** The dynamic code exports a class extending `DurableObject`; the supervisor does:

```js
const facet = this.ctx.facets.get('app', async () => {
  const worker = this.env.LOADER.get('agent-code-v1', async () => ({
    /* WorkerCode */
  }))
  return { class: worker.getDurableObjectClass('App') }
})
return await facet.fetch(request)
```

Each named facet gets **its own SQLite database inside the parent DO**; "The dynamic code cannot read the supervisor's database." Requires `new_sqlite_classes` migration for the supervisor. `this.ctx.facets` API: `get(name, callback) → Fetcher`, `abort(name, reason)` (invalidates stubs, keeps storage — the documented way to hot-swap to a new code version), `delete(name)` (aborts + destroys the SQLite DB). `FacetStartupOptions = { class, id? }`; `id` overrides what the facet sees as its own `ctx.id`, otherwise it inherits the parent's.

- **Passing a DO stub into a dynamic Worker's `env`**: works **[verified locally]**, but is not in the docs; the documented approach is to wrap it in a `WorkerEntrypoint`. Same for KV/R2/D1 — docs explicitly prescribe the wrapper (with `ctx.props` for per-tenant key prefixes).
- **Service bindings / RPC stubs**: fully supported both as `env` entries and as `globalOutbound`.
- **Workflows**: `@cloudflare/dynamic-workflows` lets a dynamic Worker create Workflows with durable execution; the library tags each workflow with the originating Dynamic Worker so the engine can reload the right code on resume.
- **Static assets**: supported via a wrapper binding pattern (`/dynamic-workers/usage/static-assets/`), not via the normal `assets` config.

---

## 7. Observability

- Dynamic Workers do **not** show up in the loader's Workers Logs automatically: "Workers Logs only captures log output from the loader Worker itself. Dynamic Workers are separate, so their `console.log()` calls are not included automatically."
- The mechanism is **Tail Workers passed in `tails: [...]`**, typically as loopback entrypoints: `tails: [ctx.exports.DynamicWorkerTail({ props: { workerId } })]`. The tail class implements `async tail(events)`; "events will always be an array of size 1 in this scenario". Inside it you `console.log(...)` structured JSON, which lands in the loader's Workers Logs (requires `"observability": { "enabled": true, "head_sampling_rate": 1 }` on the loader).
- Tail Workers run **after** the response, so no added latency.
- Captured: `console.log` output, **exceptions**, and request metadata.
- Real-time logs pattern (for a dev UI): tail writes into a `LogSession` Durable Object, the `fetch()` handler reads them back (`getLogs(1000)`), as in the Dynamic Workers Playground.
- **Exceptions thrown by the child propagate to the parent as normal catchable errors** with the message intact **[verified locally]** — for both `fetch()` and RPC.
- **Stack traces are not mapped back to the child's source** — open feature request `cloudflare/workerd#6870` "Source map support for Worker Loader (dynamic workers) stack traces" (opened 2026-07-08, still open). Locally the stack pointed into the parent's bundled `index.js` **[verified locally]**.
- Locally, child logs appear directly in `wrangler dev` output; wrangler's Local Explorer also exposes a `/cdn-cgi/local/explorer/api/local/observability/query` SQL endpoint over captured spans/logs.

---

## 8. Known gotchas, open issues, roadmap

Verified gotchas:

1. **Egress is default-open.** Omitting `globalOutbound` inherits the parent's network access. Always set `null` (or a gateway) explicitly.
2. **`WorkerCode` is not validated** — `cloudflare/workerd#5681` (open, 2025-12-11). A misspelled key is silently ignored, which for `globalOutbound` fails _open_.
3. **No source maps for child stack traces** — `cloudflare/workerd#6870` (open).
4. **Billing is per unique (id, code) per day.** `load()` or random ids = a billed Dynamic Worker per invocation. Version ids by content hash.
5. **Callback must be pure and stable per id**; if code changes, change the id. The callback may be invoked any number of times, in any isolate.
6. **CPU startup time is billed** for Dynamic Workers (not so for normal Workers).
7. **Concurrency cap of 4 distinct dynamic Workers per Worker request** (10 inside a DO) — a plugin pipeline that fans out to more than 4 plugins concurrently from one request will hit this. Requests to the _same_ dynamic Worker count once.
8. **Local `wrangler dev` hangs permanently on a child busy-loop** despite `limits.cpuMs` **[verified locally, 4.127.1]** — I found no matching public issue; consider filing one.
9. **`worker_loaders` is missing from the Wrangler configuration reference docs**; editors/JSON-schema tooling may lag.
10. **Free plans**: deploy fails with error 10195 (workers-sdk #13235 closed as "poor error message", #13264).
11. Historic, now fixed: `workerd#5460` "Worker Loader does not support WASM modules" (closed — wasm is supported now); `workerd#6506` isolate-teardown crash "tried to defer destruction during isolate shutdown" (closed 2026-04).
12. **No build step** — TypeScript/npm must be bundled (use `@cloudflare/worker-bundler`), and bundling at runtime costs CPU on the loader Worker.

Roadmap signals (from primary sources): `streamingTails` exists in the runtime but is undocumented; `// TODO(someday): cache API outbound?` in `worker-loader.h` suggests Cache API interception is not yet controllable; DO facet concurrency was just raised (2026-08-28), suggesting the DO-hosted-loader pattern is actively being invested in.

---

## 9. Minimal code examples (from official docs)

### `wrangler.jsonc`

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "my-plugin-host",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-28",
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "worker_loaders": [{ "binding": "LOADER" }],
}
```

### Parent loading a child from a string, network blocked, called via `fetch`

```js
export default {
  async fetch(request, env) {
    const worker = env.LOADER.load({
      compatibilityDate: '2026-08-28',
      mainModule: 'src/index.js',
      modules: {
        'src/index.js': `
          export default {
            fetch(request) {
              return new Response("Hello from a dynamic Worker");
            },
          };
        `,
      },
      // Block all outbound network access from the Dynamic Worker.
      globalOutbound: null,
    })

    let entrypoint = worker.getEntrypoint()
    return entrypoint.fetch(request)
  },
}
```

### Cached by id, custom capability binding, called via RPC on a named entrypoint

```ts
import { WorkerEntrypoint } from 'cloudflare:workers'

export class ChatRoom extends WorkerEntrypoint<Cloudflare.Env, ChatRoomProps> {
  async post(text: string): Promise<void> {
    let { apiKey, botName, roomName } = this.ctx.props
    await postToChat(apiKey, roomName, `[${botName}]: ${text}`)
  }
}

// inside fetch(request, env, ctx):
let chatRoom = ctx.exports.ChatRoom({
  props: { apiKey, roomName: '#bot-chat', botName: 'Robo' },
})

let worker = env.LOADER.load({
  env: { CHAT_ROOM: chatRoom },
  compatibilityDate: '2026-08-28',
  mainModule: 'index.js',
  modules: {
    'index.js': `
      export class Agent extends WorkerEntrypoint {
        async run() {
          await this.env.CHAT_ROOM.post("Hello!");
        }
      }
    `,
  },
  globalOutbound: null,
})

return worker.getEntrypoint('Agent').run()
```

### `get(id, callback)` with a Tail Worker and custom limits

```js
const worker = env.LOADER.get(`plugin:${pluginId}:${codeHash}`, async () => {
  const code = await env.MY_CODE_STORAGE.get(codeHash)
  return {
    compatibilityDate: '2026-08-28',
    mainModule: 'index.js',
    modules: { 'index.js': code },
    globalOutbound: null,
    limits: { cpuMs: 50, subRequests: 5 },
    tails: [ctx.exports.DynamicWorkerTail({ props: { pluginId } })],
  }
})

return worker.getEntrypoint().fetch(request)
```

### Outbound gateway (allowlist / credential injection)

```js
import { WorkerEntrypoint } from 'cloudflare:workers'

export class HttpGateway extends WorkerEntrypoint {
  async fetch(request) {
    let url = new URL(request.url)
    const headers = new Headers(request.headers)
    if (url.hostname === 'api.example.com') {
      headers.set('Authorization', `Bearer ${this.env.API_TOKEN}`)
      headers.set('X-Tenant-Id', this.ctx.props.tenantId)
    }
    return fetch(request, { headers })
  }
}
// ... globalOutbound: ctx.exports.HttpGateway({ props: { tenantId } })
```

---

## 10. Alternatives on Cloudflare, and the recommendation

| Option                                            | Isolation                                                                                                           | Deploy/update latency                                                                                     | State                                          | Fit for agent-written plugins                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Dynamic Workers / Worker Loader**               | Separate V8 isolate per dynamic Worker; capability-based `env`; egress controllable                                 | **Runtime, milliseconds** — no API call, no deploy                                                        | Via DO Facets, or via capabilities you hand in | **Best fit.** Code is data; nothing to register.                                                                                   |
| **Workers for Platforms** (dispatch namespaces)   | Separate Worker per tenant, full platform isolation, per-customer custom limits, tags, namespace-wide observability | Requires uploading a script to a dispatch namespace via API before it can run; script lifecycle to manage | Full binding set per user Worker               | Right for _durable, customer-owned apps_ with domains/routes. Heavier for ephemeral, per-edit plugin versions.                     |
| **Sandbox SDK / Containers**                      | Full Linux container per sandbox, strongest boundary, arbitrary processes/languages                                 | Container start (orders of magnitude slower than an isolate; blog claims isolates are "100x faster")      | Filesystem, processes, preview URLs            | Right when the plugin needs a shell, a real filesystem, arbitrary binaries, or long-running processes. Overkill for a JS function. |
| **`eval` / `new Function` in the parent isolate** | **None** — same isolate, same globals, same `env`; the code can read your secrets and bindings                      | Instant                                                                                                   | Shared                                         | Not acceptable for untrusted/agent-written code. Only for code you fully control.                                                  |

### Recommendation

Use **Dynamic Workers** for `tanstack-compose` plugins. It is the only Cloudflare primitive where "the plugin's source code is a value in a variable" is the native model, it costs milliseconds to hot-load, it runs identically under `wrangler dev` and in vitest, and its capability model matches a plugin API surface exactly: the host defines what a plugin may do as `WorkerEntrypoint` methods, and the plugin gets nothing else.

Switch to Workers for Platforms only if plugins become long-lived, customer-owned deployments needing their own hostnames/routes; switch to Sandbox SDK/Containers only if a plugin needs a filesystem, a shell, or non-JS toolchains.

### What the POC should assume

1. **Config**: `"worker_loaders": [{ "binding": "LOADER" }]`, wrangler **≥ 4.39.0** (test on ≥ 4.127.1), Workers **Paid** plan for anything deployed.
2. **Identity**: `env.LOADER.get(\`${pluginId}:${sha256(code + configHash)}\`, cb)`. Never `load()` in a hot path (billing + no reuse). Never mutate code behind a stable id.
3. **Purity**: the `get` callback may run any number of times, in any isolate, at any time — it must be a pure function of the id (fetch code from KV/D1/R2 inside it, nothing else).
4. **Sandbox posture**: always set `globalOutbound: null` by default; opt individual plugins up to an `HttpGateway` entrypoint with an explicit host allowlist. Always set `limits: { cpuMs, subRequests }`.
5. **Plugin API**: expose host capabilities exclusively as `ctx.exports.X({ props })` `WorkerEntrypoint` stubs in `env` — never raw KV/R2/D1/secrets. Ship TypeScript `.d.ts` for those stubs to the agent as the plugin-authoring contract (docs recommend exactly this).
6. **Entrypoint convention**: have plugins export a named `WorkerEntrypoint` (e.g. `export class Plugin extends WorkerEntrypoint`) and call it via `worker.getEntrypoint("Plugin").someMethod()` — RPC, not HTTP, gives typed args/returns and streams stubs back.
7. **State**: default to stateless plugins; when a plugin needs persistence, host it as a **Durable Object Facet** under a supervisor DO (`ctx.facets.get`), and use `ctx.facets.abort(name)` + a new code id to hot-swap versions.
8. **Concurrency**: fan-out is capped at 4 distinct dynamic Workers in flight per request (10 from a DO) — design the composition layer to sequence or batch beyond that.
9. **Observability**: attach `tails: [ctx.exports.PluginTail({ props: { pluginId } })]` from day one; child errors surface to the parent with messages but no useful stack, so log inside the plugin harness.
10. **Tests**: `@cloudflare/vitest-pool-workers` (or `@cloudflare/vitest-plugin`) with `cloudflareTest({ wrangler: { configPath } })` and vitest ≥ 4.1; `env.LOADER` is usable directly in tests. **Wrap every child call in a wall-clock timeout** — an unbounded loop in a child wedges local `workerd` permanently.
11. **Bundling**: assume plugins arrive as pre-bundled ESM. If the agent may use npm/TS, budget for `@cloudflare/worker-bundler` running in the loader Worker (CPU cost on your bill) or bundle in CI.

---

## Sources

All accessed 2026-08-30/31 UTC.

**Cloudflare docs**

- Dynamic Workers overview — https://developers.cloudflare.com/dynamic-workers/
- Getting started — https://developers.cloudflare.com/dynamic-workers/getting-started/
- API reference (`load`, `get`, `WorkerCode`, `globalOutbound`, `env`, `tails`) — https://developers.cloudflare.com/dynamic-workers/api-reference/
- Pricing — https://developers.cloudflare.com/dynamic-workers/pricing/
- Platform limits (4 / 10 concurrent) — https://developers.cloudflare.com/dynamic-workers/platform/limits/
- Custom resource limits — https://developers.cloudflare.com/dynamic-workers/usage/limits/
- Bindings & capability-based sandboxing — https://developers.cloudflare.com/dynamic-workers/usage/bindings/
- Egress control — https://developers.cloudflare.com/dynamic-workers/usage/egress-control/
- Observability / Tail Workers — https://developers.cloudflare.com/dynamic-workers/usage/observability/
- Durable Object Facets — https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/
- Dynamic Workflows — https://developers.cloudflare.com/dynamic-workers/usage/dynamic-workflows/
- Static assets — https://developers.cloudflare.com/dynamic-workers/usage/static-assets/
- Examples: Playground / Starter / Code Mode — https://developers.cloudflare.com/dynamic-workers/examples/
- Machine-readable dump of the above — https://developers.cloudflare.com/dynamic-workers/llms-full.txt
- Redirect source (old page) — https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/ → 301 to /dynamic-workers/
- Changelog, DO limit raised to 10 — https://developers.cloudflare.com/changelog/post/2026-08-28-durable-objects-dynamic-workers-limit/
- Workers security model (Spectre, timers) — https://developers.cloudflare.com/workers/reference/security-model/
- Workers for Platforms — https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/
- Sandbox SDK — https://developers.cloudflare.com/sandbox/
- Vitest integration known issues (uses `@cloudflare/vitest-plugin`) — https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/

**Cloudflare blog**

- "Sandboxing AI agents, 100x faster" (2026-03-24, open beta) — https://blog.cloudflare.com/dynamic-workers/
- "Code Mode: the better way to use MCP" (2025-09-26, closed beta + local availability) — https://blog.cloudflare.com/code-mode/

**workerd (github.com/cloudflare/workerd, branch `main`)**

- `src/workerd/api/worker-loader.h` — `WorkerStub`, `WorkerLoader`, `Module`, `WorkerCode`, `streamingTails`, TS overrides
- `src/workerd/api/worker-loader.c++` — `MAX_DYNAMIC_WORKER_CODE_SIZE = 64 MB`, `MAX_DYNAMIC_WORKER_ENV_SIZE = 1 MB`, `"default"` entrypoint normalisation, eviction comment
- `src/workerd/server/server.c++` — `Server::WorkerLoaderNamespace`, `NullGlobalOutboundChannel` error text, `CompatibilityDateValidation`
- `src/workerd/server/workerd.capnp` — `workerLoader :group { id @27 :Text }` (shared loader cache)
- Issues: #5681 (validate `WorkerCode`, open), #6870 (source maps, open), #5460 (wasm, closed), #6506 (teardown crash, closed)

**workers-sdk (github.com/cloudflare/workers-sdk, branch `main`)**

- `packages/wrangler/CHANGELOG.md` — 4.32.0 "Support unsafe dynamic worker loading bindings" (#10012), 4.39.0 "Stabilise Worker Loader bindings" (#10721), 4.40.2 "Fix Worker Loader binding type" (#10771)
- `packages/miniflare/src/plugins/worker-loader/index.ts` — local implementation
- `packages/config/src/bindings.ts` — `WorkerLoaderBinding { type: "worker-loader" }`
- `fixtures/dynamic-worker-loading/` — official local fixture (`wrangler.jsonc`, `src/index.ts`, `tests/index.test.ts`)
- `packages/vitest-plugin/` — `@cloudflare/vitest-plugin` v1.1.2 (successor naming to `@cloudflare/vitest-pool-workers`)
- Issues: #13235, #13264 (free-plan error 10195)

**Types / npm**

- `@cloudflare/workers-types@5.20260830.1` — `WorkerLoader`, `WorkerStub`, `WorkerLoaderWorkerCode`, `WorkerLoaderModule`, `workerdResourceLimits`
- `@cloudflare/vitest-pool-workers@0.22.0` (peer `vitest@^4.1.0`, exports `cloudflareTest`), `@cloudflare/vitest-plugin@1.1.2`, `wrangler@4.127.1`
- `@cloudflare/worker-bundler`, `@cloudflare/codemode`, `@cloudflare/dynamic-workflows` (npm)

**Local experiments (this machine, 2026-08-30/31)** — scratch project at `/Users/tim/.claude/jobs/35f59ce6/tmp/dwtest`, wrangler 4.127.1: `wrangler dev` loader binding, RPC, `ctx.exports` bindings, `globalOutbound: null`, child logs, child exceptions, DO stub in `env`, `typeof eval`, CPU busy-loop hang, and 4 passing `@cloudflare/vitest-pool-workers` tests.
