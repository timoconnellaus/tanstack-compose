# Kernel acceptance criteria — `@tanstack/compose`

The kernel is done when every criterion below is proven by a test whose title
contains the criterion id (e.g. `A2`). Criteria are observable from outside the
package and say nothing about how they are met. Terms are as defined in
[CONTEXT.md](../../CONTEXT.md).

## A. Lifecycle and cleanup

- **A1** Adding a plugin to a running client starts it; removing it leaves no trace: provided context, listeners, middleware, timers, child instances, and any other held resource are all gone.
- **A2** Removal does not report complete until every cleanup, including asynchronous ones, has finished. Removing twice is safe; concurrent removals await the same completion.
- **A3** Removing an instance removes every instance it started, recursively, before it reports done.
- **A4** Cleanups of one instance run in reverse order of registration.
- **A5** Registering anything on an instance that is being removed or already removed throws; it never leaks silently.
- **A6** A plugin that throws during start ends in `error` status with the original error attached; nothing it half-registered survives; sibling instances are unaffected.
- **A7** A cleanup that throws is reported and does not prevent the remaining cleanups from running.

## B. Deps and context

- **B1** An instance whose deps are not all provided stays `pending` and starts the instant the last one is provided, regardless of plugin-list order and of whether the provider was added before or after it.
- **B2** If a dep stops being provided, the dependent is fully cleaned up (per A) and returns to `pending`; when the dep is provided again it starts fresh.
- **B3** Only a value provided by an `active` instance satisfies a dep; a provider that is `pending`, in `error`, or being removed does not count.
- **B4** A plugin can read a context key it did not declare as a dep, receiving `undefined` when absent, and keeps running either way.
- **B5** Providing a key that is already provided in the same client throws for the second provider.
- **B6** Circular deps are detected and reported with the cycle named; the instances involved do not spin or hang.

## C. Replacement

- **C1** Removing a provider and adding a different one for the same key results in every dependent running against the new provider, without any dependent having been written to anticipate the swap.
- **C2** During a swap there is no window in which a dependent is `active` against a removed provider.

## D. Options

- **D1** Options are validated and defaulted by the plugin's validator before the instance starts; invalid options put the instance in `error` with a path-annotated message and it never starts.
- **D2** Updating options on an active instance restarts only that instance; other instances keep their identity and state.
- **D3** An options update is itself an action, so tooling can observe, veto, or replace the restart through middleware.

## E. Middleware and events

- **E1** A plugin can register middleware around an action defined by another plugin; middleware can rewrite the input, rewrite the result, or stop the action by not calling `next`, and the action's owner cannot distinguish which occurred.
- **E2** Middleware runs in registration order, with an explicit way to run first; removing the registering instance removes its middleware, and later dispatches of the action still complete.
- **E3** A listener can observe an event emitted by another plugin without that plugin knowing; a throwing listener is contained and reported and affects neither the emitter nor other listeners.
- **E4** An event's dispatch is either fire-and-forget or awaited until all listeners settle; which one is part of the event's definition and is reflected in its types.

## F. Plugin list

- **F1** A client is driven by a plugin list of `{ id, plugin, options, enabled }` entries held in a `@tanstack/store` store; changing the list reconciles by `id` and only entries that changed are started, stopped, or restarted.
- **F2** Setting `enabled: false` is equivalent to removal; setting it back restores the instance; dependents react per B.
- **F3** A reconcile that fails partway leaves the client in the previous consistent state and reports the failure; no half-applied list is observable.
- **F4** Reconciles are serialised; overlapping list edits apply in order and never interleave.
- **F5** A plugin can edit the plugin list it belongs to, including disabling itself, and the edit applies without deadlock.

## G. Inspection

- **G1** At any time the client can list every instance with `id`, plugin name, status, and — when `pending` — exactly which context keys are missing; when in `error`, the error.
- **G2** For any instance the client can return the tree of resources it currently holds, with labels, including resources registered by nested registrations.
- **G3** Status changes are observable through a store so devtools and adapters render live without polling.

## H. Types

- **H1** Reading context inside a plugin is typed from that plugin's declared deps; reading an undeclared key through the typed accessor is a type error.
- **H2** Event payloads, action input/result, and options are inferred from the values passed to the builders; no `declare module` and no global type augmentation is required anywhere.
- **H3** A plugin authored in one package and consumed in another keeps full types with value imports only.

## I. Runtime and packaging

- **I1** The core package has no framework dependencies and runs in Node, browsers, and workerd; CI runs the suite in Node and jsdom, plus a smoke test in workerd.
- **I2** Two copies of the package loaded at once (monorepo or bundler duplication) interoperate; identity checks do not rely on `instanceof`.
- **I3** Core stays within a size budget of 6 kB min+gzip and uses no `Proxy` on hot paths.
- **I4** Every public export has JSDoc, and `packages/compose/DESIGN.md` maps every criterion in this file to the test that proves it.

## J. End-to-end

- **J1** One test assembles a client with a `logger` provider, a `timer` provider, a `tools` registry, a middleware plugin that rewrites tool calls, and a self-editing plugin that: disables `timer`, observes dependents become `pending`, re-enables it, swaps `logger` for another implementation, and finally asserts via G1/G2 that the client holds exactly the expected instances with no leaked resources.

## Priority

If time forces a cut, A2, B2, C2, F3 and F5 are the criteria that, when wrong, let an application quietly break itself; they are never deferred.
