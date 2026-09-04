import { batch } from '@tanstack/store'
import { createSlot, createViewRenderer } from '@tanstack/react-compose'
import { Component, createElement } from 'react'
import type { Cleanup, InstanceSnapshot } from '@tanstack/compose'
import type {
  SerializedPlugin,
  SerializedPluginEntry,
  SerializedValue,
} from '@tanstack/compose/catalog'
import type {
  SlotRegistry,
  ViewCallback,
  ViewNode,
} from '@tanstack/react-compose'
import type { ComponentType, ErrorInfo, ReactNode } from 'react'

/** Backward-compatible name for core's serializable plugin-list entry. */
export type SerializedEntry = SerializedPluginEntry

/** Core's serializable plugin reference. */
export type { SerializedPlugin }

/** Data accepted by Start's serializer and every Compose host boundary. */
export type ComposeValue = SerializedValue

/** Browser-safe list entry; written source is represented, never disclosed. */
export type SnapshotEntry = Omit<SerializedEntry, 'plugin'> & {
  plugin: { catalog: string } | { written: true }
}

/** One hosted view fill as plain snapshot data. */
export interface SerializedFill {
  id: string
  instanceId: string
  slot: string
  order: number
  key?: string
  view: ViewNode
}

/** Everything the browser needs for its first render and later convergence. */
export interface ComposeSnapshot {
  generation: number
  pluginList: Array<SnapshotEntry>
  instances: Array<
    Omit<InstanceSnapshot, 'error'> & { error?: { message: string } }
  >
  fills: Array<SerializedFill>
}

/** One browser's observed render state for a followed view instance. */
export interface BrowserViewStatus {
  id: string
  status: 'active' | 'error'
  error?: { message: string }
}

/** The render states a follower observed for one snapshot generation. */
export interface BrowserStatusReport {
  generation: number
  entries: Array<BrowserViewStatus>
}

/** A person- or agent-authored edit sent to the server client. */
export type ComposeEdit =
  | { type: 'add' | 'write'; entry: SerializedEntry }
  | { type: 'replace'; entries: Array<SerializedEntry> }
  | { type: 'enable'; id: string; enabled: boolean }
  | { type: 'configure'; id: string; options: ComposeValue }
  | { type: 'remove'; id: string }

/** A press sent with the fill-owned view instance id. */
export interface ComposePress {
  viewInstanceId: string
  handler: string
  input?: ComposeValue
}

/** A base action dispatched by name through the tenant's server client. */
export interface ComposeDispatch {
  action: string
  input: ComposeValue
}

/** Read only hosted view fills out of a server slot registry. */
export function serializeFills(registry: SlotRegistry): Array<SerializedFill> {
  return Object.values(registry.state.state.fills).flatMap((fills) =>
    fills.flatMap((fill) => {
      const serialized = fill.serialized
      return serialized === undefined
        ? []
        : [
            {
              id: fill.id,
              instanceId: serialized.instanceId,
              slot: fill.slot,
              order: fill.order,
              ...(fill.key === undefined ? {} : { key: fill.key }),
              view: serialized.view as ViewNode,
            },
          ]
    }),
  )
}

const handlersOf = (view: ViewNode): Array<string> => {
  const names = new Set<string>()
  const visit = (node: ViewNode): void => {
    if (node.type === 'row' || node.type === 'stack') {
      node.children.forEach(visit)
      return
    }
    if (node.type === 'button' && node.onPress) names.add(node.onPress)
    if (node.type === 'input') {
      if (node.onChange) names.add(node.onChange)
      if (node.onSubmit) names.add(node.onSubmit)
    }
  }
  visit(view)
  return [...names]
}

const applied = new WeakMap<SlotRegistry, Array<Cleanup>>()

class RenderBoundary extends Component<
  {
    children?: ReactNode
    onActive: () => void
    onError: (error: unknown) => void
  },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidMount(): void {
    if (!this.state.failed) this.props.onActive()
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onError(error)
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * Replace the browser registry's hosted fills with one whole snapshot. The
 * returned cleanup removes that applied generation.
 */
export function applySnapshot(
  registry: SlotRegistry,
  snapshot: ComposeSnapshot,
  press: (request: ComposePress) => Promise<unknown> = () =>
    Promise.resolve(undefined),
  report?: (status: BrowserViewStatus) => void,
): Cleanup {
  const previous = applied.get(registry) ?? []
  const next: Array<Cleanup> = []
  const render = createViewRenderer()
  batch(() => {
    for (const cleanup of previous) void cleanup()
    for (const fill of snapshot.fills) {
      const callbacks: Record<string, ViewCallback> = {}
      for (const handler of handlersOf(fill.view)) {
        callbacks[handler] = (input) =>
          press({
            viewInstanceId: fill.instanceId,
            handler,
            input: input as ComposeValue | undefined,
          })
      }
      const slot = registry.slot(fill.slot) ?? createSlot(fill.slot)
      const View = render(fill.view, callbacks) as ComponentType
      let remove: Cleanup = () => undefined
      const ReportedView: ComponentType = () =>
        createElement(
          RenderBoundary,
          {
            onActive: () => report?.({ id: fill.instanceId, status: 'active' }),
            onError: (error) => {
              report?.({
                id: fill.instanceId,
                status: 'error',
                error: {
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              })
              queueMicrotask(remove)
            },
          },
          createElement(View),
        )
      remove = registry.fill(slot, {
        order: fill.order,
        ...(fill.key === undefined ? {} : { key: fill.key }),
        render: ReportedView,
        serialized: { instanceId: fill.instanceId, view: fill.view },
      })
      next.push(remove)
    }
  })
  applied.set(registry, next)
  return () => {
    if (applied.get(registry) !== next) return
    applied.delete(registry)
    batch(() => {
      for (const cleanup of next) void cleanup()
    })
  }
}
