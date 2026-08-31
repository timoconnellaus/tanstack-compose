# How `cloudflare/cloudflare-os` runs "gadgets" on Dynamic Workers

Research for `tanstack-compose`. The primary source is the repository itself:
`github.com/cloudflare/cloudflare-os` at commit `af56a9d` (2026-08-28), cloned and read on
**2026-08-31**. Every claim below is cited as `path:line` against that tree, or as a URL for
Cloudflare's own docs. This doc assumes [cloudflare-dynamic-workers.md](./cloudflare-dynamic-workers.md)
for the platform primitives (Worker Loader, `globalOutbound`, facets, tails); it does not repeat them.

Cloudflare OS is Apache-2.0 (`LICENSE:1`, stock text, no additional clauses).

## Executive summary

- A **gadget** is a personal app the agent writes: a Durable Object class exported as `Gadget` from
  `server.js`, plus a `client.js` that renders DOM in a sandboxed iframe. There is **no manifest**.
  Capabilities are not declared by the gadget at all — they are _granted_ to it by a separate tool
  call (`setGadgetBinding`) and appear as named entries in the isolate's `env`
  (`packages/workshop-backend/src/agent.ts:584`, `:586`, `:598`; `overseer.ts:2734`).
- **Everything the sandbox knows about is a stub.** `globalOutbound: null` on every load; `env`
  holds only `WorkerEntrypoint` loopback fetchers minted per (target, caller)
  (`overseer.ts:4022`, `:2719-2742`). This is capability-based in exactly the sense our A4 means.
- The **cache id is a monotonic counter, not a content hash**:
  `` `${this.ctx.id}.${codeVersion}.${gadgetId}` `` (`overseer.ts:3978`). Reverting a gadget to
  previous code yields a _new_ isolate, and any commit anywhere in the workspace invalidates every
  gadget's id. This is the one place I would not copy them.
- **No `limits`, no client-side timeout, anywhere.** No `cpuMs`, no `subRequests`, no wall-clock
  guard on a call into a gadget. Only the code-mode path has a timeout, and it is a 5s wait for
  _logs_, not for the code (`overseer.ts:7335-7341`).
- **No type checking, no transpile, no bundling, no syntax check** of gadget source, ever. The
  loader is handed raw `.js` strings (`overseer.ts:3999-4004`). The model is given `.d.ts` text in
  the prompt and finds out about mistakes by running the thing.
- The **error path is a documented hack**: exceptions from a gadget are meant to arrive via the tail
  worker, that does not work, so every method call is wrapped in a `Proxy` that catches and
  re-publishes the error as a console event (`overseer.ts:4107-4131`). Stacks are useless.
- **Restarting is abortive, not graceful.** Changing code, switching chat context, or renaming a
  binding calls `ctx.facets.abort(name, new Error("Gadget restarted due to code update."))`
  (`overseer.ts:4966-4976`, `:4067-4072`, `:2798-2805`). There is no drain and no cleanup hook.
- Their **agent loop has no verify step for gadgets**. Thirteen tools, none of which is "run this"
  (`agent.ts:2304-2860`). The agent tests a gadget by calling it through `executeCode`, which is a
  _second_ dynamic worker with a _different_ env.
- **A gadget's runtime errors do not reach the model automatically.** They go to the user's console
  pane, and the _user_ attaches them to their next message as a chip
  (`GadgetEditor.tsx:147`, `ChatInterface.tsx:3258-3332`). A human is in the feedback loop by
  construction.
- **Their own test suite deletes the loader binding** for all but two suites
  (`packages/integration-tests/src/harness.ts:103-105`). No test writes a gadget's `server.js` and
  calls a method on it.

---

## 1. What a gadget is

### Authored shape

Two files, both plain ES modules, both `.js`. The contract is stated only in the system prompt:

```
server.js defines the Gadget's server-side logic, in the form of a Cloudflare Durable Object
class. The class must be exported under the name `Gadget`. Unlike with normal Durable Objects on
Cloudflare, there is no need to export a separate fetch handler; the Gadgets platform
automatically takes care of routing requests to the Gadget.
```

`packages/workshop-backend/src/agent.ts:586`, with the canonical example at `:588-596`:

```js
import { DurableObject } from 'cloudflare:workers'

export class Gadget extends DurableObject {
  greet(name) {
    return `Hello, ${name}!`
  }
}
```

`client.js` is _not_ loaded into the isolate as a program; it is shipped to the browser (§4). It gets
one magic global:

```
The client context is initialized with a special global variable called `gadget`, which is an RPC
stub pointing at the gadget's Durable Object server. […] Note that there is no index.html.
Instead, client.js must build the entire UI using JavaScript code.
```

`agent.ts:598`, `:605`.

Optional exports, all discovered by name, none declared anywhere:

| Export                                 | Purpose                                          | Citation                           |
| -------------------------------------- | ------------------------------------------------ | ---------------------------------- |
| `Gadget` (a `DurableObject`)           | the gadget itself; instantiated as a facet class | `overseer.ts:4079`                 |
| `ExportHandler` (a `WorkerEntrypoint`) | custom HTML/PDF/CSV export formats               | `agent.ts:676`; `gadget-export.ts` |
| a named `WorkerEntrypoint`             | a gatekeeper "hook" callback target              | `overseer.ts:4242-4243`            |
| `[restore](params)` on `Gadget`        | rehydrates persistent callback stubs             | `agent.ts:720-757`                 |
| `README.md`                            | prose for future agents; not loaded              | `agent.ts:659`                     |

### How a gadget declares what it needs

**It does not.** There is no manifest, no `deps`, no import map. All metadata lives in the
workspace's registry, in a `GadgetRecord` the code never sees (`overseer.ts:323-361`): `id`,
`title`, `bindingName`, `commitId` (_"the gadget's 'ref': the store itself has no ref layer"_),
`bindings: Record<string, BindingRecord>`, and a `pending` marker for a gadget still provisional to
a chat. A gadget's `env` is assembled entirely from that record:

```ts
  getEnvForLoader(gadgetId: WorkpieceId, caller: GatekeeperCaller, forChatId?: number): object {
    let env: Record<string, any> = {}
    let gadget = this.getGadgetRecord(gadgetId);
    env.GADGET = this.makeBindingLoopback({type: "gadget", id: gadgetId}, caller);
    for (let [name, edge] of this.visibleBindings(gadget, forChatId)) {
      env[name] = this.makeBindingLoopback({type: "gatekeeper", id: edge.target}, caller);
    }
    return env;
  }
```

`overseer.ts:2734-2742`. The binding edges live on the gadget _record_ in the overseer's storage,
not in the code. The agent adds one with the `setGadgetBinding` tool, and even that is only a
proposal until the user accepts:

```
Wire a resource from your `env` into a Gadget's own `env`, so the Gadget's code can use it. […]
The addition is part of your proposed changes: like code edits, it takes permanent effect when the
user accepts your changes.
```

`agent.ts:848-852`. Which gatekeeper vendors exist at all is an operator/admin decision enforced at
a single chokepoint, `getGatekeeperClassFor()` in `user.ts` (`AGENTS.md:48`, `REVIEW.md:29-33`).

### Who creates gadgets, and how

