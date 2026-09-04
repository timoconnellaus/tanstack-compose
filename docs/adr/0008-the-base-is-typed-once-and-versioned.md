---
status: accepted
---

# The base is typed once and versioned; the plugin list is an append-only log of generations

Two things go wrong when an agent writes code against a deployed base over time. The declarations the checker uses drift from the base's real types, because they are hand-written strings beside the code they describe. And a redeploy of the base can break plugins that were fine yesterday, with nothing recording what was known to work. This ADR fixes both.

## Declarations are generated from the base

A base declares its extension surface once, in TypeScript, with `defineBase({ keys, actions, slots, grants })`. A grant is **method-shaped**: `defineGrant({ name: 'data', methods: { rows: (arg, ctx) => ... } })`, and hosted code calls it as `data.rows()` — no tagged wire form, no `operation` field. The wire form (`{ method, args }`) is the loopback's concern and never appears in plugin source.

The `.d.ts` text a plugin is checked against is **emitted from the base's types**, not typed by hand: `@tanstack/compose-typescript` gains a build entry (`generateDeclarations`, exposed as a Vite plugin for Start and a CLI for everything else) that runs the TypeScript compiler over the base module and prints, per grant, `declare const <name>: { <method>(arg): Promise<Result> }` with referenced types inlined structurally or emitted as named `type` aliases. The output is one string plus its content hash. The hash is the **base version**; nothing else identifies a base. In development the Vite plugin regenerates on change; in production the string ships with the build. Hand-written `declarations:` on `createStub` stays for hosts and tests but is not how a product base is written.

We rejected runtime schemas (a `zod`-like description generating both validation and `.d.ts`): they lose everything TypeScript expresses beyond JSON, and they would make the base author describe each API twice. We rejected typing the wire form by hand (the S1 form): it is exactly the drift this ADR removes.

## The plugin list is a log of generations

A **generation** is `{ n, parent, at, baseVersion, entries, outcome }`: the full plugin list after one edit, the base version it was checked against, and whether it settled with every enabled entry active (`good`), some entry in `error`/`failed` (`bad`), or not yet (`pending`). The log is append-only; **revert is a new generation** whose entries equal an earlier one's. **Last known good** is the newest `good` generation. Nothing in the log is ever rewritten.

The log is not a kernel concern. The kernel reconciles one list; the log lives where the list persists — the tenant's Durable Object in `@tanstack/start-compose` — as a pure module `@tanstack/compose/generations` (reducer + types, no I/O, outside the kernel's size budget) that any persistence layer can use.

**A base change is a re-check, not a migration.** A redeploy boots a fresh client whose checker runs every source entry against the new declarations anyway; what this ADR adds is that the boot records a generation with the new `baseVersion` and the resulting outcome, so the operator sees "checked against v2: `sort-by-due` failed: `rows` is not a member of `data`" with the diagnostic, and can revert to last known good or replace the source. A plugin is never silently kept running against a base it no longer type-checks against.

## Consequences

- Grant handlers receive `(arg, ctx)` and return a value; the stub, the loopback and the facet wrapper serialise `{ method, args }`. `createStub` with a single `handler` remains as the low-level form the method-shaped grant compiles to.
- The showcase's `src/base.ts` becomes `defineBase(...)`; its `.d.ts` strings and `rowDeclaration` are deleted; the fixtures call `data.rows()` and `actions.wrap('list.sort', { after: 'byDue' })`.
- Every `check()` request carries `baseVersion`; the checker's session cache is keyed by it, so a redeploy never reuses a stale program.
- Page 7 (Upgrade) is proved by a v2 base in the showcase that renames a method; page 8 (Pair) by two written plugins where B lists A's exported key in `deps`.
- Host diagnostics stay on `cause`; the message shown for a bad generation is the checker's diagnostic text (file, line, message), which is a product message here because its reader is the person or agent fixing the source.
