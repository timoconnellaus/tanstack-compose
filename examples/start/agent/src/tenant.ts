import { DurableObject } from 'cloudflare:workers'
import { createFacetHost } from '@tanstack/compose-cloudflare'
import { createTypeScriptChecker } from '@tanstack/compose-typescript'
import declarations from 'compose:declarations'
import {
  agentKey,
  createComposerPlugin,
  createScriptedModelPlugin,
  createSessionPlugin,
  loopPlugin,
  modelsPlugin,
  promptPlugin,
  sessionKey,
  toolsPlugin,
} from '@tanstack/compose-example-agent-runtime'
import { createWorkersAiModelPlugin } from '@tanstack/compose-example-agent-runtime/cloudflare'
import { slotsPlugin, viewsPlugin } from '@tanstack/react-compose'
import { createComposeDurableObject } from '@tanstack/start-compose'
import { base, uiCatalog } from './base'
import { scriptedConversation } from './script'
import type { AnyPlugin, Cleanup } from '@tanstack/compose'
import type { SerializedPluginEntry } from '@tanstack/compose/catalog'
import type { SessionEntry } from '@tanstack/compose-example-agent-runtime'
import type { ComposeValue } from '@tanstack/start-compose'

/** Bindings held by the Start Worker and each tenant Durable Object. */
export interface AgentEnv {
  LOADER: WorkerLoader
  TENANT: DurableObjectNamespace
  AI?: Ai
  /** Present only in workerd: replaces Workers AI with the deterministic script. */
  SCRIPTED_MODEL?: string
}

class TenantBase extends DurableObject<AgentEnv> {}

const sessionStorageKey = 'agent:session'

/** Entries the composer cannot change without dismantling the tenant runtime. */
export const protectedIds = [
  'slots',
  'views',
  'session',
  'tools',
  'prompt',
  'models',
  'model',
  'loop',
  'composer',
  'controller',
] as const

const initialPluginList: Array<SerializedPluginEntry> = [
  { id: 'slots', plugin: { catalog: 'slots' }, stubs: [] },
  { id: 'views', plugin: { catalog: 'views' }, stubs: [] },
  { id: 'session', plugin: { catalog: 'session' }, stubs: [] },
  { id: 'tools', plugin: { catalog: 'tools' }, stubs: [] },
  {
    id: 'prompt',
    plugin: { catalog: 'prompt' },
    options: {
      sections: [
        {
          name: 'role',
          text: 'You are the agent that owns this deployed chat. Its page entries are page-title, markdown, working-indicator, send-on-enter and send-on-ctrl-enter. They are ordinary entries in your plugin list and can be configured, disabled, enabled or restored from the catalog. A source you write runs in an isolated Dynamic Worker facet and can reach only the slots, server, session, agent, storage and schedule grants. Fill chat.main, chat.side or chat.input.actions to add visible UI.',
        },
      ],
    },
    stubs: [],
  },
  { id: 'models', plugin: { catalog: 'models' }, stubs: [] },
  { id: 'model', plugin: { catalog: 'model' }, stubs: [] },
  {
    id: 'loop',
    plugin: { catalog: 'loop' },
    options: { maxSteps: 8 },
    stubs: [],
  },
  { id: 'composer', plugin: { catalog: 'composer' }, stubs: [] },
  { id: 'controller', plugin: { catalog: 'controller' }, stubs: [] },
  { id: 'page-title', plugin: { catalog: 'page-title' }, stubs: [] },
  { id: 'markdown', plugin: { catalog: 'markdown' }, stubs: [] },
  {
    id: 'working-indicator',
    plugin: { catalog: 'working-indicator' },
    stubs: [],
  },
  { id: 'send-on-enter', plugin: { catalog: 'send-on-enter' }, stubs: [] },
]

const catalogFor = ({
  ctx,
  env,
}: {
  ctx: DurableObjectState
  env: AgentEnv
}): Readonly<Record<string, AnyPlugin>> => {
  const session = createSessionPlugin({
    load: async () =>
      await ctx.storage.get<ReadonlyArray<SessionEntry>>(sessionStorageKey),
    save: (entries) => {
      ctx.waitUntil(ctx.storage.put(sessionStorageKey, [...entries]))
    },
  })
  const model =
    env.SCRIPTED_MODEL === 'true'
      ? createScriptedModelPlugin(scriptedConversation)
      : createWorkersAiModelPlugin({
          binding:
            env.AI ??
            (() => {
              throw new Error('agent example: the AI binding is missing')
            })(),
        })
  const grants = Object.values(base.grants)
  return {
    ...base.catalog,
    slots: slotsPlugin,
    views: viewsPlugin,
    session,
    tools: toolsPlugin,
    prompt: promptPlugin,
    models: modelsPlugin,
    model,
    loop: loopPlugin,
    composer: createComposerPlugin({
      catalog: uiCatalog,
      protected: protectedIds,
      stubs: grants,
      host: 'cloudflare',
    }),
  }
}

const snapshotState = (
  client: Parameters<
    NonNullable<
      Parameters<
        typeof createComposeDurableObject<AgentEnv>
      >[0]['snapshotState']
    >
  >[0],
): ComposeValue =>
  ({
    session: client.getContext(sessionKey)?.snapshot() ?? [],
    status: client.getContext(agentKey)?.status.state ?? 'idle',
  }) as unknown as ComposeValue

const subscribeSnapshot = (
  client: Parameters<
    NonNullable<
      Parameters<
        typeof createComposeDurableObject<AgentEnv>
      >[0]['subscribeSnapshot']
    >
  >[0],
  publish: () => void,
): Cleanup => {
  const subscriptions = [
    client.getContext(sessionKey)?.entries.subscribe(publish),
    client.getContext(agentKey)?.status.subscribe(publish),
  ].filter((item) => item !== undefined)
  return () =>
    subscriptions.forEach((subscription) => subscription.unsubscribe())
}

/** One Durable Object class; its object id is the anonymous tenant id. */
export const AgentTenant = createComposeDurableObject<AgentEnv>({
  base: TenantBase,
  initialPluginList,
  catalog: catalogFor,
  grants: base.grants,
  actions: base.actions,
  baseVersion: declarations.version,
  checker: createTypeScriptChecker({
    baseDeclarations: declarations.text,
    baseVersion: declarations.version,
  }),
  hostName: 'cloudflare',
  self: ({ ctx, env }) => env.TENANT.get(ctx.id),
  createHost: ({ ctx, env, self }) =>
    createFacetHost({
      ctx,
      self,
      loader: env.LOADER,
      ai: env.AI,
      compatibilityDate: '2026-09-01',
      callTimeoutMs: 1_000,
      limits: { cpuMs: 1_000 },
    }),
  snapshotState,
  subscribeSnapshot,
})
