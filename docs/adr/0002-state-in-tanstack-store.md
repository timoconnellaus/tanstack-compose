---
status: accepted
---

# All observable client state lives in `@tanstack/store`

The plugin list, instance statuses, provided context, and held-resource trees are `@tanstack/store` stores rather than a bespoke subscription mechanism. Framework adapters and devtools subscribe to these stores the same way every other TanStack library's adapters do, which keeps the core framework-agnostic and the adapters thin. Events and middleware are a separate mechanism for plugin-to-plugin behaviour and are not used to carry state.

## Consequences

- `@tanstack/store` is the core package's only runtime dependency.
- The plugin list is edited by writing to a store; reconciliation is a reaction to that write.
- Any state a plugin wants adapters to see should also be a store.
