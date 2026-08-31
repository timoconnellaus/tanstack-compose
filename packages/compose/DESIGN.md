# `@tanstack/compose` — kernel design

How the kernel meets [`docs/acceptance/kernel.md`](../../docs/acceptance/kernel.md).
Terms are from [`CONTEXT.md`](../../CONTEXT.md) and are used exactly as defined
there. Decisions already fixed: [ADR-0001](../../docs/adr/0001-types-by-inference-not-augmentation.md)
(types from builders), [ADR-0002](../../docs/adr/0002-state-in-tanstack-store.md)
(observable state is `@tanstack/store`), [ADR-0003](../../docs/adr/0003-middleware-for-interception.md)
(middleware intercepts, events observe).

## Public primitives

Seven builders and one client. Everything else is a method on the client or on
the instance handle a plugin's `setup` receives.

```ts
// Declarations — the type of every value travels with the value that names it.
createContextKey<TValue>(name: string): ContextKey<TValue>
createEvent<TPayload>(name: string): EventDefinition<TPayload, false>
createEvent<TPayload>(name: string, options: { awaited: true }): EventDefinition<TPayload, true>
createAction<TInput = void, TResult = void>(name: string): ActionDefinition<TInput, TResult>

createPlugin<TDeps, TProvides, TValidator>(definition: {
  name: string
  deps?: TDeps                 // context keys this plugin needs before it can start
  provides?: TProvides         // context keys it may provide
  validator?: TValidator       // Standard Schema; validates and defaults options
  setup: (instance: Instance<TDeps, TProvides>, options: Options) => void | Cleanup | Promise<void | Cleanup>
}): Plugin<...>

// The client.
createClient(options?: {
  plugins?: Array<PluginEntry>
  onError?: (report: ClientErrorReport) => void
}): Client
```

### `Client`

```ts
interface Client {
  // Stores (ADR-0002). All three are written inside one `batch()` per settle pass.
  readonly pluginList: Store<Array<PluginEntry>> // F1 — the source of truth
  readonly instances: Store<Array<InstanceSnapshot>> // G1, G3
  readonly context: Store<Array<ContextSnapshot>> // published context, for devtools
  readonly errors: Store<Array<ClientErrorReport>> // A7, E3, F3 reporting surface

  // Plugin-list edits. Each writes to `pluginList` and resolves when the client is quiescent.
  setPluginList(next: Array<PluginEntry>): Promise<void>
  addPlugin(entry: PluginEntry): Promise<void>
  removePlugin(id: string): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
  setOptions(id: string, options: unknown): Promise<void> // D2, D3 — dispatches `optionsUpdateAction`

  settled(): Promise<void> // resolves when no reconcile or settle pass is outstanding
  destroy(): Promise<void> // removes every instance, awaits every cleanup

  // Behaviour.
  dispatch<I, R>(action: ActionDefinition<I, R>, input: I): Promise<R>
  emit<P, A>(
    event: EventDefinition<P, A>,
    payload: P,
  ): A extends true ? Promise<void> : void
  on<P, A>(event: EventDefinition<P, A>, listener: Listener<P>): Cleanup // client-owned
  use<I, R>(
    action: ActionDefinition<I, R>,
    middleware: Middleware<I, R>,
    options?: { first?: boolean },
  ): Cleanup

  // Inspection.
  inspect(): Array<InstanceSnapshot> // G1
  resources(instanceId: string): ResourceNode | undefined // G2
  getContext<T>(key: ContextKey<T>): T | undefined
}
```

### `Instance` — the handle passed to `setup`

```ts
interface Instance<TDeps, TProvides> {
  readonly id: string
  readonly client: Client // F5 — a plugin can edit the list it belongs to
  readonly context: {
    get<K extends TDeps[number]>(key: K): ValueOf<K> // H1 — typed by deps, never undefined
    peek<T>(key: ContextKey<T>): T | undefined // B4 — any key, may be absent
  }
  provide<K extends TProvides[number]>(key: K, value: ValueOf<K>): void
  cleanup(fn: Cleanup, label?: string): void
  on<P, A>(event: EventDefinition<P, A>, listener: Listener<P>): Cleanup
  emit<P, A>(
    event: EventDefinition<P, A>,
    payload: P,
  ): A extends true ? Promise<void> : void
  defineAction<I, R>(
    action: ActionDefinition<I, R>,
    handler: (input: I) => R | Promise<R>,
  ): void
  use<I, R>(
    action: ActionDefinition<I, R>,
    middleware: Middleware<I, R>,
    options?: { first?: boolean },
  ): Cleanup
  dispatch<I, R>(action: ActionDefinition<I, R>, input: I): Promise<R>
  start<P>(plugin: P, options?): Promise<string> // start a child instance owned by this one (A3)
}
```

