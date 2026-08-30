# Contributing

## Prerequisites

- **Node** `>=22` (see [`.nvmrc`](./.nvmrc))
- **pnpm** `>=11.9.0` — the version in `packageManager` is installed automatically by pnpm

## Getting started

```sh
pnpm install
pnpm build:all
```

## Repository layout

```
packages/     publishable packages
examples/     runnable examples, grouped by framework (examples/react/*)
```

Every package builds with [`tsdown`](https://tsdown.dev) from `src/index.ts`, tests with
[Vitest](https://vitest.dev), lints with the shared
[`@tanstack/eslint-config`](https://github.com/TanStack/config), and is orchestrated by
[Nx](https://nx.dev).

## Scripts

Run from the repo root:

| Script             | What it does                                   |
| ------------------ | ---------------------------------------------- |
| `pnpm build`       | Build affected packages                        |
| `pnpm build:all`   | Build every package                            |
| `pnpm test`        | The full CI suite (`test:ci`)                  |
| `pnpm test:pr`     | The same suite, but only for affected projects |
| `pnpm test:lib`    | Vitest                                         |
| `pnpm test:types`  | `tsc` type checks                              |
| `pnpm test:eslint` | ESLint                                         |
| `pnpm test:build`  | `publint --strict` on built output             |
| `pnpm test:format` | Prettier check                                 |
| `pnpm test:sherif` | Cross-package dependency consistency           |
| `pnpm test:knip`   | Unused files/exports/dependencies              |
| `pnpm format`      | Rewrite files with Prettier                    |

Per-package scripts are the same names, run inside `packages/<name>`.

## Adding a package

Copy the shape of an existing package. Each one needs `src/index.ts`, `tests/`,
`package.json`, `tsconfig.json`, `tsconfig.build.json`, `tsdown.config.ts`,
`vitest.config.ts`, `eslint.config.js` and a `README.md`.

## Before opening a pull request

```sh
pnpm test:format
pnpm test:eslint
pnpm test:types
pnpm test:lib
pnpm build
```
