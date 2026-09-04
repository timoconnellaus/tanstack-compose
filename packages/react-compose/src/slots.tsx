import { createContextKey, createPlugin } from '@tanstack/compose'
import { Store } from '@tanstack/store'
import { Fragment, useCallback, useMemo, useSyncExternalStore } from 'react'
import { useContextKey } from './client'
import type { Cleanup, ContextKey } from '@tanstack/compose'
import type { ComponentType, ReactNode } from 'react'

/**
 * How many **fills** a **slot** takes, and how competing ones are settled.
 *
 * - `list` — every fill renders, ordered by `order` then registration.
 * - `single` — one fill renders: the one registered last.
 * - `keyed` — one fill per key, the one registered last for that key; the key
 *   of the fill to render comes from the props the slot passes.
 */
export type SlotCardinality = 'list' | 'single' | 'keyed'

/**
 * A named place in the UI that plugins fill, typed by the props it passes to
 * what fills it. Created like a **context key**, so the props type travels with
 * the value and nothing is declared globally (ADR-0001).
 */
export interface Slot<
  TProps = void,
  TCardinality extends SlotCardinality = SlotCardinality,
> {
  /** Structural tag. Identity checks never use `instanceof`. */
  readonly type: 'compose/slot'
  /** The name a written **view** names this slot by. Unique within a client. */
  readonly name: string
  readonly cardinality: TCardinality
  /** For a `keyed` slot, the key the props carry. Absent otherwise. */
  readonly key?: (props: TProps) => string
  /** Phantom carrier for `TProps`; never populated at runtime. */
  readonly '~props'?: TProps
}

/** Any slot, whatever props it passes and however many fills it takes. */
export type AnySlot = Slot<any, SlotCardinality>

/** The props a slot passes to its fills. */
export type PropsOf<TSlot> =
  TSlot extends Slot<infer TProps, any> ? TProps : never

/**
 * Create a slot. `list` is the default; `single` keeps the latest fill; `keyed`
 * needs a function that reads the key out of the props.
 *
 * @example
 * ```ts
 * const toolbar = createSlot<{ busy: boolean }>('toolbar')
 * const message = createSlot<{ entry: Entry }>('message', {
 *   cardinality: 'keyed',
 *   key: (props) => props.entry.kind,
 * })
 * ```
 */
export function createSlot<TProps = void>(
  name: string,
  options?: { cardinality?: 'list' },
): Slot<TProps, 'list'>
export function createSlot<TProps = void>(
  name: string,
  options: { cardinality: 'single' },
): Slot<TProps, 'single'>
export function createSlot<TProps>(
  name: string,
  options: { cardinality: 'keyed'; key: (props: TProps) => string },
): Slot<TProps, 'keyed'>
export function createSlot(
  name: string,
  options?: {
    cardinality?: SlotCardinality
    key?: (props: any) => string
  },
): AnySlot {
  return {
    type: 'compose/slot',
    name,
    cardinality: options?.cardinality ?? 'list',
    key: options?.key,
  }
}

/**
 * One plugin's contribution to a slot. Everything but `render` is plain data,
 * so the registry is reusable by an adapter for another framework.
 */
export interface Fill<TProps = any> {
  /** Unique within the registry; usable as a React key. */
  readonly id: string
  /** The name of the slot this fills. */
  readonly slot: string
  /** Lower sorts earlier; equal orders keep registration order. */
  readonly order: number
  /** Which key this fill answers to, for a `keyed` slot. */
  readonly key?: string
  /** The component rendered with the slot's props. */
  readonly render: ComponentType<TProps>
  /** Plain data retained when this fill came from a hosted view. */
  readonly serialized?: { instanceId: string; view: unknown }
}

/** What `fill` is given: an optional order, a key for a keyed slot, a renderer. */
export type FillInput<
  TProps,
  TCardinality extends SlotCardinality = SlotCardinality,
> = {
  order?: number
  render: ComponentType<TProps>
} & (TCardinality extends 'keyed' ? { key: string } : { key?: string }) & {
    serialized?: { instanceId: string; view: unknown }
  }

