import { DurableObject } from 'cloudflare:workers'
import { createFacetHost } from '@tanstack/compose-cloudflare'
import { createTypeScriptChecker } from '@tanstack/compose-typescript'
import {
  createServerStub,
  createSlotsStub,
  grantView,
  slotsPlugin,
  viewIdOf,
  viewStubs,
  viewsPlugin,
} from '@tanstack/react-compose'
import { createComposeDurableObject } from '@tanstack/start-compose'
import {
  actionsStub,
  dataStub,
  grantableActions,
  tablePlugin,
  todoPlugin,
} from './base'
import { appById, hostileApp, tableApp, todoApp } from './apps'
import type { SerializedEntry } from '@tanstack/start-compose'

/** Bindings held by the Start Worker and each tenant/app Durable Object. */
export interface ShowcaseEnv {
  LOADER: WorkerLoader
  TENANT: DurableObjectNamespace
}

class TenantBase extends DurableObject<ShowcaseEnv> {}

const initialEntries = (appId: string): Array<SerializedEntry> => {
  const app = appById(appId)
  return app.plugins.map((entry) => {
    if (!entry.plugin) throw new Error('showcase: base entries are catalogued')
    return {
      id: entry.id,
      plugin: { catalog: entry.plugin.name },
      options: entry.options,
      enabled: entry.enabled,
      stubs: [],
    }
  })
}

const grants = {
  actions: actionsStub,
  data: dataStub,
  server: createServerStub(),
  'table.slots': createSlotsStub({ slots: tableApp.viewSlots }),
  'todo.slots': createSlotsStub({ slots: todoApp.viewSlots }),
  'hostile.slots': createSlotsStub({ slots: hostileApp.viewSlots }),
}

/**
 * A view entry's `server` grant is typed from its paired server module's
 * exports and its `slots` grant narrowed to the app's slots — the same
 * narrowing the browser-only shape does in `written.ts`.
 */
const resolveStubs: NonNullable<
  Parameters<typeof createComposeDurableObject<ShowcaseEnv>>[0]['resolveStubs']
> = async (entry, context) => {
  const slotsName = entry.stubs.find((name) => name.endsWith('.slots'))
  const serverId = entry.id.endsWith('.view')
    ? entry.id.slice(0, -5)
    : undefined
  const server = context.entries.find(
    (candidate) =>
      candidate.id === serverId && viewIdOf(candidate.id) === entry.id,
  )
  if (
    slotsName === undefined ||
    server === undefined ||
    !('source' in server.plugin)
  ) {
    return entry.stubs.map((name) => {
      const grant = context.grants[name]
      if (!grant) throw new Error(`showcase: no grant named "${name}"`)
      return grant
    })
  }
  const app = appById(slotsName.slice(0, -'.slots'.length))
  const exported = await context.checker?.exports?.({
    source: server.plugin.source,
    grants: server.stubs.flatMap((name) => {
      const grant = context.grants[name]
      return grant ? [{ name, declarations: grant.declarations }] : []
    }),
  })
  return grantView(viewStubs, {
    slots: app.viewSlots,
    ...(exported === undefined ? {} : { exports: exported }),
  })
}

/** One Durable Object class; its object id is `${tenantId}:${app.id}`. */
export const ShowcaseTenant = createComposeDurableObject<ShowcaseEnv>({
  base: TenantBase,
  initialPluginList: initialEntries,
  catalog: {
    slots: slotsPlugin,
    views: viewsPlugin,
    table: tablePlugin,
    todo: todoPlugin,
  },
  grants,
  resolveStubs,
  actions: grantableActions,
  checker: createTypeScriptChecker(),
  hostName: 'cloudflare',
  self: ({ ctx, env }) => env.TENANT.get(ctx.id),
  createHost: ({ ctx, env, self }) =>
    createFacetHost({
      ctx,
      self,
      loader: env.LOADER,
      compatibilityDate: '2026-05-01',
      callTimeoutMs: 250,
      limits: { cpuMs: 1000 },
    }),
})
