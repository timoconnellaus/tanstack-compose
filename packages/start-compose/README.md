# `@tanstack/start-compose`

Seed `<ComposeStart>` with the tenant/app snapshot returned by a TanStack Start
route loader. The same snapshot renders on the server and hydrates in the
browser; later generations arrive over the optional follower WebSocket.

The tenant Durable Object class is created with `createComposeDurableObject`,
given the app's catalog, named grants, initial serialized list and facet host.
