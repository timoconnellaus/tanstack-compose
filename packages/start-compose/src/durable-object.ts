import { createClient, sourceErrorOf } from '@tanstack/compose'
import { slotsKey } from '@tanstack/react-compose'
import { serializeFills } from './snapshot'
import type {
  AnyAction,
  AnyPlugin,
  AnyStubGrant,
  Client,
  Host,
  InstanceSnapshot,
  PluginEntry,
  SourceChecker,
} from '@tanstack/compose'
import type { SlotRegistry, ViewNode } from '@tanstack/react-compose'
import type {
  BrowserStatusReport,
  ComposeDispatch,
  ComposeEdit,
  ComposePress,
  ComposeSnapshot,
  SerializedEntry,
} from './snapshot'

interface DurableObjectConstructor<TEnv> {
  new (ctx: DurableObjectState, env: TEnv): object
}

interface ComposeDurableObjectHost extends Host {
  alarm: () => Promise<void>
  schedule: (operation: unknown) => Promise<void>
  stubCall?: (props: unknown, input: unknown) => Promise<unknown>
}

/** RPC and WebSocket surface owned by one tenant/app Durable Object. */
export interface ComposeDurableObject {
  /** Call only as an RPC into the object: dispatch a re-entered loopback call. */
  composeStubCall: (props: unknown, input: unknown) => Promise<unknown>
  /** Call only as an RPC into the object: apply a host schedule operation. */
  composeSchedule: (operation: unknown) => Promise<void>
  /** Call only from inside the object: forward its platform alarm. */
  alarm: () => Promise<void>
  snapshot: (appId?: string) => Promise<ComposeSnapshot>
  edit: (operation: ComposeEdit) => Promise<ComposeSnapshot>
  press: (request: ComposePress) => Promise<unknown>
  callSource: (request: {
    id: string
    handler: string
    input?: unknown
  }) => Promise<unknown>
  dispatch: (request: ComposeDispatch) => Promise<unknown>
  follow: () => Promise<Response>
  browserStatus: () => Promise<Array<BrowserStatusReport>>
  webSocketMessage: (
    socket: WebSocket,
    message: string | ArrayBuffer,
  ) => Promise<void>
  webSocketClose: (
    socket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ) => void
}

/** Constructor returned by {@link createComposeDurableObject}. */
export interface ComposeDurableObjectClass<TEnv> {
  new (ctx: DurableObjectState, env: TEnv): ComposeDurableObject
}

/** What the app supplies when defining its tenant Durable Object class. */
export interface ComposeDurableObjectOptions<TEnv> {
  /** `DurableObject` from `cloudflare:workers`, kept injectable for Node SSR. */
  base: DurableObjectConstructor<TEnv>
  /** Initial durable list, used only when storage has no list yet. */
  initialPluginList:
    | ReadonlyArray<SerializedEntry>
    | ((appId: string) => ReadonlyArray<SerializedEntry>)
  /** Trusted plugin objects named by serialized catalog references. */
  catalog: Readonly<Record<string, AnyPlugin>>
  /** Stub values named by the serialized grant names. */
  grants: Readonly<Record<string, AnyStubGrant>>
  /**
   * Resolve one entry's granted stubs. Defaults to looking each name up in
   * `grants`; an app that narrows a grant per entry — a view's `server` grant
   * typed from its paired server module's exports, say — does it here.
   */
  resolveStubs?: (
    entry: SerializedEntry,
    context: {
      entries: ReadonlyArray<SerializedEntry>
      grants: Readonly<Record<string, AnyStubGrant>>
      checker: SourceChecker | undefined
    },
  ) => Promise<ReadonlyArray<AnyStubGrant>>
  /** Base actions the browser shell may dispatch, keyed by public name. */
  actions?: Readonly<Record<string, AnyAction>>
  /** Mint an RPC stub for the same Durable Object as `ctx`; called per use. */
  self: (input: { ctx: DurableObjectState; env: TEnv }) => DurableObjectStub
  /** The host mounted against this particular Durable Object state. */
  createHost: (input: {
    ctx: DurableObjectState
    env: TEnv
    self: () => DurableObjectStub
  }) => ComposeDurableObjectHost
  checker?: SourceChecker
  hostName?: string
}

