# `@tanstack/start-compose`

Seed `<ComposeStart>` with the tenant/app snapshot returned by a TanStack Start
route loader. The same snapshot renders on the server and hydrates in the
browser; later generations arrive over the optional follower WebSocket.

The tenant Durable Object class is created with `createComposeDurableObject`,
given the app's catalog, named grants, initial serialized list and facet host.
The catalog may be created per object when trusted plugins close over an
environment binding. Applications may also attach plain `state` to every
snapshot and subscribe the stores that should publish it; client-originated
plugin-list edits are persisted in the same generation log as RPC edits.
