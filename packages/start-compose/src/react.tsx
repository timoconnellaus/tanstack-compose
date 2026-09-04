import {
  ComposeProvider,
  createSlotRegistry,
  slotsKey,
} from '@tanstack/react-compose'
import { Store, batch } from '@tanstack/store'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react'
import { applySnapshot } from './snapshot'
import type {
  ActionDefinition,
  Cleanup,
  ClientErrorReport,
  ContextKey,
  ContextSnapshot,
  InstanceSnapshot,
} from '@tanstack/compose'
import type { ComposeView, SlotRegistry } from '@tanstack/react-compose'
import type { ReactNode } from 'react'
import type {
  BrowserStatusReport,
  BrowserViewStatus,
  ComposeDispatch,
  ComposeEdit,
  ComposePress,
  ComposeSnapshot,
  ComposeValue,
  SnapshotEntry,
} from './snapshot'

/** How the Start app reaches its tenant Durable Object. */
export interface ComposeTransport {
  edit: (operation: ComposeEdit) => Promise<ComposeSnapshot | void>
  revert?: (n: number) => Promise<ComposeSnapshot | void>
  press: (request: ComposePress) => Promise<unknown>
  dispatch?: (request: ComposeDispatch) => Promise<unknown>
  callSource?: (request: {
    id: string
    handler: string
    input?: unknown
  }) => Promise<unknown>
}

/** Props for the snapshot-seeded Start provider. */
export interface ComposeStartProps {
  snapshot: ComposeSnapshot
  children?: ReactNode
  transport?: ComposeTransport
  /** WebSocket URL carrying one whole snapshot per message. */
  follow?: string
}

interface SnapshotState {
  snapshot: Store<ComposeSnapshot>
  registry: SlotRegistry
  view: ComposeView
  apply: (snapshot: ComposeSnapshot) => void
  edit: (operation: ComposeEdit) => Promise<void>
  revert: (n: number) => Promise<void>
  setStatusSender: (
    sender: ((report: BrowserStatusReport) => void) | undefined,
  ) => void
}

const SnapshotContext = createContext<SnapshotState | undefined>(undefined)

const createFollower = (
  initial: ComposeSnapshot,
  transport: ComposeTransport,
): SnapshotState => {
  const registry = createSlotRegistry()
  const snapshot = new Store(initial)
  const pluginList = new Store<Array<SnapshotEntry>>(initial.pluginList)
  const instances = new Store<Array<InstanceSnapshot>>(initial.instances)
  const context = new Store<Array<ContextSnapshot>>([
    { key: slotsKey.name, providedBy: 'compose-start' },
  ])
  const errors = new Store<Array<ClientErrorReport>>([])
  const values = new Map<object, unknown>([[slotsKey, registry]])
  const statuses = new Map<string, BrowserViewStatus>()
  let statusGeneration = initial.generation
  let statusSender: ((report: BrowserStatusReport) => void) | undefined
  const dispatch = transport.dispatch
  const callSource = transport.callSource
  const report = (status: BrowserViewStatus): void => {
    statuses.set(status.id, status)
    statusSender?.({
      generation: statusGeneration,
      entries: [...statuses.values()],
    })
  }

  const view: ComposeView = {
    pluginList,
    instances,
    context,
    errors,
    ...(dispatch
      ? {
          dispatch: <TInput, TResult>(
            action: ActionDefinition<TInput, TResult>,
            input: TInput,
          ) =>
            dispatch({
              action: action.name,
              input: input as ComposeValue,
            }) as Promise<TResult>,
        }
      : {}),
    inspect: () => instances.state,
    getContext: <TValue,>(key: ContextKey<TValue>): TValue | undefined =>
      values.get(key) as TValue | undefined,
    ...(callSource
      ? {
          callSource: (id: string, handler: string, input?: unknown) =>
            callSource({ id, handler, input }),
        }
      : {}),
  }

  let removeFills: Cleanup = () => undefined
  const state: SnapshotState = {
    snapshot,
    registry,
    view,
    apply(next) {
      if (next.generation < snapshot.state.generation) return
      statusGeneration = next.generation
      statuses.clear()
      batch(() => {
        removeFills()
        removeFills = applySnapshot(registry, next, transport.press, report)
        pluginList.setState(() => next.pluginList)
        instances.setState(() => next.instances)
        snapshot.setState(() => next)
      })
    },
    async edit(operation) {
      const next = await transport.edit(operation)
      if (next) state.apply(next)
    },
    async revert(n) {
      const next = await transport.revert?.(n)
      if (next) state.apply(next)
    },
    setStatusSender(sender) {
      statusSender = sender
      if (sender && statuses.size > 0) {
        sender({
          generation: statusGeneration,
          entries: [...statuses.values()],
        })
      }
    },
  }
  state.apply(initial)
  return state
}

