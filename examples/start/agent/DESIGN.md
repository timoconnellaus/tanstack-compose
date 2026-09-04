# Deployed agent example — design

This example is the Harness proof in
[`docs/acceptance/examples.md`](../../../docs/acceptance/examples.md). It uses
the deployed shape of `examples/start/showcase`: TanStack Start on the
Cloudflare Vite plugin, one `createComposeDurableObject` object per anonymous
tenant, a TypeScript checker generated from one `defineBase`, a Dynamic Worker
facet host, server-rendered snapshot hydration, and a follower WebSocket.

## Boundary

The agent runtime is example code in `examples/shared/agent`. Its session,
prompt, tool and model registries, loop, scripted provider, credentials support,
OpenAI-compatible provider, and the adapter that mounts Compose's tool
definitions are ordinary plugins. `@tanstack/compose-tools` knows none of
those concepts.

The tenant Durable Object owns the authoritative client and therefore owns the
loop. Browser code never runs a model, tool, prompt, or written source. It is a
follower over the tenant snapshot and sends only the base's `send` and `cancel`
actions or a fill-owned press back to the object.

## Base and initial list

The base exposes three slots: `chat.main`, `chat.side`, and
`chat.input.actions`; two actions: `send` and `cancel`; and six grants:
`slots`, `server`, read-only `session`, status-only `agent`, `storage`, and
`schedule`. Generated declarations are the only declarations for the
base-defined method-shaped grants.

The initial durable list contains the slot/view infrastructure; session, tool,
prompt and model registries; a Workers AI provider; the loop; the composer
adapter; and the trusted chat UI marker plugins. The runtime entries are
protected. The catalog contains the five independently changeable UI pieces
from the in-page example: page title, Markdown, working indicator,
send-on-enter, and send-on-ctrl-enter. Their browser renderers retain the
in-page behavior; their server instances are inert markers whose presence in
the snapshot selects that behavior.

The `send` and `cancel` actions are owned by a trusted controller plugin in the
object. `send` queues input on the loop and returns only after the loop is idle,
which makes RPC and tests deterministic while session chunks are still
published as they arrive.

## Model provider

`compose-cloudflare` keeps the host-level Workers AI implementation as
`createWorkersAiModel`; it has no dependency on the example runtime. The
example-local `createWorkersAiModelPlugin` wrapper registers that provider in
the example's model registry. The tenant catalog is created per object so the
wrapper closes over that object's `env.AI` binding. The default is
`@cf/zai-org/glm-5.3-flash`. There is no credential plugin entry, key, secret,
or browser proxy in this deployed path.

Tests substitute the example-local scripted model entry. The production
Wrangler config binds Workers AI remotely; the test config does not require an
account.

## Snapshot streaming

Session entries and agent status are added to the existing whole
`ComposeSnapshot` as its optional `state` value. This is simpler than a second
stream and preserves the showcase's reconvergence rule: the loader and every
WebSocket message contain all browser-visible state. The tenant subscribes to
the session-entry and status stores and publishes a whole snapshot for every
change. Consequently a growing assistant response is visible chunk by chunk;
the browser folds consecutive `chunk` entries into the live message until the
complete `assistant` entry arrives.

The example-local session plugin persists its append-only entries in the same
tenant object's storage. Persistence is scheduled with the object's
`waitUntil`, so eviction reconstructs the session before the loop becomes
active without delaying each streamed publication.

## Tool-driven durable edits

Composer tools operate on the ordinary client as ADR-0006 requires. The tenant
factory wraps the client's reconcile action: a list changed from inside the
client is serialized against the same plugin/grant catalogs, appended to the
generation log and persisted before reconciliation, then its outcome is
recorded after reconciliation. Public `edit()` calls use the existing path and
skip that wrapper to avoid a duplicate generation. Thus an agent-written entry
survives object eviction exactly like an operator-written entry.

## Written plugins and isolation

`write_plugin` produces one serialized source entry hosted as a facet. The
entry receives only `slots`, `server`, `session`, `agent`, `storage`, and
`schedule`. The `slots.fill` grant records a plain `ViewNode` with callbacks
bound to exports of that same facet. The follower renders the node; `press`
proves ownership from the snapshot and calls the facet export. No source,
binding, model registry, client, or ambient network reaches the browser or the
facet.

The workerd proof scripts a turn that writes a button fill, observes it in the
snapshot, presses it, and then removes the source entry. Removal destroys the
facet and its fill. The jsdom proof seeds the chat from a snapshot and drives a
scripted turn through the same server action contract.

## Cloudflare lifecycle

One object id is derived from one tenant id. The follower uses the Durable
Object Hibernation WebSocket API already implemented by `start-compose`.
Important state is in object storage; in-memory registries and subscribers are
reconstructed when the object wakes. The Worker uses bindings, typed generated
environment declarations, awaited promises, a current compatibility date, and
no module-level request state.

## Sandbox limit

The workerd and browser checks require binding local ports. This sandbox cannot
run them; the caller runs the documented commands outside it. Slice 10 remains
unmarked until those caller runs are green.