Both the user and the agent, through the same path. The agent has a `createGadget` tool:

```
Create a new Gadget in this workspace. The new gadget immediately becomes available in your `env`
under the `bindingName` you choose […] By default the new gadget is empty. Pass `blueprintId` […]
to instead start the gadget from a blueprint's code
```

`agent.ts:792-798`. A **blueprint** is a shareable code snapshot — the "executable" to a gadget's
"process" (`README.md`, the OS-analogy table). The prompt pushes hard toward starting from one:

```
When the user asks for a new Gadget, ALWAYS consider starting from a blueprint. […] Note that
users rarely ask for "a Gadget" in those words. They ask for a thing: a doc, a deck, a tracker, a
tool that does X.
```

`agent.ts:574-576`. The user can also edit gadget code by hand in a CodeMirror editor; the agent is
told about it through a synthetic `observeUserChanges` tool call injected into the history
(`agent.ts:826-830`).

### Storage and versioning of source

Source lives in a **real git object store inside the workspace's Durable Object SQLite**:

```
// Each workspace's Overseer DO holds a real git object database -- SHA-1, zlib-deflated loose
// objects, byte-identical to what `git` itself would write -- stored in the `gitObjects`
// typed-storage collection.
//
// There is deliberately no ref layer: no branches, tags, or HEAD. Our "refs" are the gadget
// records, blueprint records, and chats' pinned commits
```

`packages/workshop-backend/src/git-store.ts:1-13`. `isomorphic-git` plumbing only
(`git-store.ts:17-21`); no GC, dangling objects are cheap because content-addressed
(`git-store.ts:30-36`). Each `GadgetRecord` points at a head `commitId`; a chat's _uncommitted_
edits live as a stream of CodeMirror `ChangeSet` rows over a Yjs doc, materialized on demand
(`overseer.ts:3986-3997`, `code-change.ts`).

So the platform _has_ a content hash for every version of every gadget. It just does not use it as
the loader id. See §2.

### TypeScript, npm, bundling

None of it. The loader is fed the file map verbatim, filtered to `.js`:

```ts
let modules: Record<string, string> = {}
for (let [file, content] of files) {
  if (file.endsWith('.js')) {
    modules[file] = content
  }
}
```

`overseer.ts:3999-4004`. No TypeScript, no JSX, no npm, no bundler on either half. (`client.js` is
swept into `modules` too even though `mainModule` is `server.js` — harmless, but it means the client
half of every gadget is parsed inside the server isolate.) The UI "bundle" is equally literal:

```ts
// TODO: Bundle the UI? For now we just return client.js.
```

`overseer.ts:4160`.

---

## 2. Loading: the exact Worker Loader usage

### The call

```ts
return this.env.LOADER.get(
  `${this.ctx.id}.${codeVersion}.${gadgetId}`,
  async () => {
    /* … read files from git or from the chat's proposed changes … */
    return {
      // TODO: compatibility date configuration
      compatibilityDate: '2026-02-01',
      compatibilityFlags: [
        // Make ctx.restore() available.
        'allow_irrevocable_stub_storage',
      ],
      mainModule: 'server.js',
      modules,
      env: this.getEnvForLoader(
        gadgetId,
        { from: 'gadget', chatId, gadgetId },
        chatId,
      ),
      globalOutbound: null,

      // TODO: Switch to streaming tails when the workerd log spam issue is fixed.
      tails: [this.ctx.exports.GadgetTailLoopback({ props: tailProps })],
    }
  },
)
```

`overseer.ts:3978-4027`. Field by field:

| Field                | Value                                                                                      | Note                                                   |
| -------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| id                   | `` `${doId}.${codeVersion}.${gadgetId}` `` (plus `.${chatId}.${sequence}` in chat preview) | `overseer.ts:3965-3978`                                |
| `compatibilityDate`  | hardcoded `"2026-02-01"`                                                                   | `:4013-4014`, with a `TODO` for making it configurable |
| `compatibilityFlags` | `["allow_irrevocable_stub_storage"]`                                                       | `:4015-4018`                                           |
| `mainModule`         | `"server.js"`                                                                              | `:4019`                                                |
| `modules`            | every `.js` file in the gadget's tree                                                      | `:3999-4004`                                           |
| `env`                | loopback `Fetcher`s only                                                                   | `:4021`                                                |
| `globalOutbound`     | `null`                                                                                     | `:4022`                                                |
| `tails`              | one loopback tail worker per gadget                                                        | `:4025`                                                |
| `limits`             | **absent**                                                                                 | —                                                      |
| `allowExperimental`  | **absent**                                                                                 | —                                                      |

They call `get()` (cached) for gadgets, and `load()` (uncached, fresh isolate every time) for the
agent's own code-mode execution (`overseer.ts:7286`) and for the one-off restore forger (`:8171`).

### How the id is chosen, and why it is wrong

`codeVersion` is a **workspace-global monotonic counter** bumped on every code commit, binding
change or blueprint install:

```ts
  bumpVersion(affectedGadgetIds?: WorkpieceId[]): number {
    let codeVersion = this.storage.codeVersion.get() + 1;
    this.storage.codeVersion.put(codeVersion);
    let ids = affectedGadgetIds ?? [...this.storage.gadgets.list()].map(gadget => gadget.id);
    for (let id of ids) {
      this.ctx.facets.abort(this.gadgetFacetName(id),
          new Error("Gadget restarted due to code update."));
    }
```

`overseer.ts:4966-4976`, called from nine sites (`:2135`, `:2223`, `:2238`, `:2260`, `:3688`,
`:3855`, `:4372`, `:10165`). Consequences:

1. Every gadget in the workspace gets a fresh loader id when _any_ gadget changes, even though only
   the affected facets are aborted. Cloudflare bills per unique `(id, code)` pair per day, so an
   active workspace multiplies its Dynamic-Worker count by the number of gadgets it holds.
2. The counter never goes down, so **reverting to previously-loaded code cannot hit the cache**.
3. Chat previews append `.${chatId}.${sequence}` (`overseer.ts:3975`), where `sequence` is the
   chat's next message number — so every agent edit that materializes creates a new isolate id.
   Correct (the id must change when the content does) but unbounded.

The content hash they already have — the git commit oid — would fix (1) and (2) outright. Their own
comment acknowledges the invalidation is deliberate but describes it as a side effect: _"Head
movement invalidates the cached load either way: every merge bumps the codeVersion counter in the
cache key"_ (`overseer.ts:3983-3985`).

### Callback purity

Cloudflare's docs require the `get()` callback to be a pure function of the id. Cloudflare OS takes
this seriously and documents it, snapshotting the chat metadata _synchronously_ before the callback
can run:

```ts
// Snapshotted in the same synchronous step as the cache key's sequence: the loader callback
// runs asynchronously, and buildChatDoc's as-of-`sequence` reconstruction needs the
// metadata as it stood then (a merge landing mid-load must not flip e.g. a legacy chat's
// base out from under the snapshot the key names).
```

`overseer.ts:3967-3970`. This is the right instinct and worth copying verbatim.

### The other two loads

The agent's `executeCode` sandbox is a _fresh_ isolate per execution, with a tighter flag set:

