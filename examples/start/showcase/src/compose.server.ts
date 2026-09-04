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
  return tenantFor(tenantId(), id)
}

/** Resolve one explicitly named showcase tenant/app client. */
export const tenantFor = (tenant: string, id: AppId): ComposeDurableObject => {
  const bindings = env as unknown as ShowcaseEnv
  const objectId = bindings.TENANT.idFromName(`${tenant}:${id}`)
  return bindings.TENANT.get(objectId) as unknown as ComposeDurableObject
}

/** The tenant id carried by a raw request's cookie, outside Start's context. */
const tenantIdOf = (request: Request): string | undefined =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('compose-tenant='))
    ?.slice('compose-tenant='.length)

/**
 * Upgrade a follower socket straight from the Worker's fetch: a WebSocket
 * upgrade must reach the Durable Object untouched, and Start's request
 * pipeline is for pages and server functions.
 */
export async function followTenant(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const app = url.searchParams.get('app')
  const tenant = url.searchParams.get('tenant') ?? tenantIdOf(request)
  if (
    app !== 'table' &&
    app !== 'todo' &&
    app !== 'hostile' &&
    app !== 'digest' &&
    app !== 'currency' &&
    app !== 'tenants'
  ) {
    return new Response('unknown app', { status: 400 })
  }
  if (tenant === undefined) return new Response('no tenant', { status: 401 })
  const bindings = env as unknown as ShowcaseEnv
  const object = bindings.TENANT.get(
    bindings.TENANT.idFromName(`${tenant}:${app}`),
  ) as unknown as ComposeDurableObject
  return await object.fetch(request)
}
