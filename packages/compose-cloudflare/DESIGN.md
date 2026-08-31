# `@tanstack/compose-cloudflare` — design

A **host** that runs **plugin source** in a Cloudflare Dynamic Worker and
presents it to the client as an ordinary **plugin instance**. It meets
[`docs/acceptance/hosts.md`](../../docs/acceptance/hosts.md) §B, §D and §E,
under the contract core owns ([ADR-0004](../../docs/adr/0004-host-contract-in-core.md))
and the transport [ADR-0005](../../docs/adr/0005-stubs-cross-a-host-boundary-as-loopbacks.md)
fixed. The in-process host in core is the oracle; nothing here changes how a
plugin is written.

## The shape of the thing

```ts
const client = createClient({
  hosts: {
    cloudflare: createCloudflareHost({
      loader: env.LOADER,
      compatibilityDate: '2026-05-01',
    }),
  },
  plugins: [{ id: 'adder', source, host: 'cloudflare', stubs: [toolsStub] }],
})
```

Three moving parts, and no more:

| Part                      | Runs in            | Job                                                                 |
| ------------------------- | ------------------ | ------------------------------------------------------------------- |
| `createCloudflareHost`    | the loader Worker  | load an isolate per instance, call into it, hold it to a clock      |
| `ComposeStubLoopback`     | the loader Worker  | be a stub, called from inside an isolate                            |
| the generated **wrapper** | the Dynamic Worker | build `stubs` from `env`, run the written module, answer the client |

The client, the kernel, every stub handler and every middleware run in the
loader Worker (D5). The written module is the only thing in the isolate that
anyone wrote.

## Transport

`env.LOADER.get(id, () => code)` returns a `WorkerStub` synchronously;
`worker.getEntrypoint('ComposeHostedPlugin', { props, limits })` returns an RPC
handle to the wrapper. `setup`, `call` and `stop` are three RPC methods on it,
which is the whole of `HostInstance`.

**Every method answers with an envelope**, `{ ok, value }` or
`{ ok, phase, message }`, rather than throwing across the wire. RPC carries an
exception's message but not the properties hung on it, and the **phase** a
failure belongs to is exactly the part the client has to keep. The loopback
answers the same way for the same reason: a revoked or refused stub call becomes
an exception where the plugin's own `try` can catch it, and never an RPC-level
rejection that the runtime also reports on its own.

A rejection therefore means one thing: the isolate never got as far as running
the wrapper. That is the load failure, and it is read for a phase and a place.

## Stubs, and how a loopback finds the client

For each granted stub the host mints one loopback from the loader Worker's own
exports and puts it in the isolate's `env`:

```ts
env[stub] = exports.ComposeStubLoopback({
  props: { hostId, instanceId, stub },
})
```

`env` holds these and nothing else (D4): no bindings, no loader, no raw
resources. The props are read by the loader Worker, never by the isolate, so
the plugin can neither read nor forge the identity its calls arrive under. A
plugin that passes `{ instanceId: 'someone-else' }` as stub _input_ is answered
under its real id, and the middleware on `stubCallAction` sees the real id
first.

**The loopback finds the client through a module-level table** keyed by
`hostId` then `instanceId` (`src/registry.ts`). `createCloudflareHost` writes an
entry when it starts an instance and deletes it when it stops one; the loopback
reads `ctx.props` and looks the pair up.

Why this, and not something larger:

- The loopback runs in the loader Worker's isolate — the same isolate the client
  and the kernel run in, because the host was constructed there. Module state is
  the shortest path between two things already in one isolate, and it needs no
  serialization, no extra binding and no round trip.
- It is a table, not a global client: two clients in one Worker (a client per
  request is the ordinary shape) each register their own instances, under their
  own `hostId` if they want, and a lookup can only ever return the callables the
  kernel bound for that one instance.
- Revocation is a delete, which is what makes B3 mean something.

The known consequence is that **a loopback call reaches the client in a
different I/O context from the request that created it.** Plain JavaScript is
fine across that line; a stub handler that touches a platform object captured
from another request's context is not. Everything the kernel and the agent layer
do in a handler is plain JavaScript. An application whose handlers do I/O of
their own wants the client in a Durable Object instead, with the DO holding the
registry — the same table, one I/O context, and no change to anything else here.
That is the shape to reach for in a real deployment; it is not needed to satisfy
any criterion in this slice, so it is not built.

## The wrapper module