const listKey = 'compose:plugin-list'
const generationKey = 'compose:generation'

const cloneEntries = (entries: ReadonlyArray<SerializedEntry>) =>
  entries.map((entry) => ({
    ...entry,
    stubs: [...entry.stubs],
  }))

const publicEntries = (
  entries: ReadonlyArray<SerializedEntry>,
): ComposeSnapshot['pluginList'] =>
  entries.map((entry) => ({
    id: entry.id,
    plugin:
      'catalog' in entry.plugin
        ? { catalog: entry.plugin.catalog }
        : { written: true },
    options: entry.options,
    enabled: entry.enabled,
    stubs: [...entry.stubs],
    ...(entry.host === undefined ? {} : { host: entry.host }),
  }))

const messageOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error)

const serialInstances = (
  instances: Array<InstanceSnapshot>,
): ComposeSnapshot['instances'] =>
  instances.map(({ error, ...instance }) => ({
    ...instance,
    ...(error === undefined ? {} : { error: { message: messageOf(error) } }),
  }))

const hasHandler = (view: ViewNode, handler: string): boolean => {
  if (view.type === 'row' || view.type === 'stack') {
    return view.children.some((child) => hasHandler(child, handler))
  }
  if (view.type === 'button') return view.onPress === handler
  if (view.type === 'input') {
    return view.onChange === handler || view.onSubmit === handler
  }
  return false
}

/**
 * Build the one-client-per-tenant/app Durable Object class. The app supplies
 * its catalog, grants and facet host; this package owns persistence, snapshots,
 * edits, presses and follower WebSockets.
 */