Two built-in actions are exported so tooling can wrap them (ADR-0003, D3):
`optionsUpdateAction` (`{ id, options }`) and `reconcileAction` (the next plugin list).

### Choices made where the criteria are silent

- **`provides` is declared.** A plugin may only `provide` a key listed in its
  `provides`. Without a declaration the client cannot know what a `pending`
  instance would provide, and B6 (name the cycle) is unimplementable.
- **Options need a validator.** With no `validator` a plugin's options are
  `undefined`; typed options come from the Standard Schema, not a type argument.
  This keeps D1 unconditional — every options value that exists was validated.
- **The instance handle is one object, not a class.** Plugin authors write plain
  functions; nothing in the public API is constructed with `new`.
- **Structural tags, never `instanceof` (I2).** Every declaration carries a
  `type: 'compose/context-key' | 'compose/event' | 'compose/action' | 'compose/plugin'`
  string. Identity is object identity of the imported declaration, so two copies
  of the package interoperate as long as the declaration itself is imported by
  value. There is no module-level registry and no interning.
- **Store writes are batched per pass, not per mutation.** Internal state is
  plain `Map`s; the stores are snapshots published once per settle pass inside
  `batch()`. This is what makes C2 true.
- **No `Proxy` anywhere** (I3, ADR-0001): context is read with `get`/`peek`.

## Instance lifecycle

Public `status` is exactly the glossary's four values. A fifth, internal `phase`
(`idle` | `setup` | `removing`) tracks work in progress without inventing a term.

```
                created
                   │  options validated (D1) — invalid ⇒ error, never starts
                   ▼
   ┌────────── pending ◀──────────────┐
   │  all deps published              │ a dep stopped being published (B2):
   │  ⇒ run setup (phase = setup)     │ full cleanup, then back to pending
   ▼                                  │
 setup threw (A6)                  active ──────────────────────────────┘
   │  ⇒ everything half-registered
   │    is cleaned up, provisions
   │    unclaimed, siblings untouched
   ▼
 error                              (any) ──▶ removed   entry gone / disabled (F2)
```

- `pending` while `setup` is running: an instance is only `active` once `setup`
  has resolved, which is what makes B3 true — provisions become visible to other
  instances at activation, not at the moment `provide` is called.
- `error` carries the original thrown value on the snapshot (`error`), plus the
  cycle for B6.
- A `removed` instance's record is dropped; re-enabling an entry (F2) builds a
  fresh instance with fresh options and fresh resources.

## Deps, pending and re-activation

- `published: Map<ContextKey, unknown>` holds only values provided by `active`
  instances. `claims: Map<ContextKey, InstanceRecord>` holds every key claimed by
  a `provide` call, published or not; a second claim throws (B5).
- **Settle pass** — a fixpoint loop, bounded by the instance count, run inside the
  serialised queue:
  1. Any `active` instance whose deps are no longer all published is deactivated
     (full cleanup per A, record kept, status back to `pending`).
  2. Any `pending` instance whose deps are all published runs `setup`; on success
     its provisions are published, which can unblock others on the next turn.
  3. Repeat until nothing changed, then publish the store snapshots.
     Starting is attempted in plugin-list order, deactivation before starting, so
     B1 holds regardless of list order or of which side was added first.
- **Cycles (B6).** After the fixpoint, instances still `pending` are checked
  against a graph over non-active instances: `A → B` when a key in `A.deps`
  appears in `B.provides`. A cycle puts every instance on it into `error` with a
  message naming the ring (`a → b → a`). The loop is bounded, so nothing spins.
  The error is sticky until the entry changes.

## Cleanup ordering and quiescence

- Every registration (`provide`, `cleanup`, `on`, `use`, `defineAction`, `start`)
  appends a **resource node** `{ label, cleanup?, instance? }` to the instance's
  list, in registration order.