/** The registry's observable state: the fills per slot, and the slots declared. */
export interface SlotsState {
  /** Fills in registration order, per slot name. */
  readonly fills: Readonly<Record<string, ReadonlyArray<Fill>>>
  /** Every slot declared or filled so far, by name. */
  readonly slots: Readonly<Record<string, AnySlot>>
}

/**
 * The **slot** registry: what a plugin fills, and what a renderer reads. Its
 * state is a [`@tanstack/store`](https://tanstack.com/store) store, so a
 * renderer re-renders when a fill arrives or goes without anything restarting
 * (A2, ADR-0002).
 */
export interface SlotRegistry {
  /** Every fill and every declared slot; subscribe to re-render on a change. */
  readonly state: Store<SlotsState>
  /**
   * Declare a slot from the plugin that renders it, so it can be resolved by
   * name — which is how a written **view** names the slot it fills. Filling a
   * slot declares it too.
   */
  declare: (slot: AnySlot) => Cleanup
  /** The slot with this name, or `undefined` if nothing declared or filled it. */
  slot: (name: string) => AnySlot | undefined
  /** Every slot declared or filled right now. */
  slots: () => Array<AnySlot>
  /** Fill a slot. Call the returned cleanup — or let the instance's run — to unfill. */
  fill: <TProps, TCardinality extends SlotCardinality>(
    slot: Slot<TProps, TCardinality>,
    fill: FillInput<TProps, TCardinality>,
  ) => Cleanup
  /** The fills of one slot, settled by its cardinality and in render order. */
  fills: <TProps>(slot: Slot<TProps, any>) => Array<Fill<TProps>>
}

/** Settle a slot's raw registrations into what actually renders. */
export function resolveFills<TProps>(
  slot: Slot<TProps, any>,
  registered: ReadonlyArray<Fill>,
): Array<Fill<TProps>> {
  if (slot.cardinality === 'single') {
    const latest = registered[registered.length - 1]
    return latest ? [latest] : []
  }
  const ordered = [...registered].sort((one, other) => one.order - other.order)
  if (slot.cardinality === 'keyed') {
    const latest = new Map<string, Fill>()
    for (const fill of ordered) latest.set(fill.key ?? '', fill)
    return [...latest.values()]
  }
  return ordered
}

/**
 * Build a registry. Framework-agnostic: it holds components but never renders
 * them, so the same registry serves any adapter.
 */
export function createSlotRegistry(): SlotRegistry {
  const state = new Store<SlotsState>({ fills: {}, slots: {} })
  const held = new Map<string, number>()
  let sequence = 0

  const remember = (slot: AnySlot): void => {
    held.set(slot.name, (held.get(slot.name) ?? 0) + 1)
    if (state.state.slots[slot.name]) return
    state.setState((previous) => ({
      ...previous,
      slots: { ...previous.slots, [slot.name]: slot },
    }))
  }

  const forget = (slot: AnySlot): void => {
    const remaining = (held.get(slot.name) ?? 1) - 1
    if (remaining > 0) {
      held.set(slot.name, remaining)
      return
    }
    held.delete(slot.name)
    state.setState((previous) => {
      const slots = { ...previous.slots }
      delete slots[slot.name]
      return { ...previous, slots }
    })
  }

  return {
    state,
    declare: (slot: AnySlot): Cleanup => {
      remember(slot)
      return () => forget(slot)
    },
    slot: (name: string) => state.state.slots[name],
    slots: () => Object.values(state.state.slots),
    fill: (slot, input): Cleanup => {
      sequence += 1
      const fill: Fill = {
        id: `${slot.name}#${sequence}`,
        slot: slot.name,
        order: input.order ?? 0,
        key: input.key,
        render: input.render as ComponentType<any>,
        serialized: input.serialized,
      }
      remember(slot)
      // Only this slot's array changes identity, so a renderer of another slot
      // reads the same array back and does not re-render (A2).
      state.setState((previous) => ({
        ...previous,
        fills: {
          ...previous.fills,
          [slot.name]: [...(previous.fills[slot.name] ?? []), fill],
        },
      }))
      return () => {
        forget(slot)
        state.setState((previous) => {
          const current = previous.fills[slot.name]
          if (!current?.includes(fill)) return previous
          return {
            ...previous,
            fills: {
              ...previous.fills,
              [slot.name]: current.filter((one) => one !== fill),
            },
          }
        })
      }
    },
    fills: (slot) => resolveFills(slot, state.state.fills[slot.name] ?? []),
  }
}

