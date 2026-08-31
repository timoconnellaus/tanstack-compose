# Working in this repository

TanStack Compose is a composable plugin runtime with a framework-agnostic core
(`packages/compose`), framework adapters, devtools, and an agent layer built on
top. It follows the conventions of the other TanStack libraries.

## Where things are decided

| Question                            | Answer lives in                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What is this thing called?          | [`CONTEXT.md`](./CONTEXT.md) — use its terms in code, docs, tests, and commit messages; treat its `_Avoid_` lists as lint.                             |
| Why was it built this way?          | [`docs/adr/`](./docs/adr) — one short file per decision. Add one only for a hard-to-reverse choice with real alternatives.                             |
| When is a piece of work done?       | [`docs/acceptance/`](./docs/acceptance) — numbered, observable criteria per slice. Every criterion id appears in the title of the test that proves it. |
| What order do we build in?          | [`ROADMAP.md`](./ROADMAP.md)                                                                                                                           |
| How does a package work internally? | `packages/<name>/DESIGN.md`, written by whoever implements it, before the implementation.                                                              |
| Background reading                  | [`docs/research/`](./docs/research) — reference material for humans; it is not a spec.                                                                 |

## How work proceeds

1. Each roadmap slice names its acceptance file before implementation starts.
2. Write `DESIGN.md` for the package first: the primitives chosen, the lifecycle, how each acceptance criterion maps to them, and any open point you decided. Then implement.
3. Design from the acceptance criteria and the glossary. Where a criterion is silent, choose the smallest thing that satisfies it, record the choice in `DESIGN.md`, and continue.
4. Prefer few orthogonal primitives over many convenient ones. Public API is plain functions and options objects; plugin authors never need classes.
5. Types are inferred from values passed to builders (ADR-0001). Observable state is a `@tanstack/store` store (ADR-0002). Interception is middleware around actions; events are observe-only (ADR-0003).
6. Every public export has a short JSDoc. Package READMEs show usage, not internals.
7. Do not pull work forward from a later roadmap slice.

## Commands

```sh
pnpm install
pnpm build:all                 # all packages, esm + cjs + dts
pnpm nx run-many --target=test:lib     # vitest
pnpm nx run-many --target=test:types   # tsc
pnpm nx run-many --target=test:eslint
pnpm test:format               # prettier check
pnpm test:knip                 # unused exports/deps
pnpm test:sherif               # workspace dependency hygiene
pnpm test:ci                   # everything CI runs
```

Run the package-scoped variants (`pnpm --filter @tanstack/compose test:lib`) while iterating; run `pnpm test:ci` before committing.

## Conventions

- pnpm workspace + nx; TypeScript strict; vitest; eslint via `@tanstack/eslint-config`; prettier; tsdown builds with strict publint.
- Tests live in `packages/<name>/tests/`, grouped by acceptance-criterion section (`tests/A-lifecycle.test.ts`, …), and each `it()` title starts with the criterion id it proves.
- Package names: `@tanstack/compose`, `@tanstack/react-compose`, `@tanstack/compose-devtools`, `@tanstack/compose-agent`. Examples live under `examples/<framework>/<name>`.
- Commits: conventional-commit prefixes (`feat`, `fix`, `chore`, `docs`, `test`), one slice or one concern per commit.
