---
status: accepted
---

# A hosted plugin reaches the world only through named grants; storage and services are grants

A hosted plugin has no ambient reach: no network, no storage, no timers, no bindings. Everything it can do is a **grant** the operator (or the base's policy) gave its entry, and every grant call is a `stubCallAction` dispatch carrying the calling instance's id, so middleware sees, logs, limits or refuses it per instance. This ADR fixes what the first grants are and what they promise.

- **`storage`** — key–value of structured-clone-safe values, namespaced by the calling instance's entry id. It survives restarts, options changes and source rewrites of that entry, and is deleted when the entry is removed from the plugin list. Code is versioned; state is not.
- **`http`** — a request to a **service** the base named, never to a host. The base's policy maps a service name to an allowed origin and a credential name; the grant attaches the credential server-side. Plugin source never sees a token, and a request to anything not named fails.
- **`schedule`** — a recurring or one-shot timer that calls a named export of the plugin; cancelled when the entry is removed.
- **`ai`** — a model call through the host's own provider (Workers AI on Cloudflare), needing no credential.
- **`files`** — object storage prefixed by the entry id.

We rejected passing platform bindings into the plugin's environment (ambient authority and no attribution — [ADR-0005](0005-stubs-cross-a-host-boundary-as-loopbacks.md)), and a kernel-owned storage API rich enough for real-time collaboration (it would be a Durable Object at arm's length with worse semantics; a plugin with that need is a persistent instance mounted by a host, a later slice).

## Consequences

- Each grant is one `createStub` with `.d.ts` text and a client-side handler; on Cloudflare the handler wraps a binding behind a `WorkerEntrypoint` whose `props` carry the instance id, which is the platform's own documented pattern.
- The declarations a plugin is checked against are exactly the grants it holds, so a plugin cannot name a capability it was not given.
- `storage` is the reason a rewrite can replace code without losing what the plugin remembered; the composer's rewrite runs the previous code's cleanups but does not touch storage.
- On Cloudflare a server half is mounted as a Durable Object **facet** of the tenant's object (see `docs/research/cloudflare-os-gadgets.md`): `storage` and `schedule` are the facet's own storage and alarm, implemented in the host's wrapper module, so the written plugin's API is the same in every host. A rewrite remounts code over the same storage; removal deletes the facet. The host contract therefore distinguishes `stop` (release the code, keep the state) from `destroy` (remove both).
- Host diagnostics are not product messages. When a written handler rejects,
  the product surface receives that handler's own message. A host prefix such
  as `@tanstack/compose: call failed —` remains on `error.cause` for operators;
  grants that call back into source (`server`, action middleware, and the
  host-local `storage`/`schedule` path) and the tenant DO's `press()` preserve
  this split.
