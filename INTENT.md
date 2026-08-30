# Composable plugin runtime — design intent

**Purpose of this document.** Record *what* a Cordis-style composable-software framework is trying to achieve and *why*, so a TanStack-flavoured implementation can be built independently. This is a clean-room spec: it describes goals, invariants, and observable behaviours in our own words. It deliberately does **not** record Cordis's API names, type signatures, class layouts, file structure, or algorithms. Anyone implementing from this document should not need to have read Cordis, and should not go and read it.

Sources consulted for intent only: the DeepSeek Harness architecture/primer/tutorial prose and the public abstract of the "spatiotemporal composability" paper. No Cordis source code was read.

---

## 1. The problem being solved

Long-running applications built from plugins fail in two recurring ways:

1. **Time.** When a plugin is removed (config edit, hot reload, crash, dependency vanished), its side effects — listeners, timers, registrations, open handles — outlive it. The system can't be returned to the state it was in before that plugin loaded, so "reload just this piece" is unsafe and people restart the whole process instead.
2. **Space.** Plugins depend on each other, but that dependency is expressed by import order, boot scripts, or hope. Nothing reacts when a dependency appears late, disappears, or is swapped for another implementation.

The framework's thesis: make **every side effect reversible** and **every dependency declarative and reactive**, and mediate both through a single runtime object every plugin talks to. Then the properties that hold for one plugin (can be added, removed, replaced, reconfigured at runtime without disturbing others) hold for the whole application by construction.

The payoff the harness demonstrates: an entire agent product — model adapters, tool registry, session log, the agent loop itself, the web UI — is "just plugins", there is no privileged core to patch, and any piece is replaceable from configuration.

---

## 2. Core concepts (vocabulary we will use)

| Concept | Intent |
|---|---|
| **Runtime / context** | The one object a plugin receives. Everything a plugin does — reach a capability, listen, emit, register cleanup, mount children — goes through it. It's a *scoped view* onto a shared application graph, not a global. |
| **Plugin** | A unit of contribution. Given a runtime handle and validated config, it registers things. It has no bootstrap code of its own; composition happens outside it. |
| **Service** | A named capability published into the runtime under a stable key (e.g. "tools", "llm", "sessions"). Consumers name the key; they never import the provider. This is the swap point. |
| **Injection / requirements** | A plugin declares the service keys it needs. It does not run until all exist, and it is torn down (and re-run later) if any go away. Load order is derived from requirements, never from list position. |
| **Effect** | Any registration or acquired resource, paired with its undo. The runtime holds the undo and runs it when the owning plugin unloads. |
| **Instance handle (fiber)** | The runtime's record of one loaded plugin: its lifecycle state, its validated config, its collected undos, its children. Returned when a plugin is mounted so the mounter can await, dispose, restart or reconfigure it. |
| **Event** | Typed, named message on a flat bus with several dispatch modes. Events are the extension points; services are the direct-call points. |
| **Scope derivation** | Ways to create a child runtime view that sees a different world (extra metadata, an isolated instance of one service, overridden config for one service) without mutating the parent. |
| **Loader / composition tree** | A plugin that reads a declarative list of entries (which plugin, which config, enabled or not, stable id) and keeps the live plugin graph in sync with that list as it changes. |
| **Patch / overlay** | A layer that targets entries by id and replaces or inserts them, so a downstream party can adjust an upstream composition without forking it. |

---

## 3. Design goals and invariants

### 3.1 Everything is a plugin; there is no privileged core
- The kernel provides only: the runtime object, service registry, event bus, lifecycle/effects, and the ability to mount plugins. Everything else, including the loader, logger, timers, HMR, is itself a plugin mounted the same way.
- A user extends the application by mounting a plugin *beside* the others, never by editing the core.
- Corollary: the framework's own behaviours (loading, config reconciliation, HMR) should be observable and interceptable through the same event/service mechanisms user plugins use.

