import { createClient, reconcileAction, sourceErrorOf } from '@tanstack/compose'
import {
  resolvePluginList,
  serializePluginList,
} from '@tanstack/compose/catalog'
import {
  appendGeneration,
  lastKnownGood,
  recordOutcome,
  revertTo,
} from '@tanstack/compose/generations'
import { slotsKey } from '@tanstack/react-compose'
import { serializeFills } from './snapshot'
import type {
  AnyAction,
  AnyPlugin,
  AnyStubGrant,
  Cleanup,
  Client,
  Host,
  InstanceSnapshot,
  PluginEntry,
  SourceChecker,
} from '@tanstack/compose'
import type { Generation } from '@tanstack/compose/generations'
import type { SlotRegistry, ViewNode } from '@tanstack/react-compose'
import type {
  BrowserStatusReport,
  ComposeDispatch,
  ComposeEdit,
  ComposePress,
  ComposeSnapshot,
  ComposeValue,
  SerializedEntry,
} from './snapshot'

interface DurableObjectConstructor<TEnv> {
  new (ctx: DurableObjectState, env: TEnv): object
}

/** What a re-entered loopback call names: the host, the instance, the stub. */
export interface StubCallProps {
  hostId: string
  instanceId: string
  stub: string
}

const isStubCallProps = (value: unknown): value is StubCallProps =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as StubCallProps).hostId === 'string' &&
  typeof (value as StubCallProps).instanceId === 'string' &&
  typeof (value as StubCallProps).stub === 'string'

interface ComposeDurableObjectHost extends Host {
  alarm: () => Promise<void>
  schedule: (operation: unknown) => Promise<void>
  stubCall?: (props: StubCallProps, input: unknown) => Promise<unknown>
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
  /** Return the persisted append-only generation log. */
  generations: () => Promise<Array<Generation<SerializedEntry>>>
  /** Append and settle a copy of an earlier generation's entries. */
  revert: (n: number) => Promise<ComposeSnapshot>
  /** Rebuild the in-memory client while retaining its generation log. */
  reset: (appId?: string) => Promise<ComposeSnapshot>
  press: (request: ComposePress) => Promise<unknown>
  callSource: (request: {
    id: string
    handler: string
    input?: unknown
  }) => Promise<unknown>
  dispatch: (request: ComposeDispatch) => Promise<unknown>
  /**
   * Accept a follower WebSocket upgrade. Connect with `stub.fetch(request)`:
   * a 101 response carrying a socket cannot cross the RPC boundary.
   */
  fetch: (request: Request) => Promise<Response>
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
  catalog:
    | Readonly<Record<string, AnyPlugin>>
    | ((input: {
        ctx: DurableObjectState
        env: TEnv
      }) => Readonly<Record<string, AnyPlugin>>)
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
      baseVersion: string
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
  /** Current generated declaration hash, fixed or selected from the boot id. */
  baseVersion: string | ((appId?: string) => string)
  checker?: SourceChecker
  /** Select a checker carrying the declarations for a dynamic base version. */
  createChecker?: (baseVersion: string) => SourceChecker
  hostName?: string
  /** Optional application state added to each whole follower snapshot. */
  snapshotState?: (client: Client) => ComposeValue | undefined
  /** Subscribe application stores that should trigger a follower snapshot. */
  subscribeSnapshot?: (client: Client, publish: () => void) => Cleanup
}

const generationsKey = 'compose:generations'

const cloneEntries = (entries: ReadonlyArray<SerializedEntry>) =>
  entries.map((entry) => ({
    ...entry,
    stubs: [...entry.stubs],
  }))

