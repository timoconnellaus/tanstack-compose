import { fileURLToPath } from 'node:url'

const packageSource = (name: string, entry = 'index.ts'): string =>
  fileURLToPath(
    new URL(`../../../packages/${name}/src/${entry}`, import.meta.url),
  )

const packageModule = (name: string, module: string): string =>
  fileURLToPath(
    new URL(`../../../packages/${name}/src/${module}.ts`, import.meta.url),
  )

const sharedAgent = fileURLToPath(
  new URL('../../shared/agent/src/index.ts', import.meta.url),
)

/** Resolve workspace packages from source so examples do not depend on stale dist. */
export const workspaceSourceAlias: Record<string, string> = {
  '@tanstack/compose/grants': packageModule('compose', 'grants/index'),
  '@tanstack/compose/catalog': packageModule('compose', 'catalog'),
  '@tanstack/compose/base': packageModule('compose', 'base'),
  '@tanstack/compose/generations': packageModule('compose', 'generations'),
  '@tanstack/compose-typescript/generate': packageModule(
    'compose-typescript',
    'generate',
  ),
  '@tanstack/react-compose/view-runtime': packageModule(
    'react-compose',
    'view-runtime',
  ),
  '@tanstack/compose-example-agent-runtime/cloudflare': fileURLToPath(
    new URL('../../shared/agent/src/cloudflare.ts', import.meta.url),
  ),
  '@tanstack/compose-example-agent-runtime': sharedAgent,
  '@tanstack/compose-cloudflare': packageSource('compose-cloudflare'),
  '@tanstack/compose-tools': packageSource('compose-tools'),
  '@tanstack/compose-typescript': packageSource('compose-typescript'),
  '@tanstack/react-compose': packageSource('react-compose'),
  '@tanstack/start-compose': packageSource('start-compose'),
  '@tanstack/compose': packageSource('compose'),
}