```ts
let workerDef: WorkerLoaderWorkerCode = {
  compatibilityDate: '2026-02-01',
  compatibilityFlags: [
    // disallow_importable_env also disallows importable ctx.exports, to prevent the code
    // from calling itself in a loop.
    'disallow_importable_env',
    // Make ctx.restore() available.
    'allow_irrevocable_stub_storage',
  ],
  mainModule: 'harness.js',
  modules: {
    'harness.js': CODE_MODE_HARNESS,
    'agent.js': code,
  },
  // The agent's env holds the chat's named bindings (see getEnvForAgent).
  env: this.getEnvForAgent(chatId, bindings),
  tails: [this.ctx.exports.CodeModeTailLoopback({ props: tailProps })],
  globalOutbound: null,
}
```

`overseer.ts:7265-7284`. Two things to note: `disallow_importable_env` is used for agent code but
**not** for gadget code, and the model's code is a _second_ module imported by a fixed harness
(`CODE_MODE_HARNESS`, `overseer.ts:69-106`) rather than the main module — so the harness controls the
calling convention and can graft capabilities onto `env` before handing control over.

---

## 3. The boundary

### Platform → gadget

Two directions in, both native Workers RPC, never `fetch`:

- **The gadget itself** is a Durable Object _facet_ instantiated from the dynamic worker's exported
  class:

  ```ts
  return this.ctx.facets.get<DurableObject>(facetName, () => {
    let stub = this.loadGadgetWorker(gadgetId, chatId)
    return {
      class: stub.getDurableObjectClass<any>('Gadget'),
      id: facetName,
    }
  })
  ```

  `overseer.ts:4075-4082`. Callers get an `RpcStub` and invoke methods by name; there is no
  registration and no interface declaration.

- **Named entrypoints** for the export handler (`getEntrypoint<GadgetExportEntrypoint>(…)`,
  `overseer.ts:4212-4213`) and for gatekeeper hooks (`stub.getEntrypoint(gk.hook)`, `:4243`).

`fetch()` is never used to enter a gadget.

### Gadget → platform

A gadget can only call what is in `env`, and everything in `env` is a `WorkerEntrypoint` loopback,
not a live stub. The comment explains why:

```ts
/**
 * Horrible hack: At present the `env` of a dynamic isolate can contain ServiceStubs but cannot
 * contain RpcStubs. But if we ask the gatekeeper to open a session, we get an RpcStub. So we
 * actually initialize each binding to be a `ServiceStub` pointing at a `GatekeeperLoopback` whose
 * props identify the overseer and target workpiece, so that on each method call it can resolve the
 * target session.
 */
export class GatekeeperLoopback extends WorkerEntrypoint<Cloudflare.Env, GatekeeperLoopbackProps> {
  constructor(ctx: ExecutionContext<GatekeeperLoopbackProps>, env: Cloudflare.Env) {
    super(ctx, env);
    let ns = ctx.exports.OverseerDurableObject;
    let stub: DurableObjectStub<OverseerDurableObject> =
        ns.get(ns.idFromString(ctx.props.overseerId));
    let session = stub.startGatekeeperSession(
        this.ctx.props.target, this.ctx.props.caller);
    return new Proxy(session, { /* forward everything */ });
  }
```

`overseer.ts:8756-8788`. The props carry `{overseerId, target, caller}` (`:8743-8749`) and the
gadget cannot read them — that is Cloudflare's `ctx.props` guarantee. `caller` is a tagged union
(`from: "agent" | "gadget" | "user" | "hook"`, `:8725-8741`) so every action a gadget takes is
attributed in the audit log without the gadget being able to lie about who it is.

This is **capability-based, not ambient**, and the repo enforces that as a review rule:

> A resource becomes "ambient" (auto-injected) only through user or admin configuration. A
> gatekeeper must never assert its own ambience.

`REVIEW.md:27-28`.

### What a gadget gets by default

Exactly one thing: `env.GADGET`, a self-stub, retained only for backward compatibility
(`overseer.ts:2737`; `plans/multi-gadget.md` calls it _"of questionable value going forward"_). No
network, no KV, no R2, no secrets, no other gadget. The prompt tells the model this plainly:

```
Both the client and server run inside a strictly isolated sandbox. They cannot make requests to
the Internet, e.g. by calling `fetch()`. Instead, a Gadget communicates with the outside world
strictly through its "bindings", that is, the Cloudflare Workers `env` API
```

`agent.ts:609`.

### The interesting subtlety: persistent stubs

A capability that must survive isolate death cannot be a live stub. Cloudflare OS solves this with
`ctx.restore(params)` + a `[restore](params)` method on the gadget class (`agent.ts:716-762`), and a
`RestoreForgerImpl` capability handed to `executeCode` as a _transient argument to `run()`_ so it
expires with the call:

```ts
// The capability handed to CODE_MODE_HARNESS's run() that lets executed code invoke
// `env.<name>[restore](params)`. Only executeCode receives this capability -- gadget workers
// never do -- and it's passed as a transient stub argument to run(), so it lives exactly as
// long as the execution. The binding name is resolved against the execution's own binding map
// on the overseer side, so the capability conveys no authority beyond the env it accompanies.
class RestoreForgerImpl extends NativeRpcTarget {
  // Real private fields: RPC exposes an RpcTarget's properties as well as its methods, so
  // TypeScript-only privacy would leak these to the executed code.
  #impl: OverseerImpl;
```

`overseer.ts:187-197`. Two lessons: scope a capability by the _lifetime of the call that needs it_,
and remember that an RPC target exposes properties, not just methods.

---

## 4. UI

A gadget serves no UI. The platform hands `client.js` to the browser and the browser sandboxes it.

- **Transport**: `getGadgetUiBundle()` returns `{jsCode}` — literally the file
  (`overseer.ts:4159-4164`) — over the same Cap'n Web WebSocket the rest of the app uses.
- **Rendering**: a `srcDoc` iframe with no `allow-same-origin`, so it runs at the opaque `null`
  origin (no cookies, no storage, no parent DOM):

  ```tsx
  sandbox = 'allow-scripts allow-popups allow-popups-to-escape-sandbox'
  ```

  `packages/workshop-frontend/src/GadgetUI.tsx:503`.

- **CSP** (inline `<meta>` in the generated document):

  ```
  default-src 'none'; frame-src 'none'; script-src data: 'unsafe-inline'; style-src data:
  'unsafe-inline'; img-src data:; media-src data:; object-src 'none'; base-uri 'none';
  form-action 'none'; connect-src 'none';
  ```

  `GadgetUI.tsx:110`. `connect-src 'none'` is the client-side counterpart of `globalOutbound: null`.

- **No per-gadget origin, no caching.** Because CSP forbids remote scripts, the code is delivered as
  a _doubly nested_ data URL — the outer module imports the whole capnweb bundle from an inner
  base64 `data:` URL (`GadgetUI.tsx:16-26`). Every reload re-ships the library.
