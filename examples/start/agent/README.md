# Deployed self-modifying agent

This TanStack Start example runs its agent loop in the tenant Durable Object.
Workers AI supplies the model through the `AI` binding; there is no model key.
The browser follows whole snapshots, while every plugin the agent writes runs
in an isolated Dynamic Worker facet with only the grants named by the base.

```sh
pnpm --filter @tanstack/compose-example-agent dev
```

The default model is `@cf/zai-org/glm-5.3-flash`. The five catalogued chat UI
entries are `page-title`, `markdown`, `working-indicator`, `send-on-enter`, and
`send-on-ctrl-enter`. Ask the agent to list, configure, disable, restore, or
write a plugin and watch the follower snapshot converge.

The workerd suite replaces Workers AI with a deterministic scripted provider:

```sh
pnpm --filter @tanstack/compose-example-agent exec vitest run \
  --config vitest.workerd.config.ts
```

That suite and the browser dev server bind local ports and must be run outside
the repository sandbox.
