import { fileURLToPath } from 'node:url'

/** A workspace package, resolved from its source rather than its `dist`. */
const source = (name: string, entry = 'index.ts'): string =>
  fileURLToPath(
    new URL(`../../../packages/${name}/src/${entry}`, import.meta.url),
  )

const moduleSource = (name: string, module: string): string =>
  fileURLToPath(
    new URL(`../../../packages/${name}/src/${module}.ts`, import.meta.url),
  )

/**
 * The workspace packages export their `dist`, which a package build removes and
 * recreates and which is stale until one runs. Resolving them from source keeps
 * dev, tests and the build independent of `dist`, and hot-reloads the kernel.
 * Shared by the Vite and Vitest configs so the two never disagree.
 */
export const workspaceSourceAlias: Record<string, string> = {
  '@tanstack/compose/grants': moduleSource('compose', 'grants/index'),
  '@tanstack/compose/catalog': moduleSource('compose', 'catalog'),
  '@tanstack/compose/base': moduleSource('compose', 'base'),
  '@tanstack/compose/generations': moduleSource('compose', 'generations'),
  '@tanstack/compose-typescript/generate': moduleSource(
    'compose-typescript',
    'generate',
  ),
  '@tanstack/react-compose/view-runtime': moduleSource(
    'react-compose',
    'view-runtime',
  ),
  '@tanstack/compose-cloudflare': source('compose-cloudflare'),
  '@tanstack/compose-devtools/react': source('compose-devtools', 'react.tsx'),
  '@tanstack/compose-typescript': source('compose-typescript'),
  '@tanstack/react-compose': source('react-compose'),
  '@tanstack/start-compose': source('start-compose'),
  '@tanstack/compose': source('compose'),
}