- **Bridging**: the injected prologue opens a `MessageChannel`, posts one port to the parent, and
  runs Cap'n Web over it:

  ```js
  let gadget // RPC stub to the gadget's server-side Durable Object.
  {
    let { port1, port2 } = new MessageChannel()
    window.parent.postMessage('handshake', '*', [port2])
    gadget = newMessagePortRpcSession(port1)
  }
  ```

  `GadgetUI.tsx:28-33`. The parent accepts the handshake only from that exact frame _and_ origin
  `"null"` (`GadgetUI.tsx:335-338`), then bridges the port to `connectToGadget()` behind a
  forwarding `Proxy` so the server stub can be hot-swapped without reloading the iframe
  (`GadgetUI.tsx:351-370`).

So the full path is: iframe → MessagePort (Cap'n Web) → parent page → WebSocket (Cap'n Web) →
Overseer DO → facet. The gadget's client and server never share a transport, and neither can reach
the network directly.

**Trust of gadget-rendered UI.** They treat it as hostile: `window.open` is monkey-patched to throw
(`GadgetUI.tsx:51-60`), `rel=noopener` is forced onto `target=_blank` anchors (`:71-84`), console and
`error`/`unhandledrejection` are forwarded to the parent log pane (`:36-49`, `:86-101`), and Escape
is forwarded explicitly because a sandboxed frame swallows keydown (`:62-69`). The review rules
forbid installing automatic error capture in gadget code at all (`REVIEW.md:57-58`).

The one acknowledged hole:

```ts
// TODO: CSP and request interception do not cover WebRTC/STUN. The same gap exists for Gadgets
// running inside an iframe in the user's browser. We should close the gap in both places.
```

`packages/workshop-backend/src/browser-export.ts:37-39`.

---

## 5. Storage

A gadget persists through **its own Durable Object facet**, using the ordinary DO storage APIs:

```
The Gadget has access to private storage via the regular Durable Objects KV and SQLite storage
APIs.
```

`agent.ts:586`. The facet is named by the platform, not the gadget:

```ts
  // Facet name for the given gadget. The facet name is a storage key, so the default gadget
  // keeps the legacy name "gadget"; all others get `gadget${id}` (collision-free with
  // `gatekeeper${id}` thanks to the shared workpiece counter).
  gadgetFacetName(id: WorkpieceId): string {
    return this.defaultGadgetId === id ? "gadget" : `gadget${id}`;
  }
```

`overseer.ts:1994-1999`. **The namespace is owned entirely by the host.** The gadget never sees a
namespace, never chooses a key prefix, and cannot enumerate or reach any other facet — Cloudflare's
facet guarantee is that the dynamic code cannot read the supervisor's database. Deleting a gadget
deletes its storage (`ctx.facets.delete(facetName)`, `overseer.ts:2283`).

The gadget's _source_ is stored separately, in the overseer's own git object collection (§1), which
the gadget has no access to.

Note what this buys them: a gadget's data outlives its code. `facets.abort()` kills the isolate but
keeps the SQLite database, which is exactly why a code update is a restart rather than a migration.

---

## 6. Lifecycle & failure

### Timeouts and limits

There are none. No `limits: {cpuMs, subRequests}` on any `WorkerLoaderWorkerCode` in the repo, and no
wall-clock guard on the client side of a call into a gadget. The only timeout on any dynamic-worker
path waits for _logs_ after the code has already returned:

```ts
let timeout = scheduler.wait(5000).then(() => {
  return null
})
let trace = await Promise.race([tracePromise, timeout])

if (!trace) {
  // Trace must have been lost... give up waiting.
  throw new Error('Timed out waiting for logs from code execution.')
}
```

`overseer.ts:7335-7341`. They rely entirely on the platform's per-invocation CPU limit — which, per
our earlier research, is _not enforced by local `workerd`_.

### Errors

Code-mode gets a real startup check before anything is handed to it:

```ts
// First check the code actually starts up. Treat startup errors as total failures.
await entrypoint.verify()
```

`overseer.ts:7289` (`verify()` is an empty method on the harness, `:74` — merely calling it forces
the module graph to parse and evaluate). Gadgets get **no equivalent**: a syntax error in `server.js`
surfaces on the first method call.

Exceptions from a gadget are supposed to reach the tail worker. They do not, so there is a proxy
around every method:

```ts
        // HACK: We're going to assume all top-level properties are methods, and we are going to
        //   intercept exceptions thrown by these methods and deliver them to the console log
        //   subscriber. In theory we shouldn't have to do this, because these exceptions should
        //   be reported to the tail worker. However, for some reason, that isn't working --
        //   possibly a runtime bug which needs investigation.
        // TODO: Fix exception reporting it tail workers so we can remove this hack.
        return (...args: any[]) => {
          let result: Promise<any> = Reflect.apply(method, target, args);
          return result.catch((err: any) => {
            let msg = err;
            if (err instanceof Error) {
              // Sadly the caught errors are missing any useful stack at the moment. Perhaps if
              // we at least specify the method that was called it's somewhat useful to the agent.
              msg = `${err}\n    at ${prop}()`;
            }
```

`overseer.ts:4107-4131`. The stack is unusable (matching `workerd#6870`, no source maps for dynamic
workers), so they synthesize `at <methodName>()` as the only location information. Logs reach the UI
through a per-gadget tail loopback (`GadgetTailLoopback`, `overseer.ts:8921-8926`) fanned out to
subscribed clients (`deliverGadgetLogs`, `:7707-7714`).

### Teardown and update-in-place

Every state change is an **abort**, and the isolate id changes with it:

| Trigger                                         | Action                                                                                                    | Citation                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------- |
| code commit / binding change                    | `bumpVersion()` → new `codeVersion` → `facets.abort(name, Error("Gadget restarted due to code update."))` | `overseer.ts:4966-4976` |
| proposed changes edited                         | `facets.abort(…, "Gadget restarted because the proposed changes changed.")`                               | `:2798-2805`            |
| switching between mainline and a chat's preview | `facets.abort(…, "Gadget restarted to test proposed changes.")`                                           | `:4067-4072`            |
| gadget removed                                  | `storage.gadgets.delete(id)`, then `ctx.facets.delete(facetName)` (destroys storage)                      | `:2269-2284`            |

There is **no cleanup hook**: nothing calls into the gadget before it is killed, and nothing waits
for it to finish. `#runningChatIds` is an in-memory map, so after DO hibernation they abort
defensively rather than trust it — a good pattern, documented at `overseer.ts:4046-4063`.

Removal is not fully clean; the gadget's git commits are deliberately left dangling
(`overseer.ts:2265-2268`, which argues this is fine because the objects are content-addressed and
unreachable), and there are open `TODO`s for revoking user sessions on workspace deletion
(`overseer.ts:9294`).

### Concurrency

Nothing in the codebase caps fan-out. Cloudflare limits a DO to 10 distinct in-flight Dynamic
Workers per I/O context, and a workspace with 10+ gadgets driven from one request would hit it; the
repo does not sequence, batch, or even mention this.

---

## 7. Agent authoring loop

### The tools

Thirteen, and the list is the whole story (`agent.ts:2304-2860`):

`readFile`, `writeFile`, `editFile`, `webFetch`, `observeUserChanges`, `describeBinding`,
`setGadgetBinding`, `createGadget`, `listBlueprints`, `executeCode`, `listConnectableResources`,
`requestConnection`, `giveUp`.