- Removing or deactivating an instance walks that list in **reverse** (A4),
  awaiting each cleanup. A node holding a child instance removes that instance
  first, recursively and awaited (A3). A cleanup that throws is caught, pushed to
  `errors` and passed to `onError`, and the walk continues (A7).
- `record.removal` memoises the in-flight removal promise: a second `remove`
  returns the same promise, so removing twice is safe and concurrent removals
  await one completion (A2).
- Registering on an instance whose `phase` is `removing`, or whose status is
  `removed`, throws (A5).
- Quiescence: every list edit, reconcile and settle pass runs on a single
  promise queue with an outstanding-work counter. `settled()` loops until the
  counter is zero, so it also covers passes scheduled _by_ a plugin (F5).

## Middleware vs events

|          | Middleware (ADR-0003)                                                            | Events                                                                            |
| -------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Wraps    | a named **action** its owner declared with `defineAction`                        | nothing — observation only                                                        |
| Can      | rewrite input, rewrite result, stop the action by not calling `next` (E1)        | only read the payload (E3)                                                        |
| Order    | registration order, outermost first; `{ first: true }` inserts at the front (E2) | registration order                                                                |
| Failure  | propagates to the dispatcher                                                     | contained, reported to `errors`, other listeners still run (E3)                   |
| Removal  | its owner's removal drops it; later dispatches still complete (E2)               | same                                                                              |
| Dispatch | always `Promise<TResult>`                                                        | `void`, or `Promise<void>` when the event was built with `{ awaited: true }` (E4) |

The chain is rebuilt from the current registration list on each dispatch, so a
middleware removed between dispatches is simply not in the next chain. The
action's owner sees only the input it is finally handed, and never learns whether
a middleware rewrote it, rewrote the result, or stopped the call (E1).

## Plugin-list reconciliation

- The list is `Store<Array<PluginEntry>>`, entries `{ id, plugin, options?, enabled? }` (F1).
- Any write to the store — by an edit helper or directly — schedules a pass.
  Passes run one at a time on a promise queue, so edits made while a pass is
  running are applied by the next one and never interleave with it (F4). Edits
  made before a scheduled pass has started coalesce into it, so a burst of edits
  is applied once, in list order. The store is the intent; `appliedList` is what
  is running.
- Reconcile is itself a `dispatch(reconcileAction, nextList)` (ADR-0003), so it can
  be observed or wrapped. Its handler:
  1. validates the list (ids present, unique, plugin shaped like a plugin) — a
     failure here throws before anything is touched;
  2. removes instances whose entry disappeared, was disabled (F2), or whose
     plugin or options changed (compared with `shallow` from `@tanstack/store`);
  3. creates records for new or restarted entries, validating options (D1);
  4. runs the settle pass.
     On a throw the client restores `pluginList` to `appliedList`, reports the error
     and rejects the edit's promise; instances are untouched, so no half-applied
     list is ever observable (F3). A vetoed reconcile (middleware that never calls
     `next`) rolls back the same way.
- **Self-edit (F5).** `instance.client` is not the client object `createClient`
  returned: it is a view of it whose edit helpers resolve as soon as the edit is
  recorded, and whose `settled()` resolves immediately. A plugin is always inside
  a pass, so there is nothing for it to wait for, and awaiting one of its own
  edits can never deadlock. The edit schedules a follow-up pass like any other,
  and an outside caller's `settled()` still covers it. Everyone outside keeps
  full-settlement semantics. (A flag saying "a pass is running" would not do:
  passes are asynchronous, so an outside caller can be in the middle of one
  without being part of it.)
- `setOptions` dispatches `optionsUpdateAction`, whose handler writes the entry's
  options; the ensuing reconcile restarts exactly that entry (D2), and middleware
  on the action can observe, replace or veto the update (D3).

## Inspection model

- `instances` store: one `InstanceSnapshot` per record, in plugin-list order,
  each instance followed by the instances it started —
  `{ id, plugin, status, missing: Array<string>, error?, parent? }`. `missing`
  lists the names of the dep keys that are not currently published (G1).
- `resources(id)` returns the instance's resource node tree, labelled, with child
  instances expanded in place (G2).
- Both are published inside one `batch()` at the end of every pass, so a
  subscriber re-renders once per pass with a consistent view and never polls (G3).
