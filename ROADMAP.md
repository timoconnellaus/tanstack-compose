# Roadmap — peeling the onion

Each step is a self-contained slice with its own tests. A step is done when its
tests pass and the previous steps' tests still pass. Do not pull work forward
from a later step.

| # | Slice | Proves | Status |
|---|---|---|---|
| 1 | **Kernel: runtime, tokens, mount, effects, lifecycle, dispose** | Temporal composability: unloading a plugin restores prior state | in progress |
| 2 | Requirements: `requires` tuple, pending state, teardown/re-run when a service goes away or returns | Spatial composability: dependencies are live | |
| 3 | Events: typed tokens, broadcast + waterfall (veto), listener as effect, listener error containment | Interception without imports | |
| 4 | Composition store + reconciler: `{id, plugin, config, disabled}[]` diffed by id; restart on config change | Declarative composition, self-modification | |
| 5 | React adapter + example "self-modifying dashboard" (slots service, clock, theme, composer panel) | The MVP | |
| 6 | Devtools package (instances, unmet requirements, effect tree, event trace) | Observability | |
| 7 | Scoped runtimes: extend / isolate / intercept; route-scoped child runtimes | Per-scope worlds | |
| 8 | Config schemas (Standard Schema), fail-loud validation, HMR, persistence | Hardening | |

See INTENT.md for the invariants each slice must satisfy.