const defaultTransport: ComposeTransport = {
  async edit(operation) {
    const response = await fetch('/api/compose/edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(operation),
    })
    if (!response.ok) throw new Error(await response.text())
    const snapshot: ComposeSnapshot = await response.json()
    return snapshot
  },
  async press(request) {
    const response = await fetch('/api/compose/press', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!response.ok) throw new Error(await response.text())
    return await response.json()
  },
}

/**
 * Seed the follower synchronously from the route loader snapshot, then follow
 * newer generations after hydration. The first render performs no fetch.
 */
export function ComposeStart(properties: ComposeStartProps): ReactNode {
  const state = useRef<SnapshotState>(undefined)
  if (!state.current) {
    state.current = createFollower(
      properties.snapshot,
      properties.transport ?? defaultTransport,
    )
  }

  useEffect(() => {
    if (!properties.follow) return undefined
    const follow = properties.follow
    let closed = false
    let socket: WebSocket | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    const connect = (): void => {
      socket = new WebSocket(follow)
      socket.addEventListener('open', () => {
        attempt = 0
        state.current?.setStatusSender((report) => {
          socket?.send(JSON.stringify(report))
        })
      })
      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return
        state.current?.apply(JSON.parse(event.data) as ComposeSnapshot)
      })
      socket.addEventListener('close', () => {
        state.current?.setStatusSender(undefined)
        if (closed) return
        const delay = Math.min(5000, 100 * 2 ** attempt)
        attempt += 1
        timer = setTimeout(connect, delay)
      })
    }
    connect()
    return () => {
      closed = true
      state.current?.setStatusSender(undefined)
      clearTimeout(timer)
      socket?.close()
    }
  }, [properties.follow])

  return (
    <SnapshotContext.Provider value={state.current}>
      <ComposeProvider client={state.current.view}>
        {properties.children}
      </ComposeProvider>
    </SnapshotContext.Provider>
  )
}

const useSnapshotState = (): SnapshotState => {
  const state = useContext(SnapshotContext)
  if (!state) {
    throw new Error('@tanstack/start-compose: no ComposeStart provider above')
  }
  return state
}

/** The latest whole snapshot received from the tenant Durable Object. */
export function useComposeSnapshot(): ComposeSnapshot {
  const state = useSnapshotState()
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = state.snapshot.subscribe(onChange)
      return () => subscription.unsubscribe()
    },
    [state],
  )
  const read = useCallback(() => state.snapshot.state, [state])
  return useSyncExternalStore(subscribe, read, read)
}

/** Send a plugin-list edit to the authoritative server client. */
export function useComposeEdit(): (operation: ComposeEdit) => Promise<void> {
  const state = useSnapshotState()
  return useCallback((operation: ComposeEdit) => state.edit(operation), [state])
}

/** Revert to an earlier list by appending and applying a new generation. */
export function useComposeRevert(): (n: number) => Promise<void> {
  const state = useSnapshotState()
  return useCallback((n: number) => state.revert(n), [state])
}
