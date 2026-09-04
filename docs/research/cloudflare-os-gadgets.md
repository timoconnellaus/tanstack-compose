# Research: cloudflare-os gadgets, and what compose takes from them

Source: [cloudflare/cloudflare-os](https://github.com/cloudflare/cloudflare-os) — `README.md`,
`AGENTS.md`, `plans/multi-gadget.md`, `packages/workshop-backend/src/overseer.ts`, the
`gatekeeper-*` packages. Read 2026-09-04. Reference for humans; not a spec.

## What a gadget is

A private application instance an agent creates. Its **backend** runs in a Dynamic Worker with no
internet, mounted as a **Durable Object facet** (`gadget${id}`) of one Overseer DO per workspace, so
it owns SQLite storage, alarms and hibernating WebSockets; a code commit calls `bumpVersion()`,
which aborts that gadget's facet and remounts the new code over the same storage. Its **frontend**
is React in a sandboxed iframe talking to the backend over Cap'n Web RPC. Its code lives in Yjs
documents persisted through isomorphic-git; a **Blueprint** is a copy of the code, never the state.

## Authority

"Each agent, and each Gadget, by default has access to nothing." Every capability a gadget holds is
a **loopback stub in `env`** (`makeBindingLoopback({ type: 'gatekeeper' | 'gadget', id })`), listed
in `GadgetRecord.bindings: Record<name, { target }>`. External services sit behind **gatekeepers** —
one Worker per service (GitHub, Google, Slack, Notion, a scheduler…) that holds the OAuth
credential and narrows access; `getGatekeeperClassFor()` is the single chokepoint where disabled
resources are refused before a capability is minted. A resource becomes ambient only by operator
configuration; a gatekeeper never asserts its own ambience.

## Correspondence with compose

| cloudflare-os                                     | compose                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| backend in a Dynamic Worker, no internet          | hosted plugin, `globalOutbound: null` (hosts.md D1)                                   |
| loopback stubs in `env`, identity in the loopback | stubs as loopback entrypoints with `props = { instanceId, stub }` (ADR-0005)          |
| gatekeepers                                       | grants (ADR-0007): `http` names a service; the credential stays server-side           |
| `bindings` per gadget                             | `entry.stubs` per entry                                                               |
| `bumpVersion()` aborts and remounts               | content-hash keyed isolates (D2); generations (slice 9)                               |
| a facet per gadget: own storage, alarms, sockets  | **adopted** — see below                                                               |
| iframe client over Cap'n Web RPC                  | **not adopted**: views are data rendered by the shell, so they can be server-rendered |
| Yjs + isomorphic-git for code                     | not adopted: the plugin list is the source of truth                                   |

## Adopted: a server half is a facet of the tenant's Durable Object

The host-generated wrapper module is the facet class. On construct it imports the written module
and calls its default export with `{ id, options, stubs }` — the written plugin's shape and its
declarations are unchanged — but the `storage` and `schedule` grants are implemented inside the
wrapper over `this.ctx.storage` and its alarm, locally, not as loopbacks. The in-process host
implements the same two grants over a `Map` and a timer, so it stays the oracle. A rewrite remounts
over the same storage; removal deletes the facet. This is what ADR-0007's storage promise means on
Cloudflare, and it makes a plugin with real-time state an ordinary hosted plugin rather than a new
kind of host. The `Host` contract gains the distinction the facet forces: `stop` releases the code
and keeps the state; `destroy` removes both.

FrockBot's spike (`spike-applet-facets.md`) showed that neither cloudflare-os's
`allow_irrevocable_stub_storage` flag nor its 2026-02-01 compatibility date is required for facets.
