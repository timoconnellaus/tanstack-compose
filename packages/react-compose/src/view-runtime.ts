import { createContextKey, createStub, sourceErrorOf } from '@tanstack/compose'
import type {
  AnyStubGrant,
  Cleanup,
  ContextKey,
  SourceExport,
  StubGrant,
} from '@tanstack/compose'

/** How prominent a view element is. The page decides what each tone looks like. */
export type ViewTone = 'default' | 'muted' | 'primary' | 'danger'

/**
 * What a **view** puts in a **slot**, as a tree of plain data. Handler fields
 * name exports of the view module, so no function crosses a host boundary.
 */
export type ViewNode =
  | { type: 'text'; text: string; tone?: ViewTone }
  | { type: 'pre'; text: string; testId?: string; tone?: ViewTone }
  | {
      type: 'button'
      label: string
      /** The name of the view module export to call when pressed. */
      onPress?: string
      /** Download a text result returned by `onPress` under this filename. */
      download?: string
      /** The data URL media type used with {@link download}. */
      mediaType?: string
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

/** What a view passes to the `slots` stub to register one fill. */
export interface ViewFill {
  /** The slot to fill. Only names allowed by the grant are accepted. */
  slot: string
  /** Lower sorts earlier within the slot. Defaults to `0`. */
  order?: number
  /** Which fill this is, for a keyed slot and for replacement. */
  key?: string
  /** The tree to render. */
  view: ViewNode
}

/** What a view passes to the `server` stub to call its plugin's server half. */
export interface ViewServerCall {
  /** The name of a named export of the plugin's server half. */
  handler: string
  /** What to pass it; structured-clone-safe. */
  input?: unknown
}

/** A slot as the view runtime resolves it, opaque to the grant handler. */
export interface ViewSlot {
  readonly name: string
  readonly cardinality?: 'list' | 'single' | 'keyed'
}

/**
 * The framework-neutral part of a browser client's slot registry a view uses.
 * A framework adapter supplies the concrete renderer held in `render`.
 */
export interface ViewSlotRegistry {
  /** Resolve a slot by name, or `undefined` when the page has no such slot. */
  slot: (name: string) => ViewSlot | undefined
  /** Register one fill; the returned cleanup removes it. */
  fill: (
    slot: ViewSlot,
    fill: {
      order?: number
      key?: string
      render: unknown
      serialized?: { instanceId: string; view: ViewNode }
    },
  ) => Cleanup
}

/** One handler of a view module, already bound to the module's export. */
export type ViewCallback = (input?: unknown) => Promise<unknown>

/** Turns a declarative view tree into the renderer held by a fill. */
export type ViewRenderer = (
  view: ViewNode,
  callbacks: Readonly<Record<string, ViewCallback>>,
) => unknown

/** The slot registry of the browser client a written view fills. */
export const slotRegistryKey: ContextKey<ViewSlotRegistry> =
  createContextKey<ViewSlotRegistry>('ui.viewSlots')

/** The renderer that turns a written view's tree into a fill renderer. */
export const viewRendererKey: ContextKey<ViewRenderer> =
  createContextKey<ViewRenderer>('ui.viewRenderer')

/** What a view entry's id ends with; its server half is the id without it. */
export const viewSuffix = '.view'

/** The entry id of the view belonging to the plugin entry `id`. */
export const viewIdOf = (id: string): string => `${id}${viewSuffix}`

/** The entry id of the server half a view belongs to, if `id` is a view id. */
export const pluginIdOf = (id: string): string | undefined =>
  id.endsWith(viewSuffix) ? id.slice(0, -viewSuffix.length) : undefined

const toneDeclaration = `
/** How prominent an element is; the page decides what each tone looks like. */
type ViewTone = 'default' | 'muted' | 'primary' | 'danger'

/** A tree of plain data naming this module's exports where callbacks go. */
type ViewNode =
  | { type: 'text'; text: string; tone?: ViewTone }
  | { type: 'pre'; text: string; testId?: string; tone?: ViewTone }
  | {
      type: 'button'
      label: string
      onPress?: string
      /** Download a text result returned by onPress under this filename. */
      download?: string
      /** The data URL media type; defaults to text/plain. */
      mediaType?: string
      disabled?: boolean
      tone?: ViewTone
    }
  | {
      type: 'input'
      name: string
      placeholder?: string
      value?: string
      onChange?: string
      onSubmit?: string
    }
  | { type: 'row'; children: Array<ViewNode> }
  | { type: 'stack'; children: Array<ViewNode> }
`.trim()

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

/** Fill a slot of the page. The fill is owned by this instance. */
declare const slots: (fill: {
  slot: GrantedSlot
  order?: number
  key?: string
  view: ViewNode
}) => Promise<void>
`.trim()

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

const serverDeclaration = (
  exported: ReadonlyArray<SourceExport> | undefined,
): string =>
  exported === undefined
    ? `
/** Call a named export of this view's own server half. */
declare const server: (call: {
  handler: string
  input?: unknown
}) => Promise<unknown>
`.trim()
    : `
/** The named exports of this view's server half. */
interface ServerHandlers {
${exported.map(handlerMember).join('')}}

/** Call a named export of this view's own server half. */
declare const server: <TName extends keyof ServerHandlers>(call: {
  handler: TName
  input?: Parameters<ServerHandlers[TName]>[0]
}) => Promise<Awaited<ReturnType<ServerHandlers[TName]>>>
`.trim()

const expectString = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || value === '') {
    throw new Error(
      `@tanstack/react-compose: ${what} must be a non-empty string`,
    )
  }
  return value
}

const nodeTypes = ['text', 'pre', 'button', 'input', 'row', 'stack']

const expectNode = (value: unknown, where: string): ViewNode => {
  const node = value as { type?: unknown; children?: unknown } | null
  if (typeof node?.type !== 'string' || !nodeTypes.includes(node.type)) {
    throw new Error(
      `@tanstack/react-compose: ${where} is not a view element; its "type" must be one of ${nodeTypes.join(', ')}`,
    )
  }
  if (node.type === 'row' || node.type === 'stack') {
    if (!Array.isArray(node.children)) {
      throw new Error(
        `@tanstack/react-compose: a "${node.type}" element must have "children"`,
      )
    }
    node.children.forEach((child, index) =>
      expectNode(child, `${where} child ${index}`),
    )
  }
  return value as ViewNode
}

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

interface FillHolder {
  remove: Cleanup
}

/** The restrictions applied when grants are paired with one written view. */
export interface ViewGrantConfig {
  /** Slot names this view may fill. `undefined` allows every declared slot. */
  slots?: ReadonlyArray<string>
  /** Named exports of the view's server half, when recoverable. */
  exports?: ReadonlyArray<SourceExport>
}

const narrowers = new WeakMap<
  AnyStubGrant,
  (config: ViewGrantConfig) => AnyStubGrant
>()

/** Create the grant that lets a view fill only the named slots. */
export function createSlotsStub(
  config: { slots?: ReadonlyArray<string> } = {},
): StubGrant<ViewFill, void> {
  const allowed = config.slots
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
          `@tanstack/react-compose: this view was not granted the slot "${name}"; it may fill ${allowed.join(', ') || 'no slot'}`,
        )
      }
      const view = expectNode(given?.view, `the view of the fill of "${name}"`)
      const registry = instance.context.get(slotRegistryKey)
      // An explicit allow-list is also enough for a headless server client to
      // declare its list slots. In a browser, the mounted page's declaration
      // wins and carries any non-default cardinality or key function.
      const slot =
        registry.slot(name) ??
        (allowed === undefined ? undefined : { name, cardinality: 'list' })
      if (!slot) {
        throw new Error(
          `@tanstack/react-compose: there is no slot named "${name}" on this page`,
        )
      }

      const callbacks: Record<string, ViewCallback> = {}
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
        serialized: { instanceId, view },
      })
      if (held) {
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

/** Create the grant that lets a view call its paired server half. */
export function createServerStub(
  config: { exports?: ReadonlyArray<SourceExport> } = {},
): StubGrant<ViewServerCall, unknown> {
  const grant = createStub<ViewServerCall, unknown>({
    name: 'server',
    declarations: serverDeclaration(config.exports),
    handler: async ({ input, instance, instanceId }) => {
      const given = input as Partial<ViewServerCall> | null | undefined
      const handler = expectString(given?.handler, 'a server handler name')
      const plugin = pluginIdOf(instanceId)
      if (plugin === undefined) {
        throw new Error(
          `@tanstack/react-compose: the instance "${instanceId}" is not a view, so it has no server half to call`,
        )
      }
      try {
        return await instance.client.callSource(plugin, handler, given?.input)
      } catch (error) {
        const source = sourceErrorOf(error)
        if (!source) throw error
        throw new Error(source.message, { cause: error })
      }
    },
  })
  narrowers.set(grant, (one) => createServerStub({ exports: one.exports }))
  return grant
}

/** The unrestricted `slots` view grant; narrow it with {@link grantView}. */
export const slotsStub: StubGrant<ViewFill, void> = createSlotsStub()

/** The `server` view grant without recovered exports. */
export const serverStub: StubGrant<ViewServerCall, unknown> = createServerStub()

/** The framework-neutral grants a written view needs. */
export const viewStubs: ReadonlyArray<AnyStubGrant> = [slotsStub, serverStub]

/** Narrow view grants to its allowed slots and paired server exports. */
export function grantView(
  grants: ReadonlyArray<AnyStubGrant>,
  config: ViewGrantConfig,
): Array<AnyStubGrant> {
  return grants.map((grant) => narrowers.get(grant)?.(config) ?? grant)
}