- `errors` collects `{ scope, instanceId?, error }` for cleanup failures, listener
  failures and reconcile failures.

## Hosts and plugin source

How the kernel meets [`docs/acceptance/hosts.md` §A](../../docs/acceptance/hosts.md)
and the seam [`self-modification.md` §D](../../docs/acceptance/self-modification.md)
plugs into. Fixed by [ADR-0004](../../docs/adr/0004-host-contract-in-core.md): the
contract and the in-process host live here, every isolation library lives in its
own package, and core stays dependency-free.

A **host** is the environment a plugin's code executes in. A plugin entry that
carries **plugin source** — a string — instead of a `plugin` reference is started
through a host: the in-process one by default, or the one the entry names.

```ts
{ id: 'greeter', source: '…', host: 'worker', stubs: [toolsStub, logStub] }
```

### The contract

Three types, and nothing a host may assume beyond them.

```ts
interface Host {
  readonly name: string
  start: (request: HostStartRequest) => Promise<HostInstance>
}

interface HostStartRequest {
  instanceId: string // rides on every stub call this instance makes
  code: string // what the checker produced, or the source as written
  options: unknown // validated, and structured-clone-safe
  stubs: Record<string, (input: unknown) => Promise<unknown>>
}

interface HostInstance {
  call: (name: string, input: unknown) => Promise<unknown>
  stop: () => Promise<void>
}
```

`start` is the whole of "load this and hand it its authority". `call` is the
whole of "the client reaches into the plugin": one named export, one
structured-clone-safe argument, one structured-clone-safe result. `stop` is the
whole of teardown, and does not resolve until the host has released the
instance. Everything else a host might want to do — caching by content hash,
wall-clock limits, tails — is the host package's business and invisible here.

The contract deliberately does **not** carry a `restart`, an `abort` or a
`status`. Restarting is the kernel's job: it stops the instance and starts a new
one. A host that terminates code abruptly expresses that as a `stop` whose
`call`s afterwards reject, which is what the in-process host does too.

### The written plugin shape

Plugin source is an **ES module**. Its default export is the setup function; its
other named exports are the handlers the client can `call`.

```ts
export default async function setup({ id, options, stubs }) {
  await stubs.tools.register({ name: 'add', handler: 'add' })
  return () => {
    /* release anything this module itself holds */
  }
}

export async function add({ a, b }) {
  return a + b
}
```

Why this shape:

- **A module, not a function body.** Every remote host we intend to build loads
  ES modules (a Dynamic Worker takes `{ mainModule, modules }`; a Compartment
  takes a module source). A module is also what a model writes when asked for
  "a TypeScript file", and it is what a `.d.ts` describes.
- **Default export is setup**, so there is one obvious entry point and no name to
  remember. It receives one object, so adding to it later is not a breaking
  change, and returns a cleanup exactly the way `createPlugin`'s `setup` does —
  a written plugin and a written-in-TypeScript plugin have the same lifecycle.
- **Handlers are named exports, called by name.** A function cannot cross a host
  boundary (A5), so a written plugin cannot hand the client a callback. Naming
  the export is the smallest thing that works, it is how RPC into an isolate
  works anyway, and it keeps the registration payload plain data:
  `{ name: 'add', handler: 'add' }` is structured-clone-safe.
- **`stubs` is the only capability object.** There is no `client`, no `instance`,
  no `context` and no `require`. If a written plugin can do it, a stub was
  granted for it.

### Stubs and caller identity

A **stub grant** is created by whoever owns the capability, once, and handed to
entries by the operator:

```ts
const toolsStub = createStub({
  name: 'tools',
  declarations: `declare const tools: { register(t: { name: string; handler: string }): Promise<void> }`,
  deps: [toolsKey],
  handler: async ({ input, instance, call }) => {
    const remove = instance.context.peek(toolsKey)!.add({
      name: input.name,
      run: (args) => call(input.handler, args),
    })
    instance.cleanup(remove, `tool(${input.name})`)
  },
})
```

- The **operator decides the grant set per entry** (A4). A written plugin's
  `stubs` object has exactly the granted names on it and nothing else; there is
  no registry to look one up in and no ambient object to reach through.
