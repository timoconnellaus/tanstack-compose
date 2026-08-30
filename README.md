<img src="https://static.scarf.sh/a.png?x-pxid=tanstack-compose" />

# TanStack Compose

> **Status: scaffold.** The packages here export typed placeholders only. Nothing is implemented yet.

A framework-agnostic **composable plugin runtime**: services, declarative injection,
reversible effects, typed events, and a live composition tree — plus thin framework adapters.

## The idea, in short

Long-running applications built from plugins fail in two recurring ways. **In time**,
a removed plugin leaves its side effects behind — listeners, timers, registrations, open
handles — so "reload just this piece" is never safe. **In space**, plugins depend on each
other through import order and boot scripts, so nothing reacts when a dependency arrives
late, disappears, or is swapped for another implementation.

TanStack Compose's thesis is to make **every side effect reversible** and **every dependency
declarative and reactive**, mediated by a single runtime object that every plugin talks to.
The vocabulary:

| Concept              | What it is                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Runtime**          | The one scoped object a plugin receives. Reaching a capability, listening, emitting, registering cleanup and mounting children all go through it.                                         |
| **Plugin**           | A unit of contribution. Given a runtime and validated config, it registers things. Composition happens outside it.                                                                        |
| **Service**          | A named, typed capability published under a stable key. Consumers name the key and never import the provider — this is the swap point.                                                    |
| **Requirements**     | A plugin declares the service keys it needs. It stays _pending_ until they exist, and is torn down (then re-run) if any go away. Load order comes from requirements, never list position. |
| **Effect**           | Any registration or acquired resource paired with its undo. Unloading an instance runs the undos in reverse and waits for async cleanup to actually finish.                               |
| **Event**            | A typed message on a flat bus, where the dispatch mode (broadcast / parallel / serial / waterfall) is part of the contract. Events are for interception; services are for direct calls.   |
| **Composition tree** | A declarative list of entries — id, plugin, config, enabled — reconciled by id, so the live plugin graph stays in sync with the list as it changes.                                       |

Because of this, **hot reload is just unload-then-load**, and swapping a provider ripples
correctly through everything that depends on it with no extra machinery.

The full design intent, invariants and acceptance scenarios live in [INTENT.md](./INTENT.md).
The build order lives in [ROADMAP.md](./ROADMAP.md).

## Packages

| Package                                                     | Description                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`@tanstack/compose`](./packages/compose)                   | The framework-agnostic kernel: runtime, services, effects, events, composition. |
| [`@tanstack/react-compose`](./packages/react-compose)       | React adapter — provider and hooks.                                             |
| [`@tanstack/compose-devtools`](./packages/compose-devtools) | Devtools panels: instance states, unmet requirements, effect tree, event trace. |
| [`@tanstack/compose-agent`](./packages/compose-agent)       | Agent vocabulary and seam plugins: model, tools, prompt, session.               |

## Examples

- [`examples/react/self-modifying-agent`](./examples/react/self-modifying-agent)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
