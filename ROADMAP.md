# Roadmap — peeling the onion

Each slice is self-contained with its own acceptance file and tests. A slice is
done when its criteria pass and every earlier slice's criteria still pass. Work
is not pulled forward from a later slice.

| # | Slice | Proves | Acceptance | Status |
|---|---|---|---|---|
| 1 | **Kernel** (`@tanstack/compose`): client, plugins, context and deps, cleanup, status, options, middleware and events, plugin list reconciliation, inspection | A plugin can be added, removed, replaced and reconfigured while the application runs, with nothing left behind | [`docs/acceptance/kernel.md`](./docs/acceptance/kernel.md) | in progress |
| 2 | React adapter (`@tanstack/react-compose`) + example app with a composer panel that edits the plugin list live | The kernel is usable from a UI and the plugin list is editable by a human | `docs/acceptance/react.md` | |
| 3 | Devtools (`@tanstack/compose-devtools`): instances, unmet deps, held resources, middleware/event trace | Everything the kernel knows is visible | `docs/acceptance/devtools.md` | |
| 4 | Agent layer (`@tanstack/compose-agent`): context keys for model, tools, prompt, session; the loop plugin; one model provider plugin | An agent whose capabilities are plugins | `docs/acceptance/agent.md` | |
| 5 | Self-modification: plugins giving the agent tools to list, enable, disable, configure and add plugins in its own client | The application edits itself safely | `docs/acceptance/self-modification.md` | |
| 6 | Untrusted plugin runtime: agent-written plugins loaded into isolated Cloudflare Dynamic Workers, represented locally by a proxy plugin; works under `wrangler dev` | Agent-written code runs without trusting it | `docs/acceptance/dynamic-workers.md` | |
| 7 | Scoped clients: child clients per route/request with their own context; TanStack Router and Start integration | Per-scope worlds | `docs/acceptance/scoped-clients.md` | |
| 8 | Hardening: HMR for plugins in dev, persistence of plugin-list edits, size and performance budgets | Ready for others to build on | `docs/acceptance/hardening.md` | |

Terms are defined in [`CONTEXT.md`](./CONTEXT.md); decisions in [`docs/adr/`](./docs/adr).
