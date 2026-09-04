# Examples as acceptance criteria

One example application, `examples/start/showcase`, with one page per proof. Each page is
built on the same **base** and proves one property no other page proves. A page is done when its
end-to-end test passes, and every earlier page's test still passes. Terms are
[CONTEXT.md](../../CONTEXT.md)'s; the stance is [ADR-0006](../adr/0006-an-extension-surface-on-ordinary-code.md)
and the grants are [ADR-0007](../adr/0007-authority-is-named-grants.md).

## Shape

- **Stack**: TanStack Start (React 19) on Cloudflare Workers. One **client** per tenant runs in a
  Durable Object; plugin source — server halves _and_ view modules — runs in Dynamic Workers through
  `@tanstack/compose-cloudflare`. A view is data (a `ViewNode` tree naming handlers), so the server
  holds every fill; a Start route loader reads the tenant snapshot (plugin list, instances, fills) and
  **renders the fills on the server**. The browser hydrates a follower client from the same snapshot
  (no layout shift on refresh), then follows live changes over a connection, and sends a view.s
  button presses up to the server, which calls the view module through its host (`ui.md` §E,
  amended: the browser holds fills, never plugin source). This lives in `@tanstack/start-compose`.
  The shell — page frame, navigation, the plugin panel — is ordinary application code with slots,
  not plugins.
- **The base** is one `defineBase({ keys, actions, slots, grants })` in `examples/start/showcase/src/base.ts`.
  The declarations a written plugin is checked against are generated from the base's types at build
  time, never hand-written.
- **No model in the loop to begin with.** Every page has buttons that add a pre-designed plugin
  **as source** — `addPlugin({ id, source, stubs })` — through the checker and the host, exactly as
  an agent would, plus a "paste source" panel. The sources live in `src/fixtures/` and are what a
  later agent path reuses. A model is added only after every page passes without one.
- **Staging**: S1 a TanStack Start app with client-only routes, the client in the browser with the in-process host (pages 1–3);
  S2 the Durable Object client, the Cloudflare host, `@tanstack/start-compose`: SSR of fills and the follower; S3 the grants; S4 the rest.
  Nothing built in S1 is thrown away: the browser client keeps running the shell and the views.

## Pages

| #   | Page                | Proves                                                                     | Grants                                | Done when                                                                                                                                                                                  |
| --- | ------------------- | -------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Table**           | adding a UI feature: a fill, a server half, a view                         | `data`, `slots`, `server`             | "Add export to CSV" puts a button in `table.actions` without a reload; the download is correct; removing the entry removes the button and leaks nothing                                    |
| 2   | **Todo**            | changing existing behaviour through actions; the base-author rule          | actions from hosted code              | "Sort by due date" and "block empty titles" take effect as middleware on `list.sort` and `item.validate`; base code is untouched; removing them restores the original behaviour            |
| 3   | **Hostile gallery** | B1–B4, D1–D6, fail-closed                                                  | all                                   | each hostile source (throws, spins, `fetch`, forges the instance id, smuggles a function, oversized payload, reaches `env`) fails the documented way; siblings stay `active`; revert works |
| 4   | **Digest**          | unattended runs, durable state, a model call from a plugin                 | `schedule`, `storage`, `ai`, `slots`  | with no browser open, the digest runs on its schedule, its cursor survives a restart and a rewrite, and the summary appears in `notifications` on the next visit                           |
| 5   | **Currency**        | no ambient network; a service with a server-side credential                | `http`                                | the plugin reaches the in-repo `currency` service; a request to any other origin fails; the token appears nowhere a plugin, a view or a test can read                                      |
| 6   | **Two tenants**     | one base, one client per tenant; persisted lists and storage               | `storage`                             | editing tenant A's list leaves tenant B byte-identical; both lists and both storages survive a Worker restart                                                                              |
| 7   | **Upgrade**         | generations; re-check on base change; declarations versioned with the base | any                                   | switching to base v2 (a renamed API) re-checks every entry; the broken one lands in `error` with a readable diagnostic; the fixed source from the fixtures repairs it                      |
| 8   | **Pair**            | the dependency graph for written code                                      | keys via grants, `exports`            | B, which consumes A, stays `pending` until A is `active`; removing A deactivates B; re-adding A revives it                                                                                 |
| 9   | **Harness**         | the whole tool surface, operated by an agent built on TanStack AI          | `tools`, `prompt`, `slots`, `storage` | the agent lists, adds from the catalog, writes source, uses it next step, rewrites it, and removes it — through compose's tool definitions, with no compose code in the loop               |

Page 9 is built last and only after pages 1–8 pass without a model; it is the only page with a model.
