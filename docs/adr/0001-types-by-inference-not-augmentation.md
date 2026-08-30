---
status: accepted
---

# Types flow from builders, not from module augmentation

Context keys, events, actions, and plugin options are all created through builder functions (`createContextKey<T>()`, `createEvent<Payload>()`, …) so that a plugin's `deps` tuple determines what it can read from context and every payload type is carried by the value that names it. We rejected the alternative of a global, augmentable `Context` interface: it gives nicer property access but requires every plugin package to ship `declare module` blocks, makes the type of `context` depend on which packages happen to be imported, and is not how the rest of TanStack (Router context, Query keys, Form fields) achieves inference.

## Consequences

- Context is read explicitly (`context.get(key)`), never as a property; there is no `Proxy` in the core.
- Cross-package plugins interoperate with value imports only.
- Devtools and adapters can enumerate keys at runtime because keys are objects, not names.
