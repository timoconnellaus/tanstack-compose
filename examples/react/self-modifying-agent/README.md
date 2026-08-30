# Example: self-modifying agent

A placeholder React app wired to the workspace packages
[`@tanstack/compose`](../../../packages/compose) and
[`@tanstack/react-compose`](../../../packages/react-compose).

It aims at the scenario the repo is built for: an agent whose own composition — model
adapter, tools, prompt sections, panels — is a list the running UI can edit, reconciled
by id, with every plugin's effects unwound on unload.

> **Status: scaffold.** It type-checks and builds; it does not do anything yet.

```sh
pnpm install
pnpm build:all
pnpm --filter @tanstack/compose-example-react-self-modifying-agent dev
```