const cloneGenerations = (
  log: ReadonlyArray<Generation<SerializedEntry>>,
): Array<Generation<SerializedEntry>> =>
  log.map((generation) => ({
    ...generation,
    entries: cloneEntries(generation.entries),
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
    #checker: SourceChecker | undefined
    #registry!: SlotRegistry
    #entries: Array<SerializedEntry> = []
    #log: Array<Generation<SerializedEntry>> = []
    #baseVersion = ''
    #published!: ComposeSnapshot
    #publishing?: Promise<ComposeSnapshot>
    #internalSettlement: Promise<void> = Promise.resolve()
    #publishQueued = false
    #reconciling = false
    #publicReconcile = false
    #hostName = options.hostName ?? 'cloudflare'
    #host!: ComposeDurableObjectHost
    #catalog!: Readonly<Record<string, AnyPlugin>>
    #browserStatus = new Map<WebSocket, BrowserStatusReport>()
    #externalCleanups: Array<Cleanup> = []

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
      const stored =
        await this.ctx.storage.get<Array<Generation<SerializedEntry>>>(
          generationsKey,
        )
      if (
        stored === undefined &&
        typeof options.initialPluginList === 'function' &&
        appId === undefined
      ) {
        throw new Error(
          '@tanstack/start-compose: this Durable Object needs its app id on the first snapshot',
        )
      }
      this.#baseVersion =
        typeof options.baseVersion === 'function'
          ? appId === undefined && stored?.at(-1)
            ? stored.at(-1)!.baseVersion
            : options.baseVersion(appId)
          : options.baseVersion
      this.#checker =
        options.createChecker?.(this.#baseVersion) ?? options.checker
      this.#log = stored ? cloneGenerations(stored) : []
      if (this.#log.length === 0) {
        this.#log = appendGeneration(this.#log, {
          baseVersion: this.#baseVersion,
          entries: cloneEntries(
            typeof options.initialPluginList === 'function'
              ? options.initialPluginList(appId!)
              : options.initialPluginList,
          ),
        })
      } else if (this.#log.at(-1)!.baseVersion !== this.#baseVersion) {
        this.#log = appendGeneration(this.#log, {
          baseVersion: this.#baseVersion,
          entries: this.#log.at(-1)!.entries,
        })
      }
      this.#entries = cloneEntries(this.#log.at(-1)!.entries)
      await this.#persistLog()
      const input = { ctx: this.ctx, env: this.env }
      this.#catalog =
        typeof options.catalog === 'function'
          ? options.catalog(input)
          : options.catalog
      this.#host = options.createHost({
        ...input,
        self: () => options.self(input),
      })
      this.#hostName = options.hostName ?? this.#host.name
      this.#client = createClient({
        baseVersion: this.#baseVersion,
        checker: this.#checker,
        hosts: { [this.#hostName]: this.#host },
        plugins: await this.#materialize(this.#entries),
      })
      await this.#client.settled()
      await this.#recordHead()
      this.#externalCleanups.push(
        this.#client.use(
          reconcileAction,
          async ({ input: next, next: run }) => {
            if (this.#publicReconcile) return await run(next)
            this.#entries = serializePluginList(next, {
              plugins: this.#catalog,
              stubs: options.grants,
            })
            this.#log = appendGeneration(this.#log, {
              entries: this.#entries,
              baseVersion: this.#baseVersion,
            })
            const generation = this.#log.at(-1)!.n
            await this.#persistLog()
            this.#reconciling = true
            try {
              await run(next)
            } finally {
              const settlement = this.#internalSettlement.then(async () => {
                try {
                  // `instances` is published by the client after reconcile
                  // middleware returns, so outcome recording must wait for the
                  // enclosing pass rather than only `run(next)`.
                  await this.#client.settled()
                  await this.#recordGeneration(generation)
                } finally {
                  this.#reconciling = false
                  this.#schedulePublish()
                  if (this.#publishing) await this.#publishing
                }
              })
              this.#internalSettlement = settlement
              this.ctx.waitUntil(settlement)
            }
          },
        ),
      )
      const registry = this.#client.getContext(slotsKey)
      if (!registry) {
        throw new Error(
          '@tanstack/start-compose: the server client must start slotsPlugin',
        )
      }
      this.#registry = registry
      this.#client.instances.subscribe(() => this.#schedulePublish())
      this.#registry.state.subscribe(() => this.#schedulePublish())
      this.#publishNow()
      if (options.subscribeSnapshot) {
        this.#externalCleanups.push(
          options.subscribeSnapshot(this.#client, () =>
            this.#schedulePublish(),
          ),
        )
      }
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
      if (!isStubCallProps(props)) {
        throw new Error('@tanstack/start-compose: malformed stub call props')
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
        checker: this.#checker,
        baseVersion: this.#baseVersion,
      }
      return await Promise.all(
        entries.map(async (entry): Promise<PluginEntry> => {
          const common = {
            id: entry.id,
            options: entry.options,
            enabled: entry.enabled,
          }
          if ('catalog' in entry.plugin) {
            return resolvePluginList([entry], {
              plugins: this.#catalog,
              stubs: options.grants,
            })[0]!
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
      const head = this.#log.at(-1)!
      const knownGood = lastKnownGood(this.#log)
      return {
        generation: head.n,
        baseVersion: head.baseVersion,
        outcome: head.outcome,
        ...(knownGood === undefined ? {} : { lastKnownGood: knownGood.n }),
        pluginList: publicEntries(this.#entries),
        instances: serialInstances(this.#client.inspect()),
        fills: serializeFills(this.#registry),
        ...(options.snapshotState === undefined
          ? {}
          : { state: options.snapshotState(this.#client) }),
      }
    }

    #schedulePublish(): void {
      this.#publishQueued = true
      if (this.#publishing || this.#reconciling) return
      this.#publishing = Promise.resolve()
        .then(() => {
          let latest = this.#published
          while (this.#publishQueued && !this.#reconciling) {
            this.#publishQueued = false
            latest = this.#publishNow()
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

    #publishNow(): ComposeSnapshot {
      this.#published = this.#snapshot()
      const message = JSON.stringify(this.#published)
      for (const socket of this.ctx.getWebSockets()) socket.send(message)
      return this.#published
    }

    /** The current full tenant/app snapshot. */
    async snapshot(appId?: string): Promise<ComposeSnapshot> {
      await this.#ensure(appId)
      await this.#internalSettlement
      return this.#published
    }

    /** Persist and reconcile one serializable plugin-list edit. */
    async edit(operation: ComposeEdit): Promise<ComposeSnapshot> {
      await this.#ensure()
      await this.#internalSettlement
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
      this.#log = appendGeneration(this.#log, {
        entries: this.#entries,
        baseVersion: this.#baseVersion,
      })
      await this.#persistLog()
      this.#reconciling = true
      this.#publicReconcile = true
      try {
        await this.#client.setPluginList(await this.#materialize(this.#entries))
      } finally {
        this.#publicReconcile = false
        this.#reconciling = false
        await this.#recordHead()
      }
      this.#schedulePublish()
      return await this.#publishing!
    }

    async #persistLog(): Promise<void> {
      await this.ctx.storage.put(generationsKey, this.#log)
    }

    async #recordHead(): Promise<void> {
      const head = this.#log.at(-1)
      if (!head || head.outcome !== 'pending') return
      await this.#recordGeneration(head.n)
    }

    async #recordGeneration(n: number): Promise<void> {
      this.#log = recordOutcome(this.#log, n, this.#client.inspect())
      await this.#persistLog()
    }

    /** The complete persisted generation history, with no live values. */
    async generations(): Promise<Array<Generation<SerializedEntry>>> {
      await this.#ensure()
      await this.#internalSettlement
      return cloneGenerations(this.#log)
    }

    /** Reconcile an earlier list as a new generation under the current base. */
    async revert(n: number): Promise<ComposeSnapshot> {
      await this.#ensure()
      await this.#internalSettlement
      const next = revertTo(this.#log, n)
      if (next.length === this.#log.length) {
        throw new Error(`@tanstack/start-compose: there is no generation ${n}`)
      }
      this.#log = next
      this.#entries = cloneEntries(this.#log.at(-1)!.entries)
      await this.#persistLog()
      this.#reconciling = true
      this.#publicReconcile = true
      try {
        await this.#client.setPluginList(await this.#materialize(this.#entries))
      } finally {
        this.#publicReconcile = false
        this.#reconciling = false
        await this.#recordHead()
      }
      this.#schedulePublish()
      return await this.#publishing!
    }

    /** Destroy and reconstruct only the in-memory client, retaining history. */
    async reset(appId?: string): Promise<ComposeSnapshot> {
      await this.#ensure(appId)
      await this.#internalSettlement
      this.#reconciling = true
      this.#publicReconcile = true
      try {
        for (const cleanup of this.#externalCleanups.splice(0)) await cleanup()
        await this.#client.destroy()
      } finally {
        this.#publicReconcile = false
        this.#reconciling = false
      }
      this.#ready = undefined
      this.#publishing = undefined
      this.#publishQueued = false
      await this.#ensure(appId)
      return this.#published
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
        await this.#internalSettlement
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
      const result = await this.#client.dispatch(action, request.input)
      await this.#internalSettlement
      return result
    }

    /** Upgrade to a follower socket and immediately send the whole snapshot. */
    async follow(): Promise<Response> {
      await this.#ensure()
      await this.#internalSettlement
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]
      this.ctx.acceptWebSocket(server)
      server.send(JSON.stringify(this.#published))
      return new Response(null, { status: 101, webSocket: client })
    }

    /**
     * The object's HTTP surface: only the follower upgrade. Everything else is
     * an RPC method; a socket-bearing 101 has to be returned from `fetch`.
     */
    async fetch(request: Request): Promise<Response> {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('@tanstack/start-compose: upgrade required', {
          status: 426,
        })
      }
      return await this.follow()
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