There is **no `runGadget`, no `testGadget`, no `typecheck`, no `lint`, no `ls`, no `grep`.** The file
list is folded into the system prompt so the agent need not call a tool to get it, and is
deliberately **frozen as of session start** for prompt-cache stability (`agent.ts:2096`, `:2060-2065`).

`editFile` is exact-string replace behind two gates worth copying:

```js
          let readFiles = filesRead.get(resolved.workpieceId);
          if (readFiles === undefined || !readFiles.has(filename)) {
            throw new Error("You must read a file before you can edit it.");
          }
          …
              if (observed === undefined ||
                  (await changedPaths(observed, head)).has(filename)) {
                throw new Error("The file's committed content has changed since you read it. " +
                    "Re-read the file and try again.");
              }
```

`agent.ts:2417-2419`, `:2432-2434`. A read gate and a staleness gate against the commit the agent
actually observed. Every edit is a _proposal_ the user accepts or reverts (`agent.ts:852`), recorded as a
change row on the chat's code base.

One sequencing rule is directly relevant to us — code changes take effect at the **step barrier**,
so the agent cannot edit and then run in the same step:

```js
if (stepBuffer.changes.length > 0) {
  throw new Error(
    'This step already made code changes, which take effect when the ' +
      'step ends. End this response and call executeCode again in your next step.',
  )
}
```

`agent.ts:2752-2753`, guarded by a comment explaining the invariant: _"buffered edits are durable
only at the step's barrier, so code must not run against content the persisted history doesn't yet
hold — a crash would lose the edits the execution observed"_ (`agent.ts:2745-2748`).

### How the model finds out it was wrong

Three channels, all indirect:

1. **`executeCode`.** The model calls its gadget through the chat's own binding — a completely
   different isolate with a different `env` — and reads the console:

   ```
   Executes one-off JavaScript code, returning the output it logs to the console. […]
   * An entry for each Gadget in the workspace, under the name given in the system prompt's gadget
     list […]: an RPC stub pointing at the Gadget's server-side Durable Object. If the user asks
     you to interact with a Gadget directly, or asks if you can "see" it, use this stub (read the
     Gadget's server code to learn what RPC methods it exposes).
   ```

   `agent.ts:857-869`. The tool result is the concatenated tail log plus, if the run threw,
   `"\n\nUncaught exception: " + err.stack` (`overseer.ts:7320-7354`).

2. **Gadget console logs and thrown errors — via the human.** These are published to subscribed UI
   clients through the tail loopback (§6), buffered in the editor, and formatted as
   `[server error] …` / `[client error] …` lines (`GadgetEditor.tsx:147`). They are then offered to
   the user as an _attachable chip_ on their next chat message, with a "Discard captured logs"
   button (`GadgetEditor.tsx:845-1670`, `ChatInterface.tsx:3258-3332`). **Nothing carries a gadget's
   runtime exception into the model's context automatically.** The README's claim that the agent
   will "test it for you, and debug errors" cashes out as: the agent calls the gadget's own RPC
   methods from `executeCode` and reads the return values.
3. **The user.** Changes are proposals; a rejection is itself a signal — _"the revert message is
   also how the agent learns of the rejection on its next turn"_ (`overseer.ts:3902-3904`).

There is no screenshot tool and no browser for the agent; the only images it can see are ones the
user attaches (`chat-attachment-validation.ts:9-40`).

### What the model is given about APIs

For gadget authoring: prose plus two worked examples in the system prompt (§1). For _bindings_, a
dedicated tool that returns a real `.d.ts`:

````ts
    return `Binding: ${name}\n` +
        `Title: ${desc.title}\n` +
        `TypeScript type: ${desc.tsType}\n` +
        …
        `The binding comes with the following bundle of TypeScript type definitions:\n` +
        `\n` +
        "```\n" +
        `${types}\n` +
        "```\n";
````

`overseer.ts:5558-5577`, sourced from each gatekeeper's `getTypeScriptTypes()`
(`workshop-shared/src/gatekeeper.ts:498-512`). The tool description is unusually blunt about why
this exists:

```
IMPORTANT: The objects found in `env` most likely do NOT implement any API you are familiar with
from your training. DO NOT try to guess what API they implement, and DO NOT use executeCode to try
to enumerate them programmatically (this will not work, as they are RPC interfaces). Use the
describeBinding tool to learn what interface they provide before writing any code.
```

`agent.ts:844`. This is the single most transferable idea in the repo: **the stub is the API, and the
stub's `.d.ts` is what the model is given.** The types are produced by the capability provider, not
by the host, and they travel with the grant. The platform's own two built-in bindings ship the same
way — real `.d.ts` files imported as text modules and pasted into the tool result
(`agent-spawner-binding.d.ts`, `ai-model-binding.d.ts`, imported at `overseer.ts:11246` and
`ai-models.ts:17`), e.g.:

```ts
/** Simple binding to an AI language model. */
export interface LanguageModelBinding {
  /** Run the model with the given prompt, returning the text it generated. */
  run(options: { prompt: string; systemPrompt?: string }): Promise<string>
}
```

For a _gadget_ binding there is no generated type at all — `describeBinding` just points the model
back at the source: _"read that file to learn the API it offers"_ (`overseer.ts:5543-5549`).

### Code Mode

The agent itself is a Code Mode agent: instead of emitting tool calls per operation, it writes a
module and the host runs it in a dynamic worker. The harness normalizes the environment before
handing over:

```js
export default class extends WorkerEntrypoint {
  verify() {}
  async run(self, callbackResolvers, restoreForger) {
    let env = this.env;
    …
    await agent(self, env, this.ctx);
  }
}
```

`overseer.ts:69-106`. The agent's sandbox differs from a gadget's in three ways: `load()` not
`get()` (fresh isolate, no reuse), `disallow_importable_env` (so the code cannot re-enter itself via
`ctx.exports`), and a `self` capability that calls back into the chat thread
(`AgentSelfLoopback`, `overseer.ts:8830-8861`).

---

## 8. Local dev and testing

- **Binding config** is four lines and nothing else:

  ```jsonc
  "worker_loaders": [
    {
      "binding": "LOADER"
    }
  ],
  ```

  `packages/workshop-backend/wrangler.jsonc:80-84`. The root `wrangler.jsonc` (the dev router) has
  no loader.

- `pnpm run-local` runs the whole stack on `wrangler`/`workerd` with no account
  (`README.md`, Quick Start).
- **Three test layers**: in-isolate unit tests under `@cloudflare/vitest-pool-workers`
  (`vitest.config.ts:14-29`, miniflare `compatibilityDate: '2026-02-02'`, flags
  `['experimental','nodejs_compat']`); in-workerd integration booting the real `wrangler.jsonc`
  (`vitest.integration.config.ts:16-32`, `testTimeout: 60_000` for a ~6s cold start); and
  cross-worker integration through wrangler's `createTestHarness()`
  (`packages/integration-tests/src/harness.ts:143-151`, `testTimeout: 120_000`).
- **The loader is removed for most suites**:

  ```ts
  // Most integration tests need no Gadget execution. Keep the loader only for tests that exercise
  // executeCode or a generated Gadget server.
  if (!enableGadgetExecution) delete config.worker_loaders
  ```

  `packages/integration-tests/src/harness.ts:103-105`. Only two suites opt in
  (`workshop-agent.test.ts:65`, `workshop-agent-actions.test.ts:39`), and both exercise
  `executeCode`, not a gadget's `server.js`. **No test in the repository writes a gadget server and
  calls a method on it.** The one integration suite for `openGadget` errors is `describe.skip`ped
  for CI timeouts (`__integration__/open-gadget-rpc.test.ts:76-77`).

