<img src="https://static.scarf.sh/a.png?x-pxid=tanstack-compose" />

# TanStack Compose

> **Status: pre-release.** The kernel, the agent layer, self-modification, the Cloudflare host and the browser UI are implemented and tested; the API is not yet stable. See [ROADMAP.md](./ROADMAP.md).

A framework-agnostic **composable plugin runtime**: an application is assembled from
plugins that can be added, removed, replaced and reconfigured while it runs — with full
type inference, `@tanstack/store`-backed state, and thin framework adapters.

## The idea, in short

A **client** runs an ordered **plugin list**. Each **plugin** can provide typed values into
shared **context**, declare the context keys it **depends** on, wrap other plugins'
**actions** with **middleware**, listen to **events**, and hold resources that are cleaned
up when it is removed. A plugin whose deps are missing waits as `pending` and starts the
moment they appear; if a dep disappears the plugin is cleaned up and waits again. Editing
the plugin list — from a UI, from code, or from a plugin editing its own client — is how
the application changes shape at runtime.

The glossary is [CONTEXT.md](./CONTEXT.md); decisions are in [docs/adr](./docs/adr);
what "done" means per slice is in [docs/acceptance](./docs/acceptance); the build order
is [ROADMAP.md](./ROADMAP.md).

## Packages

| Package                                                             | Description                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`@tanstack/compose`](./packages/compose)                           | The framework-agnostic kernel: runtime, services, effects, events, composition. |
| [`@tanstack/react-compose`](./packages/react-compose)               | React adapter — provider and hooks.                                             |
| [`@tanstack/compose-devtools`](./packages/compose-devtools)         | Devtools panels: instance states, unmet requirements, effect tree, event trace. |
| [`@tanstack/compose-agent`](./packages/compose-agent)               | The agent layer: model, tools, prompt, session and the loop, all as plugins.    |
| [`@tanstack/compose-agent-openai`](./packages/compose-agent-openai) | An OpenAI-compatible chat-completions model provider, over `fetch`.             |
| [`@tanstack/compose-typescript`](./packages/compose-typescript)     | Type-checks and transpiles written plugin source against its granted stubs.     |

## Examples

- [`examples/react/self-modifying-agent`](./examples/react/self-modifying-agent)
- [`examples/start/showcase`](./examples/start/showcase)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
