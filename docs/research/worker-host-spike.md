# Worker + Hardened JavaScript as a portable Host

Background reading for roadmap slice 6 (`@tanstack/compose-worker`). Not a spec.
Spike code: [`spikes/worker-host/`](../../spikes/worker-host/). Run it with
`node scenarios/run-all.ts`, `bun scenarios/run-all.ts`, or `npx vite dev` +
open the page.

Measured 2026-08-31 on macOS 15 / arm64 (M-series), `ses` 1.15.0,
Node v25.5.0, Bun 1.3.6, Chromium 1234 (Playwright build) via `agent-browser`.

## Executive summary

**Yes — one implementation, three runtimes, no per-runtime plugin-facing code.**

| Runtime                      | Result                 | Notes                                                                                   |
| ---------------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| **Bun 1.3.6**                | **yes**, 8/8 scenarios | WHATWG `Worker` global; fastest spawn, lightest workers; noisy `ses` intrinsic warnings |
| **Node ≥22 (tested 25.5.0)** | **yes**, 8/8 scenarios | `node:worker_threads`; ran the `.ts` worker entry directly via native type stripping    |
| **Chromium (browser)**       | **yes**, 8/8 scenarios | Vite dev + prod build; needs the literal `new Worker(new URL(…))` form                  |
| Firefox / Safari             | **untested**           | out of the time box                                                                     |
| Deno                         | **untested**           | not part of the question                                                                |

All four requirements hold on all three tested runtimes:

1. Plugin source is a string, evaluated in a `Compartment` whose only own
   enumerable globals are the four stubs we inject. `fetch`, `process`, `Bun`,
   `Deno`, `setTimeout`, `XMLHttpRequest`, `WebSocket`, `importScripts`,
   `postMessage` and `require` are all `undefined` inside it.
2. Bidirectional async RPC over `postMessage` with request ids works in both
   directions, including plugin → host → plugin within a single call.
3. `while(true){}` is killed by `worker.terminate()` on a wall-clock budget; the
   host reports a `PluginTimeoutError` and keeps serving other plugins.
4. `unload()` settles only once the thread is gone, rejects in-flight calls, and
   is idempotent.

The **whole plugin-facing surface is portable**. Exactly two host-side lines
branch per runtime, both in `src/worker-shim.ts` / `scenarios/harness.ts`.

## Measurements

`ses` cost is dominated by parsing the shim, not by `lockdown()` itself.

| Measurement                             | Node 25.5.0 | Bun 1.3.6 | Chromium                  |
| --------------------------------------- | ----------- | --------- | ------------------------- |
| Worker spawn → `ready` (mean of 5)      | 34.3 ms     | 15.9 ms   | 9.9 ms                    |
| …of which `lockdown()`                  | 3.9 ms      | 6.0 ms    | 3.1 ms                    |
| Host→plugin→host call, median           | 12 µs       | 10 µs     | (unmeasurable, see below) |
| …p95                                    | 15 µs       | 41 µs     | ≤100 µs                   |
| …p99                                    | 20 µs       | 131 µs    | ≤100 µs                   |
| 64 KB `Uint8Array` echo, mean           | 29 µs       | 41 µs     | 41 µs                     |
| Plugin→host stub call in a loop (1000×) | 12 µs       | 15 µs     | 13 µs                     |
| RSS per idle worker (10 workers)        | ~17.5 MB    | ~5.0 MB   | not observable            |

Chromium's `performance.now()` is coarsened to 100 µs without cross-origin
isolation, so sub-100 µs latency cannot be measured from the page; the loop
figure (13 µs/call, amortised over 1000 calls in one timed span) is the usable
browser number. `performance.memory` reports the **main thread only**, so
per-worker memory is not observable from a page at all.

`ses` bundle size (1.15.0):

| Artifact                                                                            | Raw         | gzip        |
| ----------------------------------------------------------------------------------- | ----------- | ----------- |
| `dist/ses.mjs` (prebuilt)                                                           | 472 KB      | 111 KB      |
| `dist/ses.umd.min.js` (prebuilt)                                                    | 215 KB      | 44 KB       |
| **Vite-bundled worker chunk** (`ses` ESM + our worker entry, tree-shaken, minified) | **77.8 KB** | **26.3 KB** |

