import { createServerFn } from '@tanstack/react-start'
import type {
  ComposeDispatch,
  ComposeEdit,
  ComposePress,
  ComposeValue,
} from '@tanstack/start-compose'
import type { ShowcaseApp } from './apps'

type AppId = ShowcaseApp['id']

/** Validate a route or server-function app id. */
export const parseAppId = (value: unknown): AppId => {
  if (
    value === 'table' ||
    value === 'todo' ||
    value === 'hostile' ||
    value === 'digest' ||
    value === 'currency' ||
    value === 'tenants'
  )
    return value
  throw new Error('showcase: invalid app id')
}

/** Ensure the root request has the anonymous tenant cookie. */
export const ensureTenant = createServerFn().handler(async () =>
  (await import('./compose.server')).tenantId(),
)

/** Load the full snapshot used for both SSR and hydration. */
export const getComposeSnapshot = createServerFn()
  .validator(parseAppId)
  .handler(async ({ data }) =>
    (await import('./compose.server')).tenantForApp(data).snapshot(data),
  )

/** Load page 6's two independently named tenant clients. */
export const getTenantSnapshots = createServerFn().handler(async () => {
  const server = await import('./compose.server')
  const root = server.tenantId()
  const left = `${root}:left`
  const right = `${root}:right`
  return {
    left: {
      tenant: left,
      snapshot: await server.tenantFor(left, 'tenants').snapshot('tenants'),
    },
    right: {
      tenant: right,
      snapshot: await server.tenantFor(right, 'tenants').snapshot('tenants'),
    },
  }
})

interface AppTarget {
  app: AppId
  tenant?: string
}

const target = async ({ app, tenant }: AppTarget) => {
  const server = await import('./compose.server')
  return tenant === undefined
    ? server.tenantForApp(parseAppId(app))
    : server.tenantFor(tenant, parseAppId(app))
}

/** Apply one plugin-list edit and return the settled generation. */
export const editCompose = createServerFn({ method: 'POST' })
  .validator((value: AppTarget & { operation: ComposeEdit }) => value)
  .handler(async ({ data }) => (await target(data)).edit(data.operation))

/** Dispatch one named ordinary base action in the authoritative client. */
export const dispatchCompose = createServerFn({ method: 'POST' })
  .validator((value: AppTarget & { request: ComposeDispatch }) => value)
  .handler(async ({ data }): Promise<ComposeValue> => {
    return (await (await target(data)).dispatch(data.request)) as ComposeValue
  })

/** Press a handler owned by one of the snapshot's fills. */
export const pressCompose = createServerFn({ method: 'POST' })
  .validator((value: AppTarget & { request: ComposePress }) => value)
  .handler(async ({ data }): Promise<ComposeValue> => {
    return (await (await target(data)).press(data.request)) as ComposeValue
  })

/** Call a hostile diagnostic export; it is not used by product fills. */
export const callComposeSource = createServerFn({ method: 'POST' })
  .validator(
    (value: unknown) =>
      value as {
        app: AppId
        tenant?: string
        request: { id: string; handler: string; input?: ComposeValue }
      },
  )
  .handler(async ({ data }): Promise<ComposeValue> => {
    return (await (await target(data)).callSource(data.request)) as ComposeValue
  })
