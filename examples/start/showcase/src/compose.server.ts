import { env } from 'cloudflare:workers'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import type { ComposeDurableObject } from '@tanstack/start-compose'
import type { ShowcaseApp } from './apps'
import type { ShowcaseEnv } from './tenant'

type AppId = ShowcaseApp['id']

/** Read or mint the anonymous tenant id carried by the root cookie. */
export const tenantId = (): string => {
  const existing = getCookie('compose-tenant')
  if (existing) return existing
  const created = crypto.randomUUID()
  setCookie('compose-tenant', created, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return created
}

/** Resolve exactly one server client for this request's `(tenant, app)`. */
export const tenantForApp = (id: AppId): ComposeDurableObject => {
  const bindings = env as unknown as ShowcaseEnv
  const objectId = bindings.TENANT.idFromName(`${tenantId()}:${id}`)
  return bindings.TENANT.get(objectId) as unknown as ComposeDurableObject
}