/** The **context key** the slot registry is published under. */
export const slotsKey: ContextKey<SlotRegistry> =
  createContextKey<SlotRegistry>('ui.slots')

/**
 * Provides {@link slotsKey} for the life of the client (A2). Every plugin that
 * fills or renders a slot depends on this key, so it belongs in the **shell**.
 *
 * @example
 * ```ts
 * createClient({ plugins: [{ id: 'slots', plugin: slotsPlugin }] })
 * ```
 */
export const slotsPlugin = createPlugin({
  name: 'slots',
  provides: [slotsKey],
  setup(instance) {
    instance.provide(slotsKey, createSlotRegistry())
  },
})

// --------------------------------------------------------------- the renderer
//
// Everything above is framework-agnostic: the registry holds components but
// never renders them. Everything below is the React half, and lives here so
// that `Slot` names both the definition and the component that renders it.

const noop = (): void => {}

/**
 * The fills of one slot as they render right now, re-read whenever a plugin
 * fills or unfills it (A2). A slot with no registry above it, or with no fills,
 * gives an empty array rather than an error (A4).
 */
export function useFills<TProps>(slot: Slot<TProps, any>): Array<Fill<TProps>> {
  const registry = useContextKey(slotsKey)
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!registry) return noop
      const subscription = registry.state.subscribe(onChange)
      return () => subscription.unsubscribe()
    },
    [registry],
  )
  const read = useCallback(
    () => registry?.state.state.fills[slot.name],
    [registry, slot],
  )
  const registered = useSyncExternalStore(subscribe, read, read)
  return useMemo(() => resolveFills(slot, registered ?? []), [slot, registered])
}

/** What the {@link Slot} component takes. `props` is what the slot passes on. */
export type SlotComponentProps<TProps> = {
  /** The slot to render. */
  of: Slot<TProps, any>
  /**
   * Wrap each fill. Layout belongs to the plugin that renders the slot, so
   * without this the fills render as bare siblings in order (A3).
   */
  children?: (rendered: ReactNode, fill: Fill<TProps>) => ReactNode
} & (undefined extends TProps ? { props?: TProps } : { props: TProps })

/**
 * Render a **slot**: every **fill** in order for a `list` slot, the latest for a
 * `single` one, and the one matching the props' key for a `keyed` one. A slot no
 * plugin fills renders nothing and is not an error (A4). A fill may itself
 * render a slot (A3).
 *
 * @example
 * ```tsx
 * <Slot of={toolbarSlot} props={{ busy }} />
 *
 * <Slot of={toolbarSlot} props={{ busy }}>
 *   {(rendered, fill) => <li key={fill.id}>{rendered}</li>}
 * </Slot>
 * ```
 */
export function Slot<TProps>(
  properties: SlotComponentProps<TProps>,
): ReactNode {
  const { of: slot, children } = properties
  const props = (properties as { props?: TProps }).props as TProps
  const fills = useFills(slot)
  const keyed = slot.cardinality === 'keyed' ? slot.key?.(props) : undefined
  const shown =
    slot.cardinality === 'keyed'
      ? fills.filter((fill) => fill.key === keyed)
      : fills

  return (
    <>
      {shown.map((fill) => {
        const Render = fill.render
        const rendered = <Render {...(props as any)} />
        return (
          <Fragment key={fill.id}>
            {children ? children(rendered, fill) : rendered}
          </Fragment>
        )
      })}
    </>
  )
}