- A grant may declare `deps` and `provides`. The entry's synthesized plugin
  declares the union of its grants' — so a hosted entry sits in the dependency
  graph like any other instance, stays `pending` until its grants' deps are
  provided, and can `provide` through `instance.provide` inside a handler.
- **The handler is client-side, trusted code**, so it is given the real
  `Instance` handle. That is why registrations a stub makes are owned by the
  hosted instance and are undone by ordinary kernel cleanup (A2), with no new
  ownership concept.
- `call` calls back into the written plugin's named exports through its host, so
  a capability can be genuinely two-way without a function ever crossing.

**Caller identity (A6).** Every stub call is a dispatch of `stubCallAction`:

```ts
stubCallAction: ActionDefinition<
  { stub: string; instanceId: string; input: unknown },
  unknown
>
```

The callable the plugin holds is `(input) => dispatch(stubCallAction, { stub, instanceId, input })`
— a closure the client built per instance before the host ever saw it. The
plugin is handed the closure, not the id: there is no argument it can pass, no
property it can read and no field it can overwrite that changes the
`instanceId` the client sees. Because it is an action, client-side middleware
approves, logs or refuses per instance exactly as it does for any other action
(ADR-0003), and it sees the id before the handler does.

### Termination

`HostInstance.stop()` is the only teardown verb, and it is what a remote host's
"terminate the isolate" looks like from here. On removal the hosted entry's
instance runs two cleanups, in this order:

1. **revoke** — the client forgets the instance's host record. Every later
   `stubCallAction` dispatch for that id throws, wherever it came from,
   including from code already running inside the host.
2. **stop** — `host.stop()`; the in-process host marks itself stopped (so `call`
   and its own stub wrappers reject), runs the cleanup the module's setup
   returned, and drops the module namespace.

Revoke-before-stop is deliberate and is what makes the in-process host an
honest oracle: a remote host that aborts an isolate never gets to run the
module's cleanup either, so a written plugin's cleanup must not be able to do
anything observable outside itself. It releases what the module holds; anything
the module registered through a stub is released by the kernel cleanup the
handler registered.

Because `stop` is between two calls by construction — the kernel awaits it
during removal, and every call in or out is asynchronous — the in-process host
reproduces the remote "terminated between two calls" case exactly (A7): after
it, `call` rejects, stub calls reject, and every cleanup has run before removal
reports done.

### The evaluator, and workerd

Evaluating a string in-process needs an evaluator. The in-process host uses
`import()` of a `data:text/javascript` URL, reached through
`new Function('u', 'return import(u)')` so no bundler rewrites it. Node, Bun and
browsers have this; **workerd forbids runtime code generation**, so the
`new Function` throws there and the host reports it:

> `@tanstack/compose: the in-process host cannot evaluate plugin source in this runtime, which forbids code generation from strings; run source in a host package instead`

The entry lands in `error` with that message and the client keeps working. The
workerd smoke test asserts exactly that string rather than skipping — a runtime
where source cannot run must say so, not appear to work.

Every value crossing the in-process boundary is passed through
`structuredClone`: options in, stub input out and result in, `call` input and
result. This is not defensive copying for its own sake — it is what makes the
in-process host the oracle A5 demands. Source that smuggles a function or a
class instance through a stub fails in-process for the same reason it would fail
over a wire, instead of passing here and failing in a Dynamic Worker.

### Error mapping

Five failures, one shape. Each attaches a `SourceError` to the error the client
reports, readable with `sourceErrorOf(error)`:

| Failure                             | `phase` | Where it is caught                                                   | Line?           |
| ----------------------------------- | ------- | -------------------------------------------------------------------- | --------------- |
| checker rejected the source         | `check` | before the host is asked to start anything                           | from diagnostic |
| source does not parse               | `parse` | the dynamic `import` throws a `SyntaxError`                          | from the stack  |
| module throws while evaluating      | `load`  | the dynamic `import` throws anything else                            | from the stack  |
| default export throws               | `setup` | `host.start`                                                         | from the stack  |
| first `call` into the plugin throws | `call`  | the first `HostInstance.call`, before the instance has answered once | from the stack  |

`line` and `column` come from the first stack frame naming the data URL. All
five reach the entry through the kernel's existing machinery: the synthesized
plugin's `setup` throws, so the instance ends `error` with the error attached
(kernel A6), the `errors` store gets a `{ scope: 'setup' }` report, siblings are
untouched, and the client never crashes. Nothing new was added for hosted
plugins.

