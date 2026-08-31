# worker-host spike

Throwaway spike for roadmap slice 6: can one implementation of a plugin **host**
(Worker + Hardened JavaScript) serve Bun, Node ≥22 and browsers?

Findings: [`docs/research/worker-host-spike.md`](../../docs/research/worker-host-spike.md).

Not part of the pnpm workspace and not a package. It has its own `package.json`
and its own `node_modules` (`npm install` here, not `pnpm install` at the root).

## Run it

```sh
npm install

node scenarios/run-all.ts        # Node   — uses node:worker_threads
bun  scenarios/run-all.ts        # Bun    — uses the Worker global
npx vite dev                     # Browser — open http://localhost:5199/

node scenarios/memory-cap.ts     # can the runtime cap a worker's heap?
bun  scenarios/memory-cap.ts
node scenarios/probe.ts          # what is actually on a Compartment's globalThis?
npx tsc -p tsconfig.json         # typecheck
```

No build step: Node ≥22 and Bun both run the `.ts` worker entry directly, and
Vite transforms it for the browser.

## Layout

| Path                  | What                                                                        |
| --------------------- | --------------------------------------------------------------------------- |
| `src/protocol.ts`     | the message union; structured-clone-safe, no runtime API                    |
| `src/worker-entry.ts` | runs _inside_ the worker: `lockdown()`, `Compartment`, endowments, RPC loop |
| `src/host.ts`         | request ids, timeouts, `terminate()` on runaway, teardown                   |
| `src/worker-shim.ts`  | the only per-runtime host code: spawn a worker, normalise its API           |
| `scenarios/all.ts`    | the eight scenarios                                                         |
| `scenarios/bench.ts`  | startup, lockdown, latency, memory                                          |
| `browser/`            | the same scenarios, in a page                                               |
