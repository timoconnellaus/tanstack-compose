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
  if (value === 'table' || value === 'todo' || value === 'hostile') return value
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

/** Apply one plugin-list edit and return the settled generation. */
export const editCompose = createServerFn({ method: 'POST' })
  .validator((value: { app: AppId; operation: ComposeEdit }) => value)
  .handler(async ({ data }) =>
    (await import('./compose.server'))
      .tenantForApp(parseAppId(data.app))
      .edit(data.operation),
  )

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
