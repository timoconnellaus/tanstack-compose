import { createContextKey, createStub } from '@tanstack/compose'
import { agentKey, sessionKey } from './keys'
import type {
  AnyStubGrant,
  Cleanup,
  ContextKey,
  SourceExport,
  StubGrant,
} from '@tanstack/compose'
import type { AgentStatus } from './types'

// -------------------------------------------------------------- the vocabulary

/** How prominent an element is. The page decides what each tone looks like. */
export type ViewTone = 'default' | 'muted' | 'primary' | 'danger'

/**
 * What a **view** puts in a **slot**, as plain data: a small tree of elements
 * with the names of this module's handlers where a callback would be. Nothing
 * here is a function, so the same tree crosses every **host** boundary.
 */
export type ViewNode =
  | { type: 'text'; text: string; tone?: ViewTone }
  | {
      type: 'button'
      label: string
      /** The name of an export of the view module to call when it is pressed. */
      onPress?: string
      disabled?: boolean
      tone?: ViewTone
    }
  | {
      type: 'input'
      name: string
      placeholder?: string
      value?: string
      /** Called with `{ name, value }` as the text changes. */
      onChange?: string
      /** Called with `{ name, value }` when the text is submitted. */
      onSubmit?: string
    }
  | { type: 'row'; children: Array<ViewNode> }
  | { type: 'stack'; children: Array<ViewNode> }

/** What a view passes to the `slots` **stub** to register one **fill**. */
export interface ViewFill {
  /** The slot to fill. Only the names the grant allows are accepted. */
  slot: string
  /** Lower sorts earlier within the slot. Defaults to `0`. */
  order?: number
  /** Which fill this is, for a keyed slot and for replacing it later. */
  key?: string
  /** What to render. */
  view: ViewNode
}

/** What a view passes to the `server` stub to call its plugin's server half. */
export interface ViewServerCall {
  /** The name of a named export of the plugin's server half. */
  handler: string
  /** What to pass it; structured-clone-safe. */
  input?: unknown
}

/** What the `session` stub reads back: one entry, flattened to plain data. */
export interface ViewSessionEntry {
  id: string
  kind: string
  /** The text of an entry that has text: input, chunk, assistant, error. */
  text?: string
}

// ------------------------------------------------------------------ the page

/**
 * A **slot** as the **slot registry** resolves it. It is opaque here: this
 * package never renders anything, it only hands the registry a fill.
 */
export interface Slot {
  readonly name: string
  readonly cardinality?: 'list' | 'single' | 'keyed'
}

/**
 * The part of the browser client's **slot registry** a **view** reaches. It is
 * declared structurally rather than imported, so this package holds no
 * framework dependency: `@tanstack/react-compose`'s registry satisfies it.
 */
export interface SlotRegistry {
  /** Resolve a slot by name, or `undefined` when the page has no such slot. */
  slot: (name: string) => Slot | undefined
  /** Register one fill; the returned cleanup removes it. */
  fill: (
    slot: Slot,
    fill: { order?: number; key?: string; render: unknown },
  ) => Cleanup
}

/**
 * Turns a view's declarative tree into whatever the page renders — a React
 * element, in the browser. This is the seam that keeps React out of this
 * package: the operator provides the renderer, so nothing here imports a
 * framework and a test provides a fake.
 *
 * `callbacks` holds one entry per handler name the tree names, already bound to
 * the view module's export of that name.
 */
export type ViewRenderer = (
  view: ViewNode,
  callbacks: Readonly<Record<string, (input?: unknown) => Promise<unknown>>>,
) => unknown

/**
 * The **slot registry** of the browser client this view fills. The **shell**
 * provides it; in a React page that is `@tanstack/react-compose`'s registry,
 * provided under this key as well.
 */
export const slotRegistryKey: ContextKey<SlotRegistry> =
  createContextKey<SlotRegistry>('agent.slots')

/**
 * The **renderer** a **view**'s declarative tree is turned into a **fill**'s
 * renderer by. Provided by the page, so this package never sees a framework.
 */
export const viewRendererKey: ContextKey<ViewRenderer> =
  createContextKey<ViewRenderer>('agent.viewRenderer')

// ------------------------------------------------------------------ identity

/** What a view entry's id ends with; its plugin is the id without it. */
export const viewSuffix = '.view'

/** The entry id of the **view** belonging to the plugin entry `id`. */
export const viewIdOf = (id: string): string => `${id}${viewSuffix}`

/** The entry id of the plugin a view entry belongs to, if it is one. */
export const pluginIdOf = (id: string): string | undefined =>
  id.endsWith(viewSuffix) ? id.slice(0, -viewSuffix.length) : undefined

// -------------------------------------------------------------- declarations

