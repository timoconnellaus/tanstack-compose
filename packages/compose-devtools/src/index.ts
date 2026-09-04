/**
 * `@tanstack/compose-devtools` — framework-neutral observation of a live
 * TanStack Compose client.
 */
import { createStore } from '@tanstack/store'
import type {
  Client,
  ClientErrorReport,
  PluginEntry,
  ResourceNode,
  Status,
} from '@tanstack/compose'
import type { Subscription } from '@tanstack/store'

/** Options for attaching devtools to a client. */
export interface DevtoolsOptions {
  /** The client to observe. Its lifetime remains owned by the caller. */
  client: Client
}

/** A serialisable description of an error or one of its causes. */
export interface DevtoolsErrorCause {
  message: string
  name?: string
  cause?: DevtoolsErrorCause
}

/** One plugin instance as shown by devtools. */
export interface DevtoolsInstance {
  id: string
  plugin: string
  status: Status
  /** Client stores publish only after settling, when the kernel phase is idle. */
  phase: 'idle'
  /** Named context-key and action deps that are not currently provided. */
  unmetDeps: Array<string>
}

/** A copied node in an instance's held-resource tree. */
export interface DevtoolsResourceNode {
  label: string
  children: Array<DevtoolsResourceNode>
}

/** The held resources for one plugin instance. */
export interface DevtoolsInstanceResources {
  instanceId: string
  tree: DevtoolsResourceNode
}

/** Shared metadata on every plugin-list entry. */
export interface DevtoolsPluginEntryBase {
  id: string
  enabled: boolean
  /** Names of stubs granted to a hosted entry. */
  granted: Array<string>
}

/** A plugin-list entry backed by an imported plugin. */
export interface DevtoolsPluginObjectEntry extends DevtoolsPluginEntryBase {
  plugin: string
  source?: never
}

/** Safe source metadata for a plugin-list entry backed by plugin source. */
export interface DevtoolsPluginSourceEntry extends DevtoolsPluginEntryBase {
  plugin?: never
  source: {
    length: number
    host: string
  }
}

/** One serialisable row of the reconciled plugin list. */
export type DevtoolsPluginEntry =
  DevtoolsPluginObjectEntry | DevtoolsPluginSourceEntry

/** One context-table row. */
export interface DevtoolsContextEntry {
  key: string
  provider: string
}

/** One contained client failure. */
export interface DevtoolsError {
  message: string
  instanceId?: string
  phase: ClientErrorReport['scope']
  cause?: DevtoolsErrorCause
}

/** A plain, serialisable view of everything the devtools currently shows. */
export interface DevtoolsSnapshot {
  instances: Array<DevtoolsInstance>
  resources: Array<DevtoolsInstanceResources>
  pluginList: Array<DevtoolsPluginEntry>
  context: Array<DevtoolsContextEntry>
  errors: Array<DevtoolsError>
}

/** A callback notified with the current snapshot after any observed store edit. */
export type DevtoolsSubscriber = (snapshot: DevtoolsSnapshot) => void

/** A framework-neutral devtools attachment. */
export interface Devtools {
  /** Stop every subscription created through this attachment. */
  close: () => void
  /** Read a fresh serialisable snapshot. */
  snapshot: () => DevtoolsSnapshot
  /** Observe snapshots. The returned function removes this subscription. */
  subscribe: (subscriber: DevtoolsSubscriber) => () => void
}

const copyResource = (node: ResourceNode): DevtoolsResourceNode => ({
  label: node.label,
  children: node.children.map(copyResource),
})

const copyPluginEntry = (entry: PluginEntry): DevtoolsPluginEntry => {
  const shared: DevtoolsPluginEntryBase = {
    id: entry.id,
    enabled: entry.enabled !== false,
    granted: entry.stubs?.map((stub) => stub.name) ?? [],
  }
  if (entry.source !== undefined) {
    return {
      ...shared,
      source: {
        length: entry.source.length,
        host: entry.host ?? 'in-process',
      },
    }
  }
  return { ...shared, plugin: entry.plugin.name }
}

const fallbackMessage = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  try {
    const encoded: unknown = JSON.stringify(value)
    if (typeof encoded === 'string') return encoded
  } catch {
    // A thrown value is allowed to be cyclic. String conversion is the fallback.
  }
  try {
    return String(value)
  } catch {
    return 'Unknown error'
  }
}

const copyErrorCause = (
  value: unknown,
  seen: Set<unknown>,
  depth = 0,
): DevtoolsErrorCause => {
  if (depth >= 20) return { message: '[Cause chain truncated]' }
  if (typeof value !== 'object' || value === null) {
    return { message: fallbackMessage(value) }
  }
  if (seen.has(value)) return { message: '[Circular cause]' }
  seen.add(value)

  const error = value as { cause?: unknown; message?: unknown; name?: unknown }
  const message =
    typeof error.message === 'string' ? error.message : fallbackMessage(value)
  const name = typeof error.name === 'string' ? error.name : undefined
  return {
    message,
    ...(name === undefined ? {} : { name }),
    ...(error.cause === undefined
      ? {}
      : { cause: copyErrorCause(error.cause, seen, depth + 1) }),
  }
}

const copyError = (report: ClientErrorReport): DevtoolsError => {
  const copied = copyErrorCause(report.error, new Set())
  return {
    message: copied.message,
    phase: report.scope,
    ...(report.instanceId === undefined
      ? {}
      : { instanceId: report.instanceId }),
    ...(copied.cause === undefined ? {} : { cause: copied.cause }),
  }
}

/** Build a serialisable snapshot directly from a client's public stores. */
function snapshotClient(client: Client): DevtoolsSnapshot {
  const instances = client.instances.state
  return {
    instances: instances.map((instance) => ({
      id: instance.id,
      plugin: instance.plugin,
      status: instance.status,
      phase: 'idle',
      unmetDeps: [...instance.missing],
    })),
    resources: instances.flatMap((instance) => {
      const tree = client.resources(instance.id)
      return tree ? [{ instanceId: instance.id, tree: copyResource(tree) }] : []
    }),
    pluginList: client.pluginList.state.map(copyPluginEntry),
    context: client.context.state.map((entry) => ({
      key: entry.key,
      provider: entry.providedBy,
    })),
    errors: client.errors.state.map(copyError),
  }
}

/** Attach framework-neutral devtools to a client. */
export function createDevtools({ client }: DevtoolsOptions): Devtools {
  // A computed store tracks all four client stores. TanStack Store deduplicates
  // its notification when several inputs change inside one kernel batch.
  const snapshots = createStore(() => snapshotClient(client))
  const subscriptions = new Set<Subscription>()
  let closed = false

  return {
    close: () => {
      if (closed) return
      closed = true
      for (const subscription of subscriptions) subscription.unsubscribe()
      subscriptions.clear()
    },
    snapshot: () => snapshots.state,
    subscribe: (subscriber) => {
      if (closed) return () => undefined
      const subscription = snapshots.subscribe(subscriber)
      subscriptions.add(subscription)
      return () => {
        subscription.unsubscribe()
        subscriptions.delete(subscription)
      }
    },
  }
}
