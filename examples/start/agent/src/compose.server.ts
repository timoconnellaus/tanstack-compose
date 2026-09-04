import { env } from 'cloudflare:workers'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import type { ComposeDurableObject } from '@tanstack/start-compose'
import type { AgentEnv } from './tenant'

/** Read or mint the anonymous tenant id carried by the root cookie. */
export const tenantId = (): string => {
  const existing = getCookie('compose-agent-tenant')
  if (existing) return existing
  const created = crypto.randomUUID()
  setCookie('compose-agent-tenant', created, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return created
}

/** Resolve the one authoritative object for this request's tenant. */
export const tenant = (): ComposeDurableObject => tenantNamed(tenantId())

/** Resolve an explicitly named object, used by deterministic tests. */
export const tenantNamed = (name: string): ComposeDurableObject => {
  const bindings = env as unknown as AgentEnv
  return bindings.TENANT.get(
    bindings.TENANT.idFromName(name),
  ) as unknown as ComposeDurableObject
}

const tenantIdOf = (request: Request): string | undefined =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('compose-agent-tenant='))
    ?.slice('compose-agent-tenant='.length)

/** Send the follower upgrade straight to the tenant object. */
export async function followTenant(request: Request): Promise<Response> {
  const id = tenantIdOf(request)
  if (!id) return new Response('no tenant', { status: 401 })
  return await tenantNamed(id).fetch(request)
}