The `call` phase is the odd one, because a remote host can defer a load failure
to the first invocation. Only the **first** call promotes a rejection to the
instance's status; after the plugin has answered once, a throwing handler is an
ordinary rejected call and the instance stays `active`. Anything else would let
one bad tool argument remove a working plugin.

### The type-check seam

Type checking is not core's job (self-modification D9), but the place it plugs
in is. A context key holds it:

```ts
const sourceCheckerKey: ContextKey<SourceChecker>

interface SourceChecker {
  check: (request: {
    instanceId: string
    source: string
    declarations: string
    grants: ReadonlyArray<{ name: string; declarations: string }>
  }) => SourceCheckResult | Promise<SourceCheckResult>
}

interface SourceCheckResult {
  code?: string // what to start; absent means "do not start"
  diagnostics?: Array<SourceDiagnostic> // { message, line?, column? }
}
```

When the key is provided, every source entry is checked before its host is asked
to start anything, and the host is given `result.code` — so the same seam is a
transpiler: TypeScript in, JavaScript out. When it is absent, the source is
started as written. The checker runs client-side, once, so an entry gets the
same diagnostics whichever host it names.

**Declarations are derived from the grants, not from the plugin.** Each
`createStub` carries the `.d.ts` text for its own capability — written once by
whoever provides it — and an entry's declarations are the concatenation for its
grants, in grant order, via `stubDeclarations(entry.stubs)`. A written plugin
therefore cannot even _name_ a capability it was not granted, which makes the
type environment a statement of the entry's authority rather than a separate
thing to keep in sync. The same string is what a composer shows the model
(D8), so what type-checks is what runs.

`grants` carries the same text with each grant's `name` still attached, in the
same order. `declarations` alone is enough for a checker that only compiles the
text; a checker that has to give the plugin's `stubs` object a type has to know
which name each declaration belongs to, and recovering that by parsing the
concatenation would be guesswork. It carries the grant's `name` and
`declarations` only — never the grant itself, whose `handler` is client-side
authority a checker has no business holding.

Core ships no checker and no `typescript` dependency. The tests use a
ten-line reference checker to prove the seam.

### The hosted entry as an ordinary instance

A source entry is not a special kind of record. During reconciliation the client
synthesizes a plugin for it — name `hosted`, `deps`/`provides` from the grants,
a `setup` that resolves the host, runs the checker, binds the stubs and calls
`host.start` — and from there every kernel rule applies unchanged: options are
validated and restart the instance, deps hold it `pending`, `inspect()` lists
it, `resources()` shows what its stub handlers registered, removal runs its
cleanups in reverse (A2).

Two consequences worth stating:

- **`plugin` and `source` are both optional on `PluginEntry`, and exactly one
  must be present.** A discriminated union would say this in the type system,
  but it makes the common `{ ...entry, plugin: other }` edit ill-typed and turns
  `Array<PluginEntry>` into something callers must narrow. The check is a
  reconcile-time error alongside the existing "id is missing" and "duplicate id"
  ones, which already fail a reconcile without touching a running instance
  (kernel F3).
- **Restart comparison is by value, not identity.** A synthesized plugin is a
  fresh object every pass, so `entry.plugin !== record.plugin` cannot be the
  test. A hosted record restarts when its `source`, `host`, grant list or
  options change, and otherwise is left alone. Changing `host` is therefore an
  options-style change: the instance is stopped in the old host and started in
  the new one (A3).

### Reusing the kernel suite

hosts.md B5 asks for the kernel's criteria to hold for a hosted plugin, and A2
asks the same in core. Duplicating `tests/A-lifecycle.test.ts` against source
would double the maintenance and halve the meaning: two suites drift, and the
second one becomes the place a weakened assertion hides.

Instead, `tests/helpers/instance-contract.ts` holds one parameterised suite —
the parts of the kernel's criteria that are observable of any single instance
(A1–A5, A7 cleanup and removal; B1–B2 deps; D2 options; F1–F2 reconcile and
`enabled`; G1–G2 inspection) — expressed against a factory that, given a
behaviour, returns a plugin entry realising it. `tests/hosts/instance-parity.test.ts`
runs that suite twice: once with a factory that builds an ordinary plugin, and
once with a factory that builds a source entry on the in-process host. The
control arm is the point: it proves the shared contract still says something
about the kernel, so a hosted-plugin bug cannot be hidden by weakening the
contract. A host package adds a third arm with one line and no new assertions,
which is B5.