const toneDeclaration = `
/** How prominent an element is; the page decides what each tone looks like. */
type ViewTone = 'default' | 'muted' | 'primary' | 'danger'

/**
 * What a view puts in a slot: a tree of plain data. Where a callback would go
 * there is the *name* of one of this module's exports — \`onPress: 'refresh'\`
 * calls \`export function refresh(...)\` below — because a function cannot
 * cross into the page.
 */
type ViewNode =
  | { type: 'text'; text: string; tone?: ViewTone }
  | {
      type: 'button'
      label: string
      /** The name of an export of this module to call when it is pressed. */
      onPress?: string
      disabled?: boolean
      tone?: ViewTone
    }
  | {
      type: 'input'
      name: string
      placeholder?: string
      value?: string
      /** Called with \`{ name, value }\` as the text changes. */
      onChange?: string
      /** Called with \`{ name, value }\` when the text is submitted. */
      onSubmit?: string
    }
  | { type: 'row'; children: Array<ViewNode> }
  | { type: 'stack'; children: Array<ViewNode> }
`.trim()

/** The union of slot names a view was granted, or `string` when it was all. */
const slotType = (slots: ReadonlyArray<string> | undefined): string =>
  slots === undefined
    ? 'string'
    : slots.length === 0
      ? 'never'
      : slots.map((slot) => JSON.stringify(slot)).join(' | ')

const slotsDeclaration = (slots: ReadonlyArray<string> | undefined): string =>
  `
${toneDeclaration}

/** The slots this view was granted. Filling any other one is refused. */
type GrantedSlot = ${slotType(slots)}

/**
 * Fill a slot of the page. The fill is this instance's: it is gone when the
 * entry is removed or rewritten, and nothing it registered survives. Filling
 * the same slot and \`key\` again replaces the previous fill.
 */
declare const slots: (fill: {
  slot: GrantedSlot
  /** Lower sorts earlier within the slot. Defaults to \`0\`. */
  order?: number
  /** Which fill this is, for a keyed slot and for replacing it later. */
  key?: string
  view: ViewNode
}) => Promise<void>
`.trim()

/** A recovered export as one member of the `ServerHandlers` interface. */
const handlerMember = (one: SourceExport): string => {
  const name = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(one.name)
    ? one.name
    : JSON.stringify(one.name)
  const type =
    one.type !== undefined && one.type.includes('=>')
      ? one.type
      : '(input?: unknown) => unknown'
  return `  ${name}: ${type}\n`
}

/**
 * The `server` stub's text. With the server half's exports recovered it names
 * them one by one, so calling a handler the plugin does not export is a
 * diagnostic (D2); without them — a checker that cannot recover exports — it
 * falls back to the shape every host enforces at run time anyway.
 */
const serverDeclaration = (
  exported: ReadonlyArray<SourceExport> | undefined,
): string =>
  exported === undefined
    ? `
/**
 * Call one of the named exports of this plugin's server half — the module
 * written alongside this view. The call is attributed to this view's instance,
 * so middleware on the client side sees which view made it.
 */
declare const server: (call: {
  handler: string
  input?: unknown
}) => Promise<unknown>
`.trim()
    : `
/** The named exports of this plugin's server half, and what each one takes. */
interface ServerHandlers {
${exported.map(handlerMember).join('')}}

/**
 * Call one of the named exports of this plugin's server half — the module
 * written alongside this view. The call is attributed to this view's instance,
 * so middleware on the client side sees which view made it. Only the handlers
 * above exist; anything else is a type error here rather than a failure on the
 * page.
 */
declare const server: <TName extends keyof ServerHandlers>(call: {
  handler: TName
  input?: Parameters<ServerHandlers[TName]>[0]
}) => Promise<Awaited<ReturnType<ServerHandlers[TName]>>>
`.trim()

const agentDeclaration = `
/**
 * What the agent is doing right now. This is a read at the moment you call it,
 * not a subscription: a fill does not re-render when the status changes, so
 * call it from a handler rather than while building a view.
 */
declare const agent: () => Promise<{ status: 'idle' | 'running' }>
`.trim()

const sessionDeclaration = `
/** One entry of the session, flattened to what a view can show. */
interface SessionEntryRead {
  id: string
  kind: string
  /** The text of an entry that has text: input, chunk, assistant, error. */
  text?: string
}

/**
 * Read the end of the session. Like \`agent\`, this is a read at the moment you
 * call it and not a subscription; call it from a handler.
 */
declare const session: (read?: {
  /** How many entries from the end. Defaults to 10. */
  last?: number
}) => Promise<Array<SessionEntryRead>>
`.trim()

// ---------------------------------------------------------------- the stubs