### 3.2 Reversibility: unload restores the prior state
- Every registration made through the runtime is an effect with an undo. Listeners, service provisions, child mounts, timers, registry entries — all of them.
- For resources the runtime doesn't natively manage (a socket, a watcher, a subprocess), the plugin wraps acquisition in an effect and returns an undo. That is the *only* escape hatch and it is still tracked.
- Unloading an instance runs its undos in reverse registration order, recursively disposes any children it mounted, and **does not resolve until everything — including async cleanup — has actually finished** ("reach quiescence, don't just request it").
- Async undos may run concurrently with each other; if teardown order between steps matters, the plugin keeps those steps inside a single undo.
- Creating a new effect on an instance that is already unloading/disposed is an error, so cleanup-time work can't escape the teardown snapshot.
- Disposing twice is a no-op; racing disposers await the same completion.
- Consequence: **hot reload is just unload-then-load.** No special HMR pathway inside plugins.

### 3.3 Reactivity: dependencies are live, not a boot-time check
- A plugin with unmet requirements sits in a *pending* state: not an error, it just hasn't started. It starts the moment the last required service appears.
- If a required service disappears while the plugin runs, the plugin is unloaded (undoing all its effects), and reloaded when the service returns. A consumer can therefore never hold a reference to a dead provider.
- Replacing a provider is therefore: unload old provider → dependents unload → mount new provider → dependents reload against it. Nothing else is needed for "swap the shell backend / model adapter / filesystem" to ripple correctly through the whole app.
- Optional dependencies are not declared; the plugin probes at the use site and handles absence.
- Requirements must be strict about *which* instance counts: only an implementation whose owning plugin is currently active satisfies a requirement.