Importing `ses` from its ESM entry and letting the bundler tree-shake it costs
26 KB gzip — roughly 40% of the prebuilt minified UMD. Do not ship `dist/`.

## What `ses` gives, and what it does not

**Gives** (all confirmed by scenario 2):

- **No ambient authority.** The compartment global carries only our endowments.
- **`Function` constructor tamed.** `(function(){}).constructor('…')` throws
  `Function.prototype.constructor is not a valid constructor` — `lockdown()`
  replaces `%FunctionPrototype%.constructor` with a throwing stub
  (`ses/src/tame-function-constructors.js`).
- **Frozen primordials.** `Array.prototype.pwned = 1` and
  `Object.prototype.pwned = 1` both throw. Prototype pollution is dead.
- **Confined evaluators.** The compartment's own `Function` and `eval` still
  work, but compile _in the compartment's scope_: `Function('return globalThis')()`
  yields the compartment global, and code built that way still cannot see `fetch`.
- **Compile-time censorship.** Source containing a direct `eval(…)` call
  (`SES_EVAL_REJECTED`), a dynamic `import(…)` (`SES_IMPORT_REJECTED`), or
  `import.meta` is **rejected at load**, before evaluation
  (`ses/src/transforms.js`).

**Does not give** — and this is why the Worker is load-bearing:

- **No CPU isolation.** A frozen `while(true){}` is still `while(true){}`.
  Only `terminate()` on a separate thread stops it (scenario 3).
- **No memory isolation.** A plugin allocated 64 MB inside its compartment with
  no complaint (scenario 8), and 4 GB when we tried harder.
- **No wall-clock accounting, no I/O accounting.** There is nothing in `ses` to
  hang a quota on.

**The Worker boundary covers CPU. It does not fully cover memory.** Confirmed
with `scenarios/memory-cap.ts`:

| Runtime | Per-worker heap cap                     | Result                                                                                                                                                                                                                                                             |
| ------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node    | `resourceLimits.maxOldGenerationSizeMb` | Works for ordinary JS objects — the worker dies with `ERR_WORKER_OUT_OF_MEMORY` on the `error` event. **Does not** bound `ArrayBuffer`/typed-array backing stores: a 48 MB cap allowed a 4 GB allocation, because backing stores live outside V8's old generation. |
| Bun     | none                                    | The WHATWG `Worker` constructor has no `resourceLimits` equivalent.                                                                                                                                                                                                |
| Browser | none                                    | Same.                                                                                                                                                                                                                                                              |

So a hostile plugin can still OOM the process everywhere. Treat the Worker host
as **containment of authority and of runaway CPU**, not as a resource quota.
That is the honest boundary to put in `docs/acceptance/hosts.md`.

## Recommended shape for `@tanstack/compose-worker`

Four files, ~450 lines total in the spike:

| File                                                                  | Portable?                                           | Why                                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `protocol.ts` — message union, error (de)serialisation                | **fully**                                           | plain data                                                                              |
| `worker-entry.ts` — `lockdown()`, `Compartment`, endowments, RPC loop | **fully**, except ~8 lines picking the message port | Node has `parentPort`; Bun/browsers have worker-global `postMessage`/`addEventListener` |
| `host.ts` — request ids, timeouts, kill, teardown, stub dispatch      | **fully**                                           | no runtime API touched                                                                  |
| `worker-shim.ts` — spawn a worker, normalise its API                  | **per-runtime**                                     | see below                                                                               |

The shim absorbs four `Worker` API differences:

|               | WHATWG `Worker` (Bun, browsers)  | `node:worker_threads`            |
| ------------- | -------------------------------- | -------------------------------- |
| receive       | `onmessage = (ev) => ev.data`    | `.on('message', (data) => …)`    |
| errors        | `onerror` / `onmessageerror`     | `.on('error', (err) => …)`       |
| `terminate()` | synchronous, returns `undefined` | returns a `Promise`              |
| module type   | `{ type: 'module' }`             | implicit, follows `package.json` |

