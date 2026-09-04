import { createServerFn } from '@tanstack/react-start'
import type {
  ComposeDispatch,
  ComposePress,
  ComposeValue,
} from '@tanstack/start-compose'

/** Ensure SSR has minted the anonymous tenant cookie. */
export const ensureTenant = createServerFn().handler(async () =>
  (await import('./compose.server')).tenantId(),
)

/** Load the whole plugin, fill, session and status snapshot. */
export const getComposeSnapshot = createServerFn().handler(async () =>
  (await import('./compose.server')).tenant().snapshot('agent'),
)

/** Dispatch a trusted `send` or `cancel` base action. */
export const dispatchCompose = createServerFn({ method: 'POST' })
  .validator((value: { request: ComposeDispatch }) => value)
  .handler(
    async ({ data }): Promise<ComposeValue> =>
      (await (
        await import('./compose.server')
      )
        .tenant()
        .dispatch(data.request)) as ComposeValue,
  )

/** Press a handler owned by a serialized facet fill. */
export const pressCompose = createServerFn({ method: 'POST' })
  .validator((value: { request: ComposePress }) => value)
  .handler(
    async ({ data }): Promise<ComposeValue> =>
      (await (
        await import('./compose.server')
      )
        .tenant()
        .press(data.request)) as ComposeValue,
  )
