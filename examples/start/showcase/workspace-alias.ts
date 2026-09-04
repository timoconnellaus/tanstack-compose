import { fileURLToPath } from 'node:url'

/** A workspace package, resolved from its source rather than its `dist`. */
const source = (name: string): string =>
  fileURLToPath(
    new URL(`../../../packages/${name}/src/index.ts`, import.meta.url),
  )

/**
 * The workspace packages export their `dist`, which a package build removes and
 * recreates and which is stale until one runs. Resolving them from source keeps
 * dev, tests and the build independent of `dist`, and hot-reloads the kernel.
 * Shared by the Vite and Vitest configs so the two never disagree.
 */
export const workspaceSourceAlias: Record<string, string> = {
  '@tanstack/compose-typescript': source('compose-typescript'),
  '@tanstack/react-compose': source('react-compose'),
  '@tanstack/compose': source('compose'),
}
