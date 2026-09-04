import { ComposeStart } from '@tanstack/start-compose'
import { useMemo } from 'react'
import {
  callComposeSource,
  dispatchCompose,
  editCompose,
  pressCompose,
  revertCompose,
} from '../compose-functions'
import { AppFrame } from './app-frame'
import type { ShowcaseApp } from '../apps'
import type {
  ComposeSnapshot,
  ComposeTransport,
  ComposeValue,
} from '@tanstack/start-compose'
import type { ReactNode } from 'react'

/** Seed and follow one `(tenant, app)` client while rendering the usual frame. */
export function DeployedApp(properties: {
  app: ShowcaseApp
  snapshot: ComposeSnapshot
  tenant?: string
  children: ReactNode
}): ReactNode {
  const transport = useMemo<ComposeTransport>(
    () => ({
      edit: (operation) =>
        editCompose({
          data: {
            app: properties.app.id,
            tenant: properties.tenant,
            operation,
          },
        }),
      revert: (generation) =>
        revertCompose({
          data: {
            app: properties.app.id,
            tenant: properties.tenant,
            generation,
          },
        }),
      dispatch: (request) =>
        dispatchCompose({
          data: { app: properties.app.id, tenant: properties.tenant, request },
        }),
      press: (request) =>
        pressCompose({
          data: { app: properties.app.id, tenant: properties.tenant, request },
        }),
      callSource: (request) =>
        callComposeSource({
          data: {
            app: properties.app.id,
            tenant: properties.tenant,
            request: {
              ...request,
              input: request.input as ComposeValue | undefined,
            },
          },
        }),
    }),
    [properties.app.id, properties.tenant],
  )
  return (
    <ComposeStart
      key={`${properties.app.id}:${properties.tenant ?? 'cookie'}`}
      snapshot={properties.snapshot}
      transport={transport}
      follow={`/api/compose/follow?app=${properties.app.id}${properties.tenant === undefined ? '' : `&tenant=${encodeURIComponent(properties.tenant)}`}`}
    >
      <AppFrame app={properties.app}>{properties.children}</AppFrame>
    </ComposeStart>
  )
}