Generated per instance from the granted stub names, loaded as the isolate's
`mainModule` beside the written module as `plugin.js`. It is the only code in
the isolate the plugin author did not write, and it does three things.

```js
const stubs = Object.create(null)
for (const name of stubNames) {
  const loopback = env[name]
  stubs[name] = async (input) => {
    const answer = await loopback.stubCall(input)
    if (!answer.ok) throw new Error(answer.message)
    return answer.value
  }
}
```

The written module is imported **dynamically**, inside a `try`. A static import
would make a throw in the plugin's top level a failure to load the whole
isolate, before anything could name which phase it belonged to; dynamically, the
wrapper catches it and reports `load` (or `parse`, if the runtime called it a
`SyntaxError`).

What crosses into the written module is `{ id, options, stubs }` and nothing
else (D6). `env`, `ctx`, the loopbacks and the wrapper's own state are closed
over in the wrapper's module scope, which is not the plugin's module scope.

**What D6 cannot mean here.** A module in the isolate may `import
'cloudflare:workers'` and read `env`, and may import the wrapper module itself.
Neither is an escape: `env` holds only that instance's own loopbacks, and the
wrapper class holds no authority it did not take from that same `env`. The
honest statement is the one the criterion makes — the wrapper exposes no
reference to `env`, `ctx` or the loader — and the tests assert what is actually
reachable rather than a stronger claim.

**Wrapper state is keyed per start, not per isolate.** An isolate is cached by
content (below), so the same isolate serves a restart of the same instance. A
`run` token minted per `host.start` and carried in `props` is what makes the
restart run setup again and register its cleanups again, exactly as a cold
isolate would. Without it, a restart lands on a warm isolate that has already
run setup and quietly registers nothing — which is what the kernel's parity
suite caught.

The platform does not guarantee that two calls reach the same isolate. If an
evicted isolate is re-created, its `runs` table is empty and the next `call`
runs setup again before answering; that is the only way the instance keeps
working, and it means a plugin's setup can run more than once over an
instance's life.

## Isolate identity

```
`${instanceId}:${sha256(code + options + sorted grant names)}`
```

Everything that decides what the isolate would do is in the hash; the instance
id is in the key so two instances of the same source never share one. Re-adding
an unchanged plugin lands on the same id and the load callback does not run
again; changing the source, the options or the grants produces a new id and a
new isolate (D2). A content hash, not a counter: a counter would make a
re-added plugin pay for a cold isolate and would make the cache key depend on
history rather than on content.

## Limits and timeouts

`globalOutbound: null` on every load, not configurable (D1). The default is
_open_ — an omitted field means the isolate inherits the loader's egress — so
this is the one option the host refuses to take from its caller.

`limits: { cpuMs: 200, subRequests: 50 }` by default, set on the load **and** on
the entrypoint, overridable through `limits` (D3). A stub call is a subrequest,
so the subrequest budget is what bounds how much a plugin can ask of the client
in one invocation.

`callTimeoutMs` defaults to 5000 and wraps every `setup`, `call` and `stop` in a
client-side wall clock, independent of anything the platform enforces. A `setup`
that runs out of clock fails the start, so the instance ends in `error` naming
the limit and the rest of the client keeps working (B2). A `call` that runs out
rejects; the kernel promotes only the _first_ call to the instance's status, so
a plugin that has already answered once stays `active`.

The timeout error carries no `SourceError`: the limit is the host's, not a fault
in the written source, and `sourceErrorOf` says so by returning nothing.

There is no abort. The contract has no `abort` verb and the platform has no way
to tear down an isolate on demand; a timed-out call is abandoned, the instance
is revoked and stopped, and the runtime lets the isolate go when nothing is
holding it.

**B2 is proved with code that hangs, not code that spins.** A plugin whose
`setup` never returns is what the wall clock is for, and the suite uses one that
waits on a long timer. A busy loop is deliberately not tested: the local runtime
does not enforce `cpuMs`, and a `while (true)` inside a Dynamic Worker wedges it
permanently — not the call, the whole runtime, for the rest of the run. The
criterion is about the client-side limit, which a polite hang exercises exactly;
the platform limit is set on every load and is the platform's to enforce.

## Teardown

`stop()` revokes first, then stops:

1. **revoke** — delete the registry entry. Every loopback for that instance
   answers `{ ok: false }` from then on, including one already held inside the
   isolate, and a stub call after revocation fails rather than lands.