- **Frontend gadget-UI tests run under jsdom**, so the iframe never executes and the handshake is
  synthesized by hand (`GadgetUI.integration.test.tsx:144-151`). CSP and sandbox enforcement are
  asserted nowhere.
- A guard rail worth stealing: `scripts/assert-workerd.ts:11-17` throws unless
  `navigator.userAgent === "Cloudflare-Workers"`, so a pool that silently falls back to Node fails
  the suite rather than passing it. `REVIEW.md:84-85` forbids removing it to make a suite green.
- **Local vs production** differences they hit: the SSRF flag `global_fetch_strictly_public` is a
  no-op under `wrangler dev` (`wrangler.jsonc:20-23`); a missing entrypoint produces a different
  error message locally than in production, and they resort to assuming _any_ internal error means
  "no entrypoint" (`gadget-export.ts:118-123`); DO-reset rejections carry structured flags in
  production but not locally (`open-gadget-rpc.test.ts:141-146`).

---

## 9. Type safety of gadget code

**Cloudflare OS does no type checking, no type stripping, and no syntax validation of gadget source
at any point.** There is no TypeScript compiler anywhere in the gadget path — not in a Worker, not
in the browser, not at build time. Concretely:

- The only compiler in the repo is `scripts/build-gatekeeper-configurator.ts`, which transpiles
  _gatekeeper configurator UI_ modules at package-build time (`AGENTS.md:22`, `AGENTS.md:91`). It
  never touches gadget code.
- Gadget files go from the git store to `modules` untouched, filtered only by extension
  (`overseer.ts:3999-4004`). `.ts`/`.tsx` files would simply be dropped.
- The only validation on a code change is structural: canonical gadget keys, path rules, size caps,
  integer section lengths. The module is explicit that this is not a correctness check —
  _"Validation's resource-exhaustion goal is deliberately modest"_, and the caps exist _"first for
  correctness — composed changes get stored and travel in RPC messages"_, not to reject bad code
  (`packages/workshop-shared/src/code-change.ts:27-47`).
- The nearest thing to a check is code-mode's `await entrypoint.verify()` (`overseer.ts:7289`),
  which forces module evaluation and so catches a syntax or top-level error — but only for the
  agent's own one-off code, never for a gadget.

**What the model gets instead** is documentation, in three forms:

1. Prose plus two worked examples of the gadget shape in the system prompt (`agent.ts:582-676`).
2. A real `.d.ts` bundle per capability, on demand, via `describeBinding` — produced by the
   capability's own provider (`getTypeScriptTypes()`, `gatekeeper.ts:498-512`) and pasted into the
   tool result inside a fenced block (`overseer.ts:5558-5577`).
3. `webFetch`, for looking up anything else, with the standing warning that fetched content is
   untrusted (`agent.ts:812-824`).

**Cost**: zero bundle, zero latency, zero CPU — and a feedback loop that only closes when the code
runs. The model writes JavaScript against a TypeScript description of an API it cannot introspect
(`agent.ts:844`), and learns it got the shape wrong from an exception with a synthesized one-line
stack (`overseer.ts:4118-4120`). That is a deliberate trade — they optimized for "no build step, code
is data" — but it is the weakest link in the loop, and it is the gap our design should close.

---

## 10. Anything else notable

- **`REVIEW.md` is a reviewer's brief, not a security review.** It ranks review priority as _kernel
  bar → capability-security invariants → secret leakage → everything else_ (`REVIEW.md:7-8`) and
  names one chokepoint for minting capabilities (`getGatekeeperClassFor()`, `REVIEW.md:29-33`).
  Two rules are directly relevant to us: authentication config is deliberately env-var driven _"so a
  compromised admin session cannot change it"_ (`:35-38`), and **automatic error capture belongs
  only in trusted first-party surfaces, never in gadget or user-authored code** (`:57-58`) —
  because exception messages and stacks reach an external reporter.
- **The kernel discipline.** `packages/workshop-backend` and `workshop-shared/src/api.ts` are the
  kernel; maintainers read every line, every exported member needs a doc comment, and large changes
  must be split so the kernel can be reviewed apart from UI (`AGENTS.md:16`, `REVIEW.md:10-23`).
  Their equivalent of "keep core small" is enforced socially, in review.
- **Open `TODO`s that matter** (54 in `workshop-backend/src` + `docs/`; no `FIXME`, no `XXX`):
  hardcoded gadget `compatibilityDate` (`overseer.ts:4013`); tails not streaming due to workerd log
  spam (`:4024`); facet and dynamic-entrypoint stubs cannot be returned over RPC, worked around with
  `Proxy` + `NativeRpcStub` at four sites (`:4094`, `:4245`, `:8585`, `:8635`); exception reporting
  through tails broken (`:4112`); UI unbundled (`:4160`); `[restore]()` returns a throwing
  placeholder pending runtime support (`:122`); WebRTC/STUN escapes CSP (`browser-export.ts:37`).
- **Observers**: sharing a gadget requires each new viewer to supply their _own_ connected accounts,
  and each gatekeeper verifies that viewer could have read everything the gadget has historically
  read; otherwise access is denied and future observations are blocked (`docs/observers.md:1-20`).
  This is a read-through permission model on top of the capability model — beyond our scope, but a
  reminder that "the plugin got a stub" and "this user may see what the plugin saw" are different
  questions.
- **Two encodings coexist for gadget code.** Mainline is git commits (`git-store.ts`), but a
  blueprint's content — and the `.gadget` export container (magic `0xec2e2d3a2300e317`, JSON
  metadata + gzip'd snapshot, `blueprint-archive.ts:1-21`) — is still the older workspace-wide Yjs
  document, and `docs/blueprints.md` still describes it that way. `plans/multi-gadget.md` calls this
  out: _"using Yjs as the blueprint content format has become nonsensical — both creation and
  consumption make a whole-tree copy, losing any change history."_ A useful reminder that the
  storage format for "a plugin as source" and for "a shareable snapshot of that plugin" want to be
  the same thing, and drift apart if you let them.
- **`plans/multi-gadget.md`** is the design doc for going from one gadget per workspace to many, and
  is the single best source on why their facet naming, binding edges and loader keys look as they
  do. Notable admission: _"`executeCode`'s `ctx.restore()` targets the first gadget, for now […]
  documented as a known limitation."_

---

## Implications for tanstack-compose

Mapping onto [hosts.md](../acceptance/hosts.md) A1–A5, B1–B5, D1–D3 and
[self-modification.md](../acceptance/self-modification.md) D1–D6.

### Where they are the same idea

**A4 / D2 — authority as stubs.** Their `env` is exclusively `WorkerEntrypoint` loopbacks minted per
(target, caller) by the host (`overseer.ts:2719-2742`), and the review rules forbid a capability
from asserting its own ambience (`REVIEW.md:27-28`). That is A4 and self-modification B4, arrived at
independently and enforced in practice. Nothing in their design suggests A4 is wrong; it is the part
that has held up best under a year of real use.