The criterion-by-criterion kernel files stay as they are. They are the record of
what the kernel promises, written per criterion; the parameterised contract is a
parity oracle, and the two have different jobs.

## Criterion → test

| Id  | Test file                           | `it()` title                                                                                                                                       |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `tests/A-lifecycle.test.ts`         | `adding a plugin starts it and removing it leaves no trace`                                                                                        |
| A2  | `tests/A-lifecycle.test.ts`         | `removal reports complete only once every async cleanup has finished`                                                                              |
| A3  | `tests/A-lifecycle.test.ts`         | `removing an instance removes every instance it started, recursively`                                                                              |
| A4  | `tests/A-lifecycle.test.ts`         | `cleanups of one instance run in reverse order of registration`                                                                                    |
| A5  | `tests/A-lifecycle.test.ts`         | `registering on an instance being removed or already removed throws`                                                                               |
| A6  | `tests/A-lifecycle.test.ts`         | `a plugin that throws during start ends in error with nothing left behind`                                                                         |
| A7  | `tests/A-lifecycle.test.ts`         | `a cleanup that throws is reported and the remaining cleanups still run`                                                                           |
| B1  | `tests/B-deps.test.ts`              | `an instance stays pending until the last dep is provided, whatever the order`                                                                     |
| B2  | `tests/B-deps.test.ts`              | `losing a dep cleans the dependent up and returns it to pending`                                                                                   |
| B3  | `tests/B-deps.test.ts`              | `only a value provided by an active instance satisfies a dep`                                                                                      |
| B4  | `tests/B-deps.test.ts`              | `a plugin can read a key it did not declare and keeps running either way`                                                                          |
| B5  | `tests/B-deps.test.ts`              | `providing a key that is already provided throws for the second provider`                                                                          |
| B6  | `tests/B-deps.test.ts`              | `circular deps are detected and reported with the cycle named`                                                                                     |
| C1  | `tests/C-replacement.test.ts`       | `every dependent runs against the new provider after a swap`                                                                                       |
| C2  | `tests/C-replacement.test.ts`       | `there is no window in which a dependent is active against a removed provider`                                                                     |
| D1  | `tests/D-options.test.ts`           | `options are validated and defaulted before the instance starts`                                                                                   |
| D2  | `tests/D-options.test.ts`           | `an options update restarts only that instance`                                                                                                    |
| D3  | `tests/D-options.test.ts`           | `an options update is an action tooling can observe, veto or replace`                                                                              |
| E1  | `tests/E-middleware-events.test.ts` | `middleware can rewrite the input, rewrite the result, or stop the action`                                                                         |
| E2  | `tests/E-middleware-events.test.ts` | `middleware runs in registration order, first goes to the front, and removal is clean`                                                             |
| E3  | `tests/E-middleware-events.test.ts` | `a listener observes an event and a throwing listener is contained`                                                                                |
| E4  | `tests/E-middleware-events.test.ts` | `dispatch is fire-and-forget or awaited according to the event definition`                                                                         |
| F1  | `tests/F-plugin-list.test.ts`       | `the plugin list is a store and reconciling only touches entries that changed`                                                                     |
| F2  | `tests/F-plugin-list.test.ts`       | `enabled false is equivalent to removal and enabling restores the instance`                                                                        |
| F3  | `tests/F-plugin-list.test.ts`       | `a reconcile that fails leaves the client in the previous consistent state`                                                                        |
| F4  | `tests/F-plugin-list.test.ts`       | `overlapping list edits are serialised and apply in order`                                                                                         |
| F5  | `tests/F-plugin-list.test.ts`       | `a plugin can edit the plugin list it belongs to, including disabling itself`                                                                      |
| G1  | `tests/G-inspection.test.ts`        | `every instance is listed with id, plugin, status, missing deps and error`                                                                         |
| G2  | `tests/G-inspection.test.ts`        | `the resource tree of an instance is labelled and includes nested registrations`                                                                   |
| G3  | `tests/G-inspection.test.ts`        | `status changes are observable through a store, with no polling`                                                                                   |
| H1  | `tests/H-types.test-d.ts`           | `reading context is typed from the declared deps`                                                                                                  |
| H2  | `tests/H-types.test-d.ts`           | `payloads, action input and result, and options are inferred from the builders`                                                                    |
| H3  | `tests/H-types.test-d.ts`           | `a plugin authored in another package keeps full types with value imports only`                                                                    |
| I1  | `tests/I-runtime.test.ts`           | `the core has no framework dependencies and no runtime-specific imports`                                                                           |
| I1  | `tests/workerd/smoke.test.ts`       | `the kernel assembles, provides and cleans up under workerd` / `reports a clear error for a source entry, because workerd forbids evaluating code` |
| I2  | `tests/I-runtime.test.ts`           | `two copies of the package loaded at once interoperate`                                                                                            |
| I3  | `tests/I-runtime.test.ts`           | `the core uses no Proxy on hot paths` / `the core stays within its 6 kB min+gzip size budget`                                                      |
| I4  | `tests/I-runtime.test.ts`           | `every public export has JSDoc and DESIGN.md maps every criterion`                                                                                 |
| J1  | `tests/J-end-to-end.test.ts`        | `assembles a client, swaps a provider, and edits its own plugin list`                                                                              |