2. **stop** — the wrapper drops the run and awaits the cleanup the module's
   setup returned.

This is the order core's in-process host uses, and it is the order an aborted
isolate would impose anyway: a remote host that kills an isolate never gets to
run the module's cleanup either. So a written plugin's cleanup releases what
the module itself holds and nothing outside it; anything it registered through a
stub is released by the kernel cleanup the handler registered.

`stop` is itself under the wall clock, and a `stop` that fails or times out is
swallowed: the removal that asked for it must not be held up by an isolate that
is being let go regardless.

## Error mapping

| Failure                     | `phase` | Caught by                      | Place? |
| --------------------------- | ------- | ------------------------------ | ------ |
| source does not parse       | `parse` | the load rejecting `setup`     | yes    |
| module throws on evaluation | `load`  | the wrapper's dynamic `import` | no     |
| no default export           | `load`  | the wrapper                    | no     |
| setup throws                | `setup` | the wrapper                    | no     |
| first call throws           | `call`  | the wrapper                    | no     |

Each reaches the client as an `Error` carrying the `SourceError` detail
`sourceErrorOf` reads, with the original message.

**`line` is absent rather than wrong.** A child isolate reports an exception's
message; the stack that comes back belongs to the loader's bundle, not to the
written module, so there is no line of the source to point at and none is
invented. The exception is a module that does not parse: the runtime names it
(`at plugin.js:1:27`), that place is real, and the host reads `line` and
`column` out of it.

Tail Workers are not the error channel. They are asynchronous, they are not
available under `wrangler dev`, and an error the client has to attach to an
instance's status cannot wait for a log to arrive.

## What B5 covers, and what it cannot

`tests/parity.test.ts` runs core's `runInstanceContract` — the parameterised
suite in `packages/compose/tests/helpers/instance-contract.ts` — with this host
as a third arm, alongside the ordinary-plugin control arm. No new assertions:
the same probe, the same rules, one line of setup. The helper is imported across
the package boundary by path rather than copied or re-exported from core, so
there is one suite and no chance of the arms drifting; core is unchanged.

What it does not reach:

- **Anything about a plugin's identity as a value.** The kernel's criteria about
  replacing an entry's `plugin` reference do not apply to an entry that carries
  source; the source arm covers the equivalent (source, options and grants
  decide a restart) and core's own files cover the rest.
- **Synchronous observation.** Every arm is already asynchronous, but this one
  is asynchronous _and_ remote; a criterion phrased about what is true
  immediately after a synchronous call is not one this arm can be asked.
- **Type inference.** `tests/H-types.test-d.ts` is about what a builder infers,
  which is a client-side question a host has no part in.

## Credentials from bindings

A Worker has no process environment: its vars and its secrets arrive as
properties of the `env` object handed to `fetch`. `bindingCredentials(env)` is
the **credential source** for that — one function, `get(name)`, answering from
the bindings and from nothing else. A binding that is not a string is not a
credential and reads as `undefined`, so a Worker Loader or a KV namespace can
never be mistaken for one.

`env` is captured in the closure the source returns. Nothing enumerates it,
nothing publishes it, and the agent layer's credentials plugin puts only
`get(name)` and `has(name)` into context — so a secret bound to the Worker
reaches the plugin that named it and no store, session entry or tool result.

The `CredentialSource` interface is declared here rather than imported. It is one
method, the agent layer's plugin takes it structurally, and a **host** package
has no business depending on the agent layer to hand a Worker's own bindings to
whatever is running in it. `tests/credentials.test.ts` reads a var declared in
`wrangler.jsonc`, which is how a bound secret reaches a Worker in production too.

## Local and CI

One vitest project, `@cloudflare/vitest-pool-workers` over `wrangler.jsonc`,
which declares `worker_loaders` and points `main` at `dev/worker.ts` — the same
file `wrangler dev` runs, and the file whose `ComposeStubLoopback` re-export the
loopbacks are minted from. `additionalExports` tells the pool the re-export is a
`WorkerEntrypoint`.

**The compatibility date is 2026-05-01**, which is lower than the repo's
elsewhere. The workerd bundled with the wrangler in this workspace refuses
anything later than 2026-05-25 locally, and the date has to be one that both the
test pool and `wrangler dev` accept. Production supports later dates; raise it
when the bundled runtime does.

Coverage is not collected for this package: the pool runs the suite inside
workerd, where the coverage provider the rest of the workspace uses does not
instrument.