/** Refuse a payload that is not the shape the declarations promise. */
const expectString = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || value === '') {
    throw new Error(
      `@tanstack/compose-agent: ${what} must be a non-empty string`,
    )
  }
  return value
}

const nodeTypes = ['text', 'button', 'input', 'row', 'stack']

/** Walk a tree, refusing anything the vocabulary does not name. */
const expectNode = (value: unknown, where: string): ViewNode => {
  const node = value as { type?: unknown; children?: unknown } | null
  if (typeof node?.type !== 'string' || !nodeTypes.includes(node.type)) {
    throw new Error(
      `@tanstack/compose-agent: ${where} is not a view element; its "type" must be one of ${nodeTypes.join(', ')}`,
    )
  }
  if (node.type === 'row' || node.type === 'stack') {
    const children = node.children
    if (!Array.isArray(children)) {
      throw new Error(
        `@tanstack/compose-agent: a "${node.type}" element must have "children"`,
      )
    }
    children.forEach((child, index) =>
      expectNode(child, `${where} child ${index}`),
    )
  }
  return value as ViewNode
}

/** Every handler name the tree names, in the order they are written. */
const handlersOf = (node: ViewNode): Array<string> => {
  const found: Array<string> = []
  const visit = (one: ViewNode): void => {
    if (one.type === 'row' || one.type === 'stack') {
      one.children.forEach(visit)
      return
    }
    const named = one as {
      onPress?: string
      onChange?: string
      onSubmit?: string
    }
    for (const name of [named.onPress, named.onChange, named.onSubmit]) {
      if (typeof name === 'string' && name !== '' && !found.includes(name)) {
        found.push(name)
      }
    }
  }
  visit(node)
  return found
}

/** One instance's live fills, so filling the same place again replaces it. */
interface FillHolder {
  remove: Cleanup
}

/** What narrowing a grant for one written plugin needs to know. */
export interface ViewGrantConfig {
  /** The slot names this view may fill. `undefined` allows any name. */
  slots?: ReadonlyArray<string>
  /** The named exports of the view's server half, when they are recoverable. */
  exports?: ReadonlyArray<SourceExport>
}

/**
 * Grants that can be narrowed for one written plugin, and how. A grant this
 * package did not author is not in here and passes through {@link grantView}
 * unchanged.
 */
const narrowers = new WeakMap<
  AnyStubGrant,
  (config: ViewGrantConfig) => AnyStubGrant
>()

/**
 * The **stub** that lets a **view** fill a **slot**. Which slots it may fill is
 * part of the grant: the operator names them, the declarations narrow to them,
 * and a fill of any other slot is refused, so a written view cannot fill a slot
 * it was not given (D1).
 *
 * The declarative tree becomes a renderer through the {@link ViewRenderer} the
 * page provides, which is why nothing here imports a framework.
 *
 * @example
 * ```ts
 * createSlotsStub({ slots: ['chat.input.actions'] })
 * ```
 */
export function createSlotsStub(
  config: { slots?: ReadonlyArray<string> } = {},
): StubGrant<ViewFill, void> {
  const allowed = config.slots
  /** Per instance, per `slot:key`: the fill that is in place right now. */
  const placed = new Map<string, Map<string, FillHolder>>()

  const grant = createStub<ViewFill, void>({
    name: 'slots',
    declarations: slotsDeclaration(allowed),
    deps: [slotRegistryKey, viewRendererKey],
    handler: ({ input, instance, instanceId, call }) => {
      const given = input as Partial<ViewFill> | null | undefined
      const name = expectString(given?.slot, 'a fill slot name')
      if (allowed !== undefined && !allowed.includes(name)) {
        throw new Error(
          `@tanstack/compose-agent: this view was not granted the slot "${name}"; it may fill ${
            allowed.join(', ') || 'no slot'
          }`,
        )
      }
      const view = expectNode(given?.view, `the view of the fill of "${name}"`)
      const registry = instance.context.get(slotRegistryKey)
      const slot = registry.slot(name)
      if (!slot) {
        throw new Error(
          `@tanstack/compose-agent: there is no slot named "${name}" on this page`,
        )
      }

      const callbacks: Record<string, (one?: unknown) => Promise<unknown>> = {}
      for (const handler of handlersOf(view)) {
        callbacks[handler] = (one?: unknown) => call(handler, one)
      }
      const render = instance.context.get(viewRendererKey)(view, callbacks)

      const key = given?.key
      const place = `${name}:${key ?? ''}`
      let mine = placed.get(instanceId)
      if (!mine) {
        mine = new Map<string, FillHolder>()
        placed.set(instanceId, mine)
        instance.cleanup(() => {
          placed.delete(instanceId)
        }, 'fills')
      }
      const held = mine.get(place)
      const remove = registry.fill(slot, {
        ...(given?.order === undefined ? {} : { order: given.order }),
        ...(key === undefined ? {} : { key }),
        render,
      })
      if (held) {
        // Replacing a fill: the old one goes before the new one is the only
        // one, and the instance keeps the one cleanup it already registered.
        const previous = held.remove
        held.remove = remove
        void previous()
        return
      }
      const holder: FillHolder = { remove }
      mine.set(place, holder)
      instance.cleanup(() => holder.remove(), `fill(${place})`)
    },
  })
  narrowers.set(grant, (one) => createSlotsStub({ slots: one.slots }))
  return grant
}