Node's promise-returning `terminate()` _is_ the quiescence guarantee for
requirement 4. The web version gives no signal at all — the HTML spec's
"terminate a worker" is immediate but unobservable — so the shim yields one
macrotask before claiming the worker is gone. If `@tanstack/compose-worker` ever
needs a stronger browser guarantee, it has to be built from an explicit
"goodbye" message with a timeout, not from `terminate()`.

The second per-runtime point is **how the worker URL is produced**. Node and Bun
take a `file:` URL. Bundlers only recognise the literal
`new Worker(new URL('./worker-entry.ts', import.meta.url), { type: 'module' })`
form, so the browser build must pass a _factory_, not a URL. Ship these as two
package exports (`./node`, `./browser`) rather than one branching module —
see the Vite gotcha under Risks.

Suggested endowment set, matching the glossary's `Host` term: `log`,
`context.get` / `context.peek`, `tools.register`, and an `exports` bag. Keep
`exports` **out** of any `harden()` call.

## What broke, and what surprised us

1. **`harden()` is a deep freeze.** Hardening the endowment bag froze `exports`
   with it, so `exports.greet = …` threw "object is not extensible" on the very
   first plugin. Harden each capability individually; leave the bag alone.
2. **`overrideTaming: 'severe'` broke our own host.** It skips the "override
   mistake" repair, making `Error.prototype.name`/`.stack` non-writable data
   properties — after which `err.name = 'Foo'` on a _fresh_ `Error` throws
   inside the worker. Our error plumbing died before any plugin ran. Stay on
   the default `'moderate'` (`ses/src/enablements.js`), or use
   `Object.defineProperty` everywhere.
3. **`ses` already puts things on every compartment global**, non-enumerably:
   `harden`, `lockdown`, `Compartment`, `eval`, `Function`. So a plugin can
   nest its own `Compartment`. That is not an escalation — a child can only be
   endowed with what the parent already holds, and we confirmed a plugin-made
   child still cannot see `fetch` — but it is a surface, and a nested
   compartment shares the same thread and CPU.
4. **The compartment global is not frozen.** A plugin can set its own globals
   (`globalThis.secret = …`). Harmless, and invisible to other plugins
   (scenario 5), but worth knowing.
5. **A plugin can return an unclonable value and hang the caller.** Indirect
   `eval` runs _sloppy_, so `(0, eval)('this')` yields the compartment global —
   an object full of our endowment functions. Returning it makes the worker's
   `postMessage` throw `DataCloneError` inside the message handler, the reply
   never goes out, and the host waits for the full timeout. The fix is to wrap
   every reply `postMessage` in try/catch and downgrade to an error result.
   Any real host needs this; it is a one-line hang otherwise.
6. **Teardown creates unhandled rejections.** `unload()` must reject in-flight
   calls, but several event-loop turns pass inside `terminate()` before the
   caller can `await` them — long enough for Node's unhandled-rejection detector
   to kill the process. Callers holding a call promise across an `await unload()`
   must attach the handler first. Worth documenting on the public API.
7. **`ses` under Bun works, loudly.** Every `lockdown()` prints
   `SES Removing unpermitted intrinsics` for JSC methods newer than `ses`'s
   permit list (`Map.prototype.getOrInsert`, `getOrInsertComputed`,
   `WeakMap.prototype.*`, `%WrapForValidIteratorPrototype%.@@toStringTag`).
   Harmless — they are removed, so plugins simply cannot use them — but it is
   one block of red per worker on stderr. Node 25 printed nothing.
8. **`Compartment` works inside a Worker unmodified** on all three runtimes.
   No shim, no flag, no special build. This was the main risk and it is a
   non-issue.
9. **Node ran the TypeScript worker entry directly.** `new Worker(fileURL)`
   pointing at a `.ts` file works under Node's native type stripping, so the
   spike needed no build step for Node or Bun.