**D1 / B1 — network off by default.** `globalOutbound: null` on every load, plus `connect-src 'none'`
on the client half. They never omit it. Our D1 says the same; keep it non-optional rather than a
default that can be forgotten — remember `workerd#5681`, where a typo'd `globalOutbound` fails
_open_.

**D3, agent side — attribution.** Their `GatekeeperCaller` tagged union rides in `ctx.props` where
the sandbox cannot read or forge it, so every action is attributed. We have no equivalent criterion.
If our middleware is to approve, log or refuse a hosted plugin's stub call the way self-modification
A4 wants for tools, the stub must carry which instance made it, unforgeably. **This is missing from
hosts.md** and should be added to §A.

**D1, on the ambient/granted split.** `disallow_importable_env` for agent code (`overseer.ts:7270`)
is worth copying for our host: it prevents loaded code from re-entering the host through
`ctx.exports`, which is a real escape from "only what you were handed".

### Where they differ, and what we should do instead

**D2 — content hash, not a counter. Keep our criterion; it is better than theirs.** Their id is
`${doId}.${codeVersion}.${gadgetId}` with a workspace-global monotonic `codeVersion`
(`overseer.ts:3978`, `:4966-4976`). This is exactly what D2 forbids: re-adding unchanged plugin
source _does_ create a new isolate, and one plugin's edit invalidates every other plugin's id. They
already have the commit oid (`git-store.ts:1-13`) and do not use it. **Recommendation**: key on
`${pluginId}:${sha256(source + optionsHash)}` as D2 says, and make the "unchanged plugin reuses the
isolate" case an explicit test, because it is the one their design silently loses. Their experience
also shows why: the billing dimension is unique (id, code) pairs per day, so a counter multiplies
cost by the number of hosted instances.

**B2 / D3 — they have no limits and no timeouts, and it hurts.** No `limits: {cpuMs, subRequests}`
anywhere; the only timeout is a 5s wait for logs after the fact (`overseer.ts:7335-7341`). Combined
with the local-`workerd` finding from our earlier research — a busy-loop child permanently wedges
`wrangler dev` — this is a live hazard, not a theoretical one. **Recommendation**: keep D3's
client-side wall-clock timeout as an unconditional wrapper around _every_ call into a hosted
instance, set `limits: {cpuMs, subRequests}` on every `WorkerLoaderWorkerCode` we build, and treat
B2 as testable in `compose-cloudflare` only under an in-process watchdog, not by trusting the
platform.

**B3 — teardown. Their model is abort-only; ours must not be.** Every restart is
`ctx.facets.abort(name, new Error(...))` (`overseer.ts:4966-4976`, `:2798-2805`, `:4067-4072`) with
no drain, no cleanup hook, and no wait for the code to stop. B3 requires the opposite: removal
reports done only once the host has released the instance, and nothing runs or calls a stub
afterwards. **Recommendation**: our Cloudflare host should revoke the stubs _first_ (so a
post-abort call cannot land), then abort, then resolve removal — and the acceptance test should
assert a stub call after removal fails rather than succeeding into a zombie isolate. Their
`#runningChatIds` defensive-abort-on-unknown-state pattern (`overseer.ts:4046-4063`) is worth
copying for the hibernation case.

**B4 / D4 — error surfacing. Do not rely on tails.** Their intended path (tail worker) does not
work, so they wrap every method in a `Proxy` to catch and republish, and synthesize
`at <methodName>()` because the real stack is useless (`overseer.ts:4107-4131`). D4 asks for "the
message and, where available, the line". **Recommendation**: catch at the proxy boundary, as they
do, and be explicit in the host's design notes that under `compose-cloudflare` the "line" half of D4
is not available (`workerd#6870`); use tails for _logs_, never as the error channel. Where we can do
better: our source is a single module we injected, so we can prepend a `//# sourceURL=` comment (as
they do for the client bundle, `GadgetUI.tsx:14`, `:25`) and get a named frame for free.

**D3 (self-modification) — rewriting source. Ours is stricter and should stay so.** Their restart is
an abort; storage survives, and nothing the previous code held is explicitly released. Our D3 says
"nothing the previous code registered or held survives the rewrite" — that is a stronger claim and
requires the client to run the instance's cleanups before starting the new code, not just kill the
isolate.

**C4 (self-modification) — their step barrier says our criterion is right and hard.** They forbid
running code in the same step that edited it, with an explicit error telling the model to end its
response and try again (`agent.ts:2752-2753`). Our C4 promises the opposite shape — _"a plugin the
agent adds mid-turn is fully usable in the next step"_ — which is the same barrier stated as a
guarantee rather than an error. Their reason is worth reading: _"buffered edits are durable only at
the step's barrier, so code must not run against content the persisted history doesn't yet hold"_
(`agent.ts:2745-2748`). That is a durability argument, not an ergonomics one, and it applies to us
the moment a self-edit is recorded in the session before it reconciles.
**Recommendation**: make the reconcile that follows a self-edit part of closing the step, so C4's
"next step" is genuinely the next model request, and decide explicitly what
edit-then-use-in-the-same-step does rather than leaving it undefined — they chose to refuse it.

**D4/D6 — copy their read gate and staleness gate.** Before `editFile` will run, the agent must have
read the file _in this session_, and the content must not have moved under it since
(`agent.ts:2417-2419`, `:2432-2434`). Our D6 says the agent can read the source of every entry it wrote; the
gates are the natural complement — a rewrite of an entry the agent has not read back should be
refused, and a rewrite based on a stale read should be refused with "re-read and try again". Neither
is currently in self-modification's criteria. Worth adding to D3/D6.

**The error channel is the biggest single difference, and we should not copy it.** Their gadget
exceptions reach a human, who may or may not attach them to the next message
(`GadgetEditor.tsx:147`, `ChatInterface.tsx:3258-3332`). Our D4 already requires the error to be
_in the tool result_, in the same turn, so the model can correct and rewrite. That is strictly
better and is the reason our loop can close without a person in it. **Recommendation**: hold D4's
"in the same turn" wording firmly, and make sure it covers not just setup-time throws but the first
call into a hosted plugin — because that is where a syntax error in a Dynamic Worker actually
surfaces (§6), and they have no equivalent path.

### The specific recommendation on type checking

**They do none (§9), and it is the clearest gap in their loop.** The model writes JavaScript against
a `.d.ts` it was shown in a prompt (`overseer.ts:5558-5577`), and discovers a mismatch as a runtime
exception with a one-line synthetic stack. Their own prompt has to plead with the model not to guess
(`agent.ts:844`) — a plea that exists precisely because nothing checks.

We intend to type-check agent-written plugin source against declarations derived from the stubs it
was granted, before starting it, and feed diagnostics back to the model. Cloudflare OS's experience
supports that, and sharpens it in four ways:

1. **Derive the declarations from the grant, not from the plugin.** Their best idea is that the
   `.d.ts` is produced by the capability provider and travels with the capability
   (`gatekeeper.ts:498-512`). Our stub set is decided by the operator per entry (A4), so the
   declaration file for a written plugin is a _function of its granted stubs_ — which means the
   type environment is itself a capability statement. A plugin that was not handed a stub cannot
   even name it. That is a stronger property than a runtime check, and it is free.