### 3.4 Lifecycle is explicit and inspectable
- Each instance moves through a small, named state machine: declared/pending → loading → active → unloading → disposed, with a terminal failed branch from loading (config invalid or startup threw).
- State transitions are published as events so tooling can render "what is pending and why".
- Silent pending is the framework's most common footgun ("my plugin does nothing"). The design must make it easy to enumerate instances and see their state and unmet requirements; a diagnostic mode that reports pending instances after boot is expected.
- Startup failure is **loud**: a plugin that throws or whose config is invalid fails the instance and surfaces the error to whoever mounted it. (A module that can't even be *resolved* is a softer report, because the loader may legitimately see entries for packages not installed yet.)

### 3.5 Services: named, typed, flat, swappable
- One flat key namespace per application. Keys are strings; the type of each key is added by declaration merging (or an equivalent typed-augmentation mechanism) so `runtime.<key>` is fully typed at the consumer without any runtime coupling.
- Providing a service is an effect owned by the provider's instance; it becomes visible to dependents once the provider is active, and disappears when the provider unloads (waking dependents so they can unload).
- Only the provider may overwrite its own service value; providing a key already provided in the same scope is an error.
- A service can optionally be "callable" and can expose selected members directly on the runtime object as forwarding accessors (so the bus's `on/emit` live on the runtime itself). Those mixins are effects too.
- Services are how capabilities are *called*; events are how behaviour is *intercepted*. Rule of thumb from the harness: "prefer events for interception and policy; prefer service methods for direct capability calls."

### 3.6 Events: typed, flat, mode is part of the contract
- Event names are strings in a flat namespace, conventionally `domain/action`. Listener signatures are typed via the same augmentation mechanism as services.
- Registering a listener is an effect; it is removed when the owner unloads. No manual unsubscribe bookkeeping.
- Each event has exactly one dispatch mode and it is part of its public contract. The required modes:
  - **broadcast, fire-and-forget** — synchronous, return values ignored (observe).
  - **parallel** — all listeners run concurrently, awaited together (fan-out work).
  - **serial / first-answer-wins** — listeners run in order, awaited; first meaningful (non-null/false/undefined) return stops the chain (decisions). A synchronous variant of the same is useful.
  - **waterfall / around-middleware** — each listener gets the arguments plus a continuation; it may transform what the continuation returns, or decline to call it and short-circuit ("veto"). Values flow back through the continuation's return. This is the mode that powers interception (rewrite a request, wrap execution, apply policy).
- Listener ordering is registration order, with an opt-in "prepend" for listeners that must run first. Design guidance: cooperative listeners mutate a shared object and delegate; a listener that *owns* a decision may short-circuit; a listener that only annotates must delegate.
- A throwing listener must not break the dispatch loop or starve later listeners — contain and log.
- The bus supports a per-runtime-view **listener filter** consulted on every dispatch, so a scoped view can dispatch to "listeners registered in my scope plus untagged global ones". This is what allows per-tenant / per-agent scoped events on a shared bus. A listener may opt out of filtering ("global").
- The framework's own internals (instance created, state changed, service read/written, config updated, listener added, event dispatched) are themselves events, several of them waterfalls, so tooling can trace and intercept the framework.

### 3.7 Configuration: validated, defaulted, fail-loud, reloadable
- A plugin may export a schema alongside its config type. The runtime validates config against it *before* the plugin starts; the plugin always receives complete, defaulted, validated config.
- Invalid config → the instance is failed with an aggregated, path-annotated error, never partially started.
- The schema contract should be a standard, pluggable one (any validator that meets a common interface), not a bespoke schema library.
- Reconfiguring a live instance = validate the new config, then restart (unload + load) — routed through an interceptable hook so tooling (HMR, persistence) can veto or replace the restart and can be told "don't write this back".
- Config values may be *lazily computed expressions* evaluated after the plugin's own requirements are active (so config can reference other services). Only config — and the one "is this entry enabled" flag — is interpolated; all other entry metadata stays literal so it can be reasoned about statically.

### 3.8 Scoped runtime views (spatial composition)
Three derivations of a runtime view, all non-mutating to the parent:
- **Extend with metadata** — a child view that prototypally inherits everything and adds/shadows own properties. Used to tag a scope (e.g. "this is agent X's view").
- **Isolate one service key** — below the child view, reads and provisions of that key resolve in a fresh scope instead of the parent's, so two subtrees can each have their own differently-configured provider of the same key without affecting each other. Two isolations may deliberately share a label to join scopes.
- **Intercept one service's config** — plugins started below the child view see extra config merged into that service's resolved config, ancestor entries first. Lets a parent tune a service for its subtree without the subtree knowing.

The harness builds its whole "per-agent world" on this: an agent gets its own view, registers scoped tools/prompt sections/listeners through it (one act gives both scope-visibility and scope-lifetime), and a scoped registration *shadows* a same-named global one for that scope only. Scoping is intentionally two-level and flat (global vs. exactly one scope), with parent/child relationships carried as data rather than nested scopes, to keep resolution predictable.

### 3.9 Declarative composition (the loader)
- The application is a **list of entries**, each: a stable `id`, a module specifier (`name`), optional `config`, an `enabled/disabled` flag, and optional per-entry requirement/intercept overrides. Entries may nest in **groups** that load/unload as a unit (a disabled group disables its children; nested ids are path-like).
- Entries start concurrently; list position implies nothing. Ordering comes from requirements.
- The loader **reconciles**: when the list changes, it diffs by `id` and mounts/unmounts/reconfigures only what changed. Entries without a stable id are treated as removed-plus-added on every read — hence ids are strongly encouraged.
- Reconciliation is transactional: import the new module before disposing the old; if applying the candidate fails, restore the previous plugin/config; persist changes only after success; serialize mutations to the same tree (the group update is not reentrant).
- A file-backed variant reads YAML/JSON, writes back when the file is writable (e.g. persisting a toggled `disabled`), and supports **patches**: a patch targets an entry by id and replaces its whole config, or inserts a new entry. Later patches in the same list can see entries inserted by earlier ones.
- Layered composition (the harness's *profiles* and *bundles*): start from an empty list; apply each bundle's patch layer in order, then the profile's user patch, then a home-level patch, then any command-line overlay. Every row anything inserts stays patchable by the layers above it. A `--dump-config` style command prints the exact composed tree so users can see what they can override.
- The "process exits when nothing is left running" property: pending instances do not keep the process alive; a composition with nothing active exits cleanly.

### 3.10 Hot module replacement
- HMR is a plugin. It watches source files, traces the module graph to find which entries depend on a changed file, clears those module caches, and reloads *only* those entries via unload/load. A change to framework-level code falls back to a full process restart request.
- Config-file changes route through the same serialized reconciliation path as programmatic updates.
- HMR relies entirely on 3.2 and 3.3 being true; it adds no plugin-visible API.

### 3.11 Observability and diagnostics as first-class
- Each effect can carry a human label; an instance can return a tree of its live effects (nested effects registered while an effect ran appear as children). This is the "what is this plugin holding right now" view.
- Instances have a display name inherited from the nearest named ancestor, used in logs and diagnostics.
- A built-in logger service is part of the kernel so plugins can log before any exporter is mounted; exporters (console etc.) are plugins.
- Timers are provided as a disposal-aware service: timeouts/intervals/throttles/debounces are effects of the calling instance.

### 3.12 Identity across copies
- "Is this a runtime object?" must work across realms and across duplicate copies of the framework (keyed by a global symbol, not `instanceof`). Monorepos and bundlers routinely produce duplicate copies, and scoped/proxied views break `instanceof`.

---

## 4. What the harness needs from the framework (acceptance scenarios)

These are the behaviours the DeepSeek Harness leans on; a TanStack implementation should support each without special-casing.

1. **Capability seams.** A capability is three roles: a *definition* (owns the key and vocabulary types), one or more *providers*, one or more *consumers*. One provider swap changes the whole product (e.g. point filesystem + subprocess providers at a remote sandbox and every tool built on them moves with no forks). Requires 3.3 and 3.5.
2. **Registries as services.** Tool registry, prompt-section registry, model-adapter registry, command registry, job registry are services whose `register(...)` returns an undo attached to the *calling* instance, so unloading a tool plugin unregisters its tools. Requires 3.2 with "effects owned by the caller's instance, not the registry's".
3. **Interception without importing the loop.** Pre-request rewriting, tool pre/execute/post wrapping, turn-stop decisions, approval policy are all waterfall or serial events. A policy plugin can veto by not delegating. Requires 3.6.
4. **Per-agent scoped worlds.** Each live agent has its own runtime view; registrations through it are visible only to that agent and die with it; events about that agent dispatch with a scope carrier so scoped listeners see them and other agents' don't. Requires 3.8 and the listener filter in 3.6.
5. **Replace any row from config.** `--dump-config` shows the tree; a user patch replaces a row by id (e.g. swap the model adapter, disable telemetry). Requires 3.9.
6. **Two products from one plugin set.** A "web" profile and a "headless" profile are the same base bundle plus different top layers. Requires layered patches (3.9).
7. **Edit-and-save development.** Change a plugin file → only that plugin reloads, with all effects unwound. Requires 3.10.
8. **Tutorial-grade simplicity.** A first plugin is a function that takes the runtime; a first app is a two-line list. Services and events add a type augmentation block each. Nothing else is required.
9. **Testability.** Every registry gets an "unload the contributing instance, assert cleanup" test. Real compositions can be booted from a test config file through the real loader.

---

## 5. Non-goals / things to avoid copying

- Do not reproduce Cordis's API surface, method names, symbol keys, class hierarchy, error codes, or the specific plugin-module shapes (function/class/object with particular exported names). Design a TanStack-idiomatic surface (framework-agnostic core, typed builders, adapters for React/Solid/etc., devtools integration) that satisfies the intents above.
- Do not vendor or depend on Cordis, its loader, HMR, schema, or utility packages.
- Do not copy the harness's domain (agents, tools, sessions). It is referenced here only as the proof of what the framework must support.
- The YAML-with-JS-expressions config dialect is an intent ("declarative list, lazily evaluated config, patch by id"), not a format we must match.

---

## 6. Decisions and open questions for the TanStack version

**Decided**

- **Typing via tokens and inference, not module augmentation.** Services and events are declared as typed tokens (`defineService<T>('key')`, `defineEvent<Args, Result>('name', { mode })`). A plugin's `requires` is a tuple of tokens so `runtime.get(token)` is fully typed with no global namespace and no `declare module` blocks. This is the primary way the package is TanStack-idiomatic rather than a port.
- **Explicit `get(token)`, no Proxy.** The runtime is a plain object. Predictable types, tree-shakable, and cross-copy identity is a non-issue.
- **State lives in TanStack Store.** Instance states, composition list, service registry and effect tree are stores; adapters and devtools subscribe to them. The event bus is a separate mechanism for plugin-to-plugin messages, not for state.
- **Framework-agnostic core + thin adapters** (`core`, then `react-*`), with devtools as a sibling package built from the same stores.
- **Options-object factories and plain functions**; classes are never required of plugin authors.

**Open**

- Route-scoped child runtimes (mount on enter, dispose on leave) as the home for isolate/intercept.
- SSR story for TanStack Start: per-request root runtime on the server, hydrated composition on the client.
- Persistence of composition edits in the browser (localStorage for the MVP).