10. **Almost no TypeScript friction.** `ses/types.d.ts` has a `declare global`
    block covering `harden`, `lockdown` and `Compartment`, and the side-effect
    `import 'ses'` pulls it in — the local `declare const` shims we wrote first
    were unnecessary. `tsc --strict` is clean with
    `"lib": ["ES2022", "DOM", "WebWorker"]`. The one real annoyance is that
    `Compartment.evaluate` returns `any`.
11. **Structured clone is the wire format, not JSON.** `Map`, `Set`, `Date` and
    typed arrays cross intact; functions and proxies do not. This is better than
    JSON and worth exposing in the plugin contract.

## Risks

- **Memory is not contained** (see the table above). A hostile or buggy plugin
  can OOM the whole process on every runtime. Node's `resourceLimits` helps for
  object churn only.
- **Worker count.** ~17.5 MB RSS per idle worker on Node means one worker per
  plugin instance does not scale to hundreds of plugins in one process. Bun is
  ~3× cheaper. A pooled or multi-plugin-per-worker mode trades isolation for
  density and should be a deliberate, separate decision.
- **Vite emits the raw plugin-host source as a static asset.** With both the
  `new URL(…'.ts')` branch (for Node) and the `new Worker(new URL(…))` branch
  (for browsers) in one module, the production build emitted
  `worker-entry-*.ts` — the untransformed TypeScript — alongside the real
  79 KB chunk. Split the entry points per export condition.
- **`ses`'s permit list lags engines.** Bun/JSC already ships methods `ses`
  strips. Every runtime upgrade is a new batch of removed intrinsics, i.e. a
  silent capability change for plugins.
- **`errorTaming: 'unsafe'`** (used here for readable stack traces) lets a
  plugin read host stack frames — file paths — off any error it catches.
  Production should use the default `'safe'` and log untamed errors host-side.
- **Bun tail latency** is spikier than Node's (p99 131 µs vs 20 µs) despite a
  better median. Not investigated.
- **The web `terminate()` gives no completion signal**, so browser teardown
  quiescence rests on a macrotask yield rather than a guarantee.

## Open questions

1. Does the same code hold on Firefox and Safari? Untested. Safari's JSC is the
   same engine family as Bun's, so the intrinsics warnings likely recur.
2. Should each plugin get a worker, or should trusted plugins share one? What
   is the isolation unit — plugin, plugin instance, or client?
3. How does a plugin _import_ anything? This spike evaluates one flat source
   string. `ses` has a module system (`Compartment.import`, module descriptors)
   that we did not touch; a real plugin will want dependencies.
4. Where does the timeout budget live — per call, per turn, or as a token-bucket
   CPU budget? A 300 ms per-call budget is wrong for a plugin doing real work.
5. Can a plugin be _paused_ rather than killed? `terminate()` is the only lever
   we have, and it loses all in-worker state.
6. How does this compose with the Cloudflare host (slice 6's other half) behind
   one host contract, given they have very different failure modes?

## References

- `ses` 1.15.0 source, vendored in `spikes/worker-host/node_modules/ses/`:
  `src/tame-function-constructors.js` (the `Function` taming quoted above),
  `src/transforms.js` (`rejectSomeDirectEvalExpressions`, `rejectImportExpressions`),
  `src/enablements.js` (what `overrideTaming: 'moderate'` repairs),
  `types.d.ts` (the `declare global` block and `CompartmentOptions`).
- SES README and lockdown options: <https://github.com/endojs/endo/tree/master/packages/ses>
- Node `worker_threads`, incl. `resourceLimits` and `terminate()` returning a
  promise: <https://nodejs.org/api/worker_threads.html>
- Bun `Worker`: <https://bun.com/docs/api/workers>
- HTML spec, "terminate a worker": <https://html.spec.whatwg.org/multipage/workers.html#terminate-a-worker>
- Structured clone algorithm: <https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm>
- Chromium timer coarsening: <https://developer.chrome.com/blog/cross-origin-isolated-hr-timers>
