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
    value === 'upgrade' ||
    value === 'pair'
  ) {
    return value
  }
  throw new Error('showcase: invalid app id')
}

/** Ensure the root request has the anonymous tenant cookie. */
export const ensureTenant = createServerFn().handler(async () =>
  (await import('./compose.server')).tenantId(),
)

/** Load the full snapshot used for both SSR and hydration. */
export const getComposeSnapshot = createServerFn()
  .validator(parseAppId)
  .handler(async ({ data }) => {
    const server = await import('./compose.server')
    const boot = data === 'upgrade' ? `${data}:${server.selectedBase()}` : data
    return server.tenantForApp(data).snapshot(boot)
  })

/** Apply one plugin-list edit and return the settled generation. */
export const editCompose = createServerFn({ method: 'POST' })
  .validator((value: { app: AppId; operation: ComposeEdit }) => value)
  .handler(async ({ data }) =>
    (await import('./compose.server'))
      .tenantForApp(parseAppId(data.app))
      .edit(data.operation),
  )

/** Append and apply a copy of one earlier generation. */
export const revertCompose = createServerFn({ method: 'POST' })
  .validator((value: { app: AppId; generation: number }) => value)
  .handler(async ({ data }) =>
    (await import('./compose.server'))
      .tenantForApp(parseAppId(data.app))
      .revert(data.generation),
  )

/** Set the Upgrade cookie and rebuild that tenant client against the base. */
export const switchComposeBase = createServerFn({ method: 'POST' })
  .validator((value: 'v1' | 'v2') => value)
  .handler(async ({ data }) => {
    if (data !== 'v1' && data !== 'v2') throw new Error('invalid base version')
    const server = await import('./compose.server')
    server.selectBase(data)
    return server.tenantForApp('upgrade').reset(`upgrade:${data}`)
  })

/** Dispatch one named ordinary base action in the authoritative client. */
export const dispatchCompose = createServerFn({ method: 'POST' })
  .validator((value: { app: AppId; request: ComposeDispatch }) => value)
  .handler(async ({ data }): Promise<ComposeValue> => {
    const { tenantForApp } = await import('./compose.server')
    return (await tenantForApp(parseAppId(data.app)).dispatch(
      data.request,
    )) as ComposeValue
  })

/** Press a handler owned by one of the snapshot's fills. */
export const pressCompose = createServerFn({ method: 'POST' })
  .validator((value: { app: AppId; request: ComposePress }) => value)
  .handler(async ({ data }): Promise<ComposeValue> => {
    const { tenantForApp } = await import('./compose.server')
    return (await tenantForApp(parseAppId(data.app)).press(
      data.request,
    )) as ComposeValue
  })

/** Call a hostile diagnostic export; it is not used by product fills. */
export const callComposeSource = createServerFn({ method: 'POST' })
  .validator(
    (value: unknown) =>
      value as {
        app: AppId
        request: { id: string; handler: string; input?: ComposeValue }
      },
  )
  .handler(async ({ data }): Promise<ComposeValue> => {
    const { tenantForApp } = await import('./compose.server')
    return (await tenantForApp(parseAppId(data.app)).callSource(
      data.request,
    )) as ComposeValue
  })