/**
 * The **stub** that lets a **view** call the named exports of its own plugin's
 * server half — the entry it was written beside. The call carries the view's
 * own instance id, attached by the host where the view's code cannot forge it,
 * so middleware on the client side sees which view made it (A6).
 */
export function createServerStub(
  config: { exports?: ReadonlyArray<SourceExport> } = {},
): StubGrant<ViewServerCall, unknown> {
  const grant = createStub<ViewServerCall, unknown>({
    name: 'server',
    declarations: serverDeclaration(config.exports),
    handler: ({ input, instance, instanceId }) => {
      const given = input as Partial<ViewServerCall> | null | undefined
      const handler = expectString(given?.handler, 'a server handler name')
      const plugin = pluginIdOf(instanceId)
      if (plugin === undefined) {
        throw new Error(
          `@tanstack/compose-agent: the instance "${instanceId}" is not a view, so it has no server half to call`,
        )
      }
      return instance.client.callSource(plugin, handler, given?.input)
    },
  })
  narrowers.set(grant, (one) => createServerStub({ exports: one.exports }))
  return grant
}

/** The **stub** that lets a **view** read what the **agent** is doing now. */
export const agentStub: StubGrant<void, { status: AgentStatus }> = createStub<
  void,
  { status: AgentStatus }
>({
  name: 'agent',
  declarations: agentDeclaration,
  deps: [agentKey],
  handler: ({ instance }) => ({
    status: instance.context.get(agentKey).status.state,
  }),
})

/** The **stub** that lets a **view** read the end of the **session**. */
export const sessionStub: StubGrant<
  { last?: number } | undefined,
  Array<ViewSessionEntry>
> = createStub<{ last?: number } | undefined, Array<ViewSessionEntry>>({
  name: 'session',
  declarations: sessionDeclaration,
  deps: [sessionKey],
  handler: ({ input, instance }) => {
    const last = (input as { last?: number } | null | undefined)?.last ?? 10
    const entries = instance.context.get(sessionKey).snapshot()
    return entries.slice(Math.max(0, entries.length - last)).map((entry) => {
      const text = (entry as { text?: unknown; message?: unknown }).text
      const message = (entry as { message?: unknown }).message
      const shown = typeof text === 'string' ? text : message
      return {
        id: entry.id,
        kind: entry.kind,
        ...(typeof shown === 'string' ? { text: shown } : {}),
      }
    })
  },
})

/** The `slots` grant with no slot restriction; narrow it with {@link grantView}. */
export const slotsStub: StubGrant<ViewFill, void> = createSlotsStub()

/** The `server` grant with no recovered exports; narrowed per written plugin. */
export const serverStub: StubGrant<ViewServerCall, unknown> = createServerStub()

/**
 * The stubs a **view** is granted: fill slots, call its own plugin's server
 * half, and read the agent's status and the end of the session. The operator
 * decides which of them a written view actually receives, and which slots it
 * may fill.
 *
 * @example
 * ```ts
 * {
 *   id: 'composer',
 *   plugin: composerPlugin,
 *   options: {
 *     stubs: agentStubs,
 *     viewStubs,
 *     viewSlots: ['chat.input.actions'],
 *   },
 * }
 * ```
 */
export const viewStubs: ReadonlyArray<AnyStubGrant> = [
  slotsStub,
  serverStub,
  agentStub,
  sessionStub,
]

/**
 * The grants one written **view** entry receives: the same stubs the operator
 * granted, narrowed to this plugin — the `slots` grant to the slot names the
 * operator allowed, the `server` grant to the named exports of the plugin's own
 * server half. A grant this package did not author passes through unchanged.
 *
 * Narrowing the grant rather than the check is what keeps the entry honest: the
 * declarations the view is checked against travel on the entry, so the client
 * checks the same text again whenever it restarts the view.
 */
export function grantView(
  grants: ReadonlyArray<AnyStubGrant>,
  config: ViewGrantConfig,
): Array<AnyStubGrant> {
  return grants.map((grant) => narrowers.get(grant)?.(config) ?? grant)
}