2. **Type-check in-process, in the client, before the host is asked to start anything.** Their
   architecture has no place to put a compiler (the loader takes strings, the sandbox has no
   filesystem), which is part of why they skipped it. We do not have that constraint: the check
   belongs in the self-modification plugin, next to where source is stored, so the same diagnostics
   are produced for the in-process host and for `compose-cloudflare`. This keeps ADR-0004's rule
   intact — the host contract does not change — but it does mean the checker is a dependency of the
   self-modification package, not of core.
3. **Diagnostics are a tool result, not a log.** Self-modification D4 already says a failed load
   leaves the entry in `error` with the message and line, carried in the tool result so the model
   can correct it in the same turn. Type errors should take exactly that path, with the same shape,
   so the model cannot tell the difference between "your syntax is wrong", "your types are wrong"
   and "your setup threw" — three failures, one recovery loop. **This is currently underspecified in
   D4**, which only names parse/load/setup failures; add type-check failure as a fourth.
4. **Budget for it, and make it optional at the operator's discretion.** Their zero-cost choice is
   defensible for a product optimizing for "no build step". A checker is bundle size and per-edit
   latency on the client. Prefer stripping types and checking against the generated `.d.ts` over a
   full program build, measure it in the same budget C2 sets for `compose-worker`, and let the
   operator turn it off — an entry whose source fails to type-check should be refusable, but which
   host and which checks apply is an operator decision (self-modification B4), never the model's.

### On our acceptance criteria: what their experience suggests is wrong or missing

- **B5 is the criterion they most conspicuously fail, and it is the right criterion.** They have no
  test that writes a gadget's server code and calls a method on it; the loader binding is _deleted_
  from the config for all but two suites (`harness.ts:103-105`). The result is that the failure
  modes above (tails not delivering exceptions, stubs not returnable over RPC, restore returning a
  throwing placeholder) all live as `TODO`s in production code rather than as red tests. Running the
  kernel suite against each host — B5 — is the thing that would have caught them. Hold the line on
  it, and make E1 real early.
- **Missing from hosts.md §A: caller identity.** See above. `ctx.props`-style unforgeable
  attribution on a stub call is what makes middleware-based approval possible across a host
  boundary. Suggest a new A6.
- **Missing from hosts.md §B: what the host does to the _host's_ observability.** `REVIEW.md:57-58`
  bans automatic error capture inside user-authored code because messages and stacks reach an
  external reporter. If we ever add error reporting, a hosted plugin's exception text is
  attacker-controlled and must not be shipped anywhere by default. Worth a line in the host design
  notes rather than a criterion.
- **A5 is validated by their pain.** Their `env` cannot carry `RpcStub`s, only service bindings, so
  every capability is a loopback entrypoint that re-resolves the real session per call
  (`overseer.ts:8756-8788`) — an entire class they call a "horrible hack". A5's rule (structured-clone-safe
  values, async in both directions, same source runs in every host) is what keeps us out of that,
  because it forbids us from designing an interface that only works when a live object can cross the
  boundary. Do not relax it for the in-process host's convenience.
- **The in-process host oracle should model abort, not just stop.** Every remote host will kill code
  mid-flight (that is what `facets.abort` is), so the in-process host — the oracle every other host
  is measured against (A1) — needs a way to express "this instance was terminated between two calls"
  or B5 will pass in-process and fail everywhere else.

---

## Sources

All read from the repository clone at commit `af56a9d` (2026-08-28), on 2026-08-31.

**Cloudflare OS (github.com/cloudflare/cloudflare-os)**

- `README.md` — product framing, the OS analogy table, the sandbox and capability claims
- `AGENTS.md` — package map, kernel bar, capability note, build/test system
- `REVIEW.md` — reviewer priorities, capability invariants, logging/secret rules
- `LICENSE` — Apache 2.0, unmodified
- `packages/workshop-backend/src/overseer.ts` — the kernel: `loadGadgetWorker` (3958-4028),
  `getGadgetFacetFetcher` (4030-4083), `getEnvForLoader` (2728-2742), `makeBindingLoopback`
  (2719-2726), `executeCodeMode` (7242-7360), `CODE_MODE_HARNESS` (69-106),
  `RESTORE_FORGER_WORKER` (157-171), `RestoreForgerImpl` (187-211), `GatekeeperLoopback`
  (8756-8795), `AgentSelfLoopback` (8830-8868), `GadgetTailLoopback` (8912-8926), `bumpVersion`
  (4962-4976), `removeGadget` (2269-2284), `gadgetFacetName` (1994-1999), `describeGatekeeper`
  (5558-5577), `getGadgetUiBundle` (4159-4164), the error-proxy hack (4107-4142)
- `packages/workshop-backend/src/agent.ts` — the system prompt (570-776) and every tool description
  (788-880), tool definitions (2304-2860)
- `packages/workshop-backend/src/git-store.ts` — the in-DO git object store (1-36)
- `packages/workshop-backend/src/gadget-export.ts` — export entrypoint, local-vs-prod error text
- `packages/workshop-backend/src/browser-export.ts` — headless-Chrome CSP, the WebRTC gap (37-43)
- `packages/workshop-shared/src/code-change.ts` — what change validation does and does not check
  (27-47)
- `packages/workshop-shared/src/gatekeeper.ts` — `getTypeScriptTypes()` contract (498-512)
- `packages/workshop-frontend/src/GadgetUI.tsx` — the iframe, CSP (110), sandbox attrs (503), the
  injected prologue and MessagePort bridge (10-101), handshake validation (335-338)
- `packages/workshop-frontend/src/GadgetEditor.tsx` (147, 845-1670) and `ChatInterface.tsx`
  (3258-3332) — how gadget console logs and errors reach the model: as a user-attached chip
- `packages/workshop-backend/src/agent-spawner-binding.d.ts`, `src/ai-model-binding.d.ts` — built-in
  binding declarations shipped to the model as text modules
- `packages/workshop-backend/src/blueprint-archive.ts` — the `.gadget` container format
- `packages/workshop-backend/wrangler.jsonc` — `worker_loaders` (80-84), compat flags (9-33)
- `packages/workshop-backend/vitest.config.ts`, `vitest.integration.config.ts`,
  `packages/integration-tests/src/harness.ts` (103-105, 143-151), `scripts/assert-workerd.ts`
- `packages/workshop-backend/__integration__/open-gadget-rpc.test.ts` — skipped suite (76-77)
- `docs/integration-testing.md`, `docs/observers.md`, `docs/blueprints.md`
- `plans/multi-gadget.md`, `plans/git-storage.md` — design rationale for facet naming, binding
  edges, loader keys

**Cloudflare docs and blog** (as cited in
[cloudflare-dynamic-workers.md](./cloudflare-dynamic-workers.md); not re-verified here)

- Dynamic Workers — https://developers.cloudflare.com/dynamic-workers/
- Durable Object Facets — https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/
- "Sandboxing AI agents, 100x faster" — https://blog.cloudflare.com/dynamic-workers/
- "Code Mode: the better way to use MCP" — https://blog.cloudflare.com/code-mode/
