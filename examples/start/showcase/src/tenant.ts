import { DurableObject } from 'cloudflare:workers'
import { createFacetHost } from '@tanstack/compose-cloudflare'
import {
  aiStub,
  filesStub,
  httpStub,
  scheduleStub,
  storageStub,
} from '@tanstack/compose/grants'
import { createTypeScriptChecker } from '@tanstack/compose-typescript'
import declarationsV1 from 'compose:declarations'
import declarationsV2 from 'compose:declarations-v2'
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
  depsStub,
  exportsStub,
  grantableActions,
  tablePlugin,
  todoPlugin,
} from './base'
import { dataV2Stub } from './base-v2'
import {
  appById,
  currencyApp,
  digestApp,
  hostileApp,
  tableApp,
  tenantsApp,
  todoApp,
  upgradeApp,
  pairApp,
} from './apps'
import type { SerializedPluginEntry } from '@tanstack/compose/catalog'

/** Bindings held by the Start Worker and each tenant/app Durable Object. */
export interface ShowcaseEnv {
  LOADER: WorkerLoader
  TENANT: DurableObjectNamespace
  AI?: Ai
  FILES: R2Bucket
  CURRENCY: Fetcher
  CURRENCY_CREDENTIAL: string
}

class TenantBase extends DurableObject<ShowcaseEnv> {}

const initialEntries = (appId: string): Array<SerializedPluginEntry> => {
  const app = appById(appId.split(':')[0]!)
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
  ai: aiStub,
  actions: actionsStub,
  data: dataStub,
  deps: depsStub,
  exports: exportsStub,
  files: filesStub,
  http: httpStub,
  schedule: scheduleStub,
  storage: storageStub,
  server: createServerStub(),
  'table.slots': createSlotsStub({ slots: tableApp.viewSlots }),
  'todo.slots': createSlotsStub({ slots: todoApp.viewSlots }),
  'hostile.slots': createSlotsStub({ slots: hostileApp.viewSlots }),
  'digest.slots': createSlotsStub({ slots: digestApp.viewSlots }),
  'currency.slots': createSlotsStub({ slots: currencyApp.viewSlots }),
  'tenants.slots': createSlotsStub({ slots: tenantsApp.viewSlots }),
  'upgrade.slots': createSlotsStub({ slots: upgradeApp.viewSlots }),
  'pair.slots': createSlotsStub({ slots: pairApp.viewSlots }),
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
      if (name === 'data' && context.baseVersion === declarationsV2.version) {
        return dataV2Stub
      }
      const grant = context.grants[name]
      if (!grant) throw new Error(`showcase: no grant named "${name}"`)
      return grant
    })
  }
  const app = appById(slotsName.slice(0, -'.slots'.length))
  const exported = await context.checker?.exports?.({
    source: server.plugin.source,
    grants: server.stubs.flatMap((name) => {
      if (!Object.hasOwn(context.grants, name)) return []
      const grant = context.grants[name]
      return [{ name, declarations: grant.declarations }]
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
  baseVersion: (appId) =>
    appId?.endsWith(':v2') ? declarationsV2.version : declarationsV1.version,
  createChecker: (version) => {
    const declarations =
      version === declarationsV2.version ? declarationsV2 : declarationsV1
    return createTypeScriptChecker({
      baseDeclarations: declarations.text,
      baseVersion: declarations.version,
    })
  },
  hostName: 'cloudflare',
  self: ({ ctx, env }) => env.TENANT.get(ctx.id),
  createHost: ({ ctx, env, self }) =>
    createFacetHost({
      ctx,
      self,
      loader: env.LOADER,
      services: {
        currency: {
          origin: 'https://currency.showcase.internal',
          credential: {
            header: 'authorization',
            value: env.CURRENCY_CREDENTIAL,
          },
        },
      },
      serviceBindings: { currency: env.CURRENCY },
      ai: env.AI,
      files: env.FILES,
      compatibilityDate: '2026-05-01',
      callTimeoutMs: 250,
      limits: { cpuMs: 1000 },
    }),
})
