# TanStack Compose showcase

The showcase is a TanStack Start application for pages 1–3 of the Compose
example acceptance criteria. It runs one browser client with the in-process
host: add the fixture plugins from the Table, Todo and Hostile gallery pages,
or paste source and choose its grants in the plugin panel.

```sh
pnpm install
pnpm --filter @tanstack/compose-example-showcase dev
```

Open <http://localhost:3061>. The hostile page labels the limits that need the
isolating Cloudflare host added in the next slice; it does not simulate them.

Run its tests with:

```sh
pnpm --filter @tanstack/compose-example-showcase test:types
pnpm --filter @tanstack/compose-example-showcase test:lib
```