### `docs/acceptance/hosts.md` §A

| Id  | Test file                             | `it()` title                                                                                                                                                                                                                    |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `tests/hosts/contract.test.ts`        | `starts an entry with no host in-process and one that names a host there`                                                                                                                                                       |
| A2  | `tests/hosts/instance-parity.test.ts` | every title under `plugin source in-process`, from `tests/helpers/instance-contract.ts`                                                                                                                                         |
| A3  | `tests/hosts/contract.test.ts`        | `restarts the instance in the new host when an entry changes host` / `leaves an entry naming a host the client does not have in error`                                                                                          |
| A4  | `tests/hosts/contract.test.ts`        | `hands a hosted plugin exactly the stubs its entry was granted` / `takes deps and provides for a hosted entry from the stubs it was granted`                                                                                    |
| A5  | `tests/hosts/contract.test.ts`        | `carries only structured-clone-safe values across the boundary, in both directions`                                                                                                                                             |
| A6  | `tests/hosts/contract.test.ts`        | `attaches the calling instance id to every stub call, where middleware sees it` / `cannot be told a different caller by the plugin it hosts`                                                                                    |
| A7  | `tests/hosts/termination.test.ts`     | `stops between two calls, so calls after it fail and the code is released` / `revokes the stubs of a removed instance before the client reports done` / `does not report removal done until the host has released the instance` |

### `docs/acceptance/self-modification.md` §D — the parts core owns

| Id  | Test file                             | `it()` title                                                                                                                                                                                                                                                   |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `tests/hosts/instance-parity.test.ts` | every title under `plugin source in-process`                                                                                                                                                                                                                   |
| D2  | `tests/hosts/contract.test.ts`        | `hands a hosted plugin exactly the stubs its entry was granted`                                                                                                                                                                                                |
| D4  | `tests/hosts/errors.test.ts`          | the four `leaves the entry in error …` titles, plus `reports every failure in one shape, so one recovery loop covers them all`                                                                                                                                 |
| D9  | `tests/hosts/errors.test.ts`          | `starts source as written when no checker is provided` / `starts what the checker returns, not what was written` / `does not ask the host to start source the checker rejected` / `checks against the declarations of exactly the stubs the entry was granted` |

The checker itself, and the tools that write and rewrite source, belong to the
self-modification slice; core ships the seam and, in the tests, a reference
checker that proves it.

### Notes on coverage

- **I1 runs in all three environments.** `pnpm --filter @tanstack/compose test:lib`
  runs the suite under Node (`vitest.config.ts`) and jsdom
  (`vitest.jsdom.config.ts`), then the workerd smoke test
  (`vitest.workerd.config.ts`, `@cloudflare/vitest-pool-workers` with its
  `cloudflareTest` plugin). No criterion is only partially met.
- **I3 — size** is a test in `tests/I-runtime.test.ts`: a rolldown bundle of
  `src/index.ts`, minified and gzipped, with `@tanstack/store` external. The
  kernel, with the host contract and the in-process host in it, is currently
  5.1 kB min+gzip against the unchanged 6 kB budget.