export function createComposeDurableObject<TEnv>(
  options: ComposeDurableObjectOptions<TEnv>,
): ComposeDurableObjectClass<TEnv> {
  const Base = options.base
  const Composed = class ComposeDurableObject extends Base {
    readonly ctx: DurableObjectState
    readonly env: TEnv
    #ready?: Promise<void>
    #client!: Client
    #registry!: SlotRegistry
    #entries: Array<SerializedEntry> = []
    #generation = 0
    #published!: ComposeSnapshot
    #publishing?: Promise<ComposeSnapshot>
    #publishQueued = false
    #reconciling = false
    #hostName = options.hostName ?? 'cloudflare'
    #host!: ComposeDurableObjectHost
    #browserStatus = new Map<WebSocket, BrowserStatusReport>()

    constructor(ctx: DurableObjectState, env: TEnv) {
      super(ctx, env)
      this.ctx = ctx
      this.env = env
    }

    #ensure(appId?: string): Promise<void> {
      this.#ready ??= this.#initialize(appId)
      return this.#ready
    }

    async #initialize(appId?: string): Promise<void> {
      const stored = await this.ctx.storage.get<Array<SerializedEntry>>(listKey)
      if (
        stored === undefined &&
        typeof options.initialPluginList === 'function' &&
        appId === undefined
      ) {
        throw new Error(
          '@tanstack/start-compose: this Durable Object needs its app id on the first snapshot',
        )
      }
      this.#entries =
        stored ??
        cloneEntries(
          typeof options.initialPluginList === 'function'
            ? options.initialPluginList(appId!)
            : options.initialPluginList,
        )
      this.#generation =
        (await this.ctx.storage.get<number>(generationKey)) ?? 0
      await this.ctx.storage.put(listKey, this.#entries)
      const input = { ctx: this.ctx, env: this.env }
      this.#host = options.createHost({
        ...input,
        self: () => options.self(input),
      })
      this.#hostName = options.hostName ?? this.#host.name
      this.#client = createClient({
        checker: options.checker,
        hosts: { [this.#hostName]: this.#host },
        plugins: await this.#materialize(this.#entries),
      })
      await this.#client.settled()
      const registry = this.#client.getContext(slotsKey)
      if (!registry) {
        throw new Error(
          '@tanstack/start-compose: the server client must start slotsPlugin',
        )
      }
      this.#registry = registry
      this.#client.instances.subscribe(() => this.#schedulePublish())
      this.#registry.state.subscribe(() => this.#schedulePublish())
      await this.#publishNow()
    }

    /** Dispatch a loopback call after RPC re-enters this object. */
    async composeStubCall(props: unknown, input: unknown): Promise<unknown> {
      // Not gated on #ready: a facet's setup calls stubs while #initialize is
      // still awaiting that setup, and the two would wait on each other.
      if (!this.#host.stubCall) {
        throw new Error(
          '@tanstack/start-compose: this host does not re-enter loopback calls',
        )
      }
      return await this.#host.stubCall(props, input)
    }

    /** Apply a schedule operation after RPC re-enters this object. */
    async composeSchedule(operation: unknown): Promise<void> {
      // Setup can schedule while #initialize is awaiting that facet's setup;
      // waiting on #ready here would make the two RPCs wait on each other.
      await this.#host.schedule(operation)
    }

    /** Forward the tenant's one platform alarm to its host. */
    async alarm(): Promise<void> {
      await this.#ensure()
      await this.#host.alarm()
    }

    #catalogStubs(entry: SerializedEntry): Array<AnyStubGrant> {
      return entry.stubs.map((name) => {
        const grant = options.grants[name]
        if (!grant) {
          throw new Error(
            `@tanstack/start-compose: the grant catalog has no "${name}"`,
          )
        }
        return grant
      })
    }

    async #materialize(
      entries: ReadonlyArray<SerializedEntry>,
    ): Promise<Array<PluginEntry>> {
      const context = {
        entries,
        grants: options.grants,
        checker: options.checker,
      }
      return await Promise.all(
        entries.map(async (entry): Promise<PluginEntry> => {
          const common = {
            id: entry.id,
            options: entry.options,
            enabled: entry.enabled,
          }
          if ('catalog' in entry.plugin) {
            const plugin = options.catalog[entry.plugin.catalog]
            if (!plugin) {
              throw new Error(
                `@tanstack/start-compose: the plugin catalog has no "${entry.plugin.catalog}"`,
              )
            }
            return { ...common, plugin }
          }
          const stubs = options.resolveStubs
            ? await options.resolveStubs(entry, context)
            : this.#catalogStubs(entry)
          return {
            ...common,
            source: entry.plugin.source,
            host: entry.host ?? this.#hostName,
            stubs,
          }
        }),
      )
    }

    #snapshot(): ComposeSnapshot {
      return {
        generation: this.#generation,
        pluginList: publicEntries(this.#entries),
        instances: serialInstances(this.#client.inspect()),
        fills: serializeFills(this.#registry),
      }
    }

    #schedulePublish(): void {
      this.#publishQueued = true
      if (this.#publishing || this.#reconciling) return
      this.#publishing = Promise.resolve()
        .then(async () => {
          let latest = this.#published
          while (this.#publishQueued && !this.#reconciling) {
            this.#publishQueued = false
            latest = await this.#publishNow()
          }
          return latest
        })
        .finally(() => {
          this.#publishing = undefined
          if (this.#publishQueued && !this.#reconciling) {
            this.#schedulePublish()
          }
        })
      this.ctx.waitUntil(this.#publishing)
    }

    async #publishNow(): Promise<ComposeSnapshot> {
      this.#generation += 1
      await this.ctx.storage.put(generationKey, this.#generation)
      this.#published = this.#snapshot()
      const message = JSON.stringify(this.#published)
      for (const socket of this.ctx.getWebSockets()) socket.send(message)
      return this.#published
    }

    /** The current full tenant/app snapshot. */
    async snapshot(appId?: string): Promise<ComposeSnapshot> {
      await this.#ensure(appId)
      return this.#published
    }

    /** Persist and reconcile one serializable plugin-list edit. */
    async edit(operation: ComposeEdit): Promise<ComposeSnapshot> {
      await this.#ensure()
      switch (operation.type) {
        case 'add':
        case 'write':
          this.#entries = [
            ...this.#entries.filter((entry) => entry.id !== operation.entry.id),
            operation.entry,
          ]
          break
        case 'replace':
          this.#entries = cloneEntries(operation.entries)
          break
        case 'enable':
          this.#entries = this.#entries.map((entry) =>
            entry.id === operation.id
              ? { ...entry, enabled: operation.enabled }
              : entry,
          )
          break
        case 'configure':
          this.#entries = this.#entries.map((entry) =>
            entry.id === operation.id
              ? { ...entry, options: operation.options }
              : entry,
          )
          break
        case 'remove':
          this.#entries = this.#entries.filter(
            (entry) => entry.id !== operation.id,
          )
          break
      }
      await this.ctx.storage.put(listKey, this.#entries)
      this.#reconciling = true
      try {
        await this.#client.setPluginList(await this.#materialize(this.#entries))
      } finally {
        this.#reconciling = false
      }
      this.#schedulePublish()
      return await this.#publishing!
    }

    /** Call only a handler named by a fill owned by this view instance. */
    async press(request: ComposePress): Promise<unknown> {
      await this.#ensure()
      const fill = this.#published.fills.find(
        (one) =>
          one.instanceId === request.viewInstanceId &&
          hasHandler(one.view, request.handler),
      )
      if (!fill) {
        throw new Error(
          '@tanstack/start-compose: that view instance does not own this handler',
        )
      }
      return await this.callSource({
        id: request.viewInstanceId,
        handler: request.handler,
        input: request.input,
      })
    }

    /** Operator-only call seam used by diagnostics such as the hostile page. */
    async callSource(request: {
      id: string
      handler: string
      input?: unknown
    }): Promise<unknown> {
      await this.#ensure()
      try {
        const result = await this.#client.callSource(
          request.id,
          request.handler,
          request.input,
        )
        await Promise.resolve()
        if (this.#publishing) await this.#publishing
        return result
      } catch (error) {
        const source = sourceErrorOf(error)
        if (!source) throw error
        throw new Error(source.message, { cause: error })
      }
    }

    /** Dispatch one explicitly catalogued base action on the server client. */
    async dispatch(request: ComposeDispatch): Promise<unknown> {
      await this.#ensure()
      const action = options.actions?.[request.action]
      if (!action) {
        throw new Error(
          `@tanstack/start-compose: the action catalog has no "${request.action}"`,
        )
      }
      return await this.#client.dispatch(action, request.input)
    }

    /** Upgrade to a follower socket and immediately send the whole snapshot. */
    async follow(): Promise<Response> {
      await this.#ensure()
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]
      this.ctx.acceptWebSocket(server)
      server.send(JSON.stringify(this.#published))
      return new Response(null, { status: 101, webSocket: client })
    }

    /** Current, connection-scoped render reports from browser followers. */
    async browserStatus(): Promise<Array<BrowserStatusReport>> {
      await this.#ensure()
      const reports = new Map(this.#browserStatus)
      for (const socket of this.ctx.getWebSockets()) {
        const attached: unknown = socket.deserializeAttachment()
        if (attached) reports.set(socket, attached as BrowserStatusReport)
      }
      return [...reports.values()]
    }

    async webSocketMessage(
      socket: WebSocket,
      message: string | ArrayBuffer,
    ): Promise<void> {
      await this.#ensure()
      const text =
        typeof message === 'string'
          ? message
          : new TextDecoder().decode(message)
      let report: unknown
      try {
        report = JSON.parse(text)
      } catch {
        return
      }
      if (
        typeof report !== 'object' ||
        report === null ||
        !('generation' in report) ||
        typeof report.generation !== 'number' ||
        report.generation !== this.#published.generation ||
        !('entries' in report) ||
        !Array.isArray(report.entries) ||
        report.entries.some(
          (entry) =>
            typeof entry !== 'object' ||
            entry === null ||
            !('id' in entry) ||
            typeof entry.id !== 'string' ||
            !this.#published.fills.some(
              (fill) => fill.instanceId === entry.id,
            ) ||
            !('status' in entry) ||
            (entry.status !== 'active' && entry.status !== 'error'),
        )
      ) {
        return
      }
      const accepted = report as BrowserStatusReport
      socket.serializeAttachment(accepted)
      this.#browserStatus.set(socket, accepted)
    }

    webSocketClose(
      socket: WebSocket,
      code: number,
      reason: string,
      _wasClean: boolean,
    ): void {
      this.#browserStatus.delete(socket)
      socket.close(code, reason)
    }
  }
  return Composed
}
