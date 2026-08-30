/**
 * `@tanstack/compose` — the framework-agnostic kernel.
 *
 * Scaffold only. Every export below is a typed placeholder; see `INTENT.md` at the
 * repository root for the invariants the real implementation has to satisfy, and
 * `ROADMAP.md` for the order the slices get built in.
 */

/** A disposer returned by an effect. May be async; teardown awaits it. */
export type Cleanup = () => void | Promise<void>

/** The named states an instance moves through. */
export type InstanceState =
  'pending' | 'loading' | 'active' | 'unloading' | 'disposed' | 'failed'

/** Dispatch mode of an event. Part of the event's public contract. */
export type EventMode = 'broadcast' | 'parallel' | 'serial' | 'waterfall'

/**
 * A typed handle on a service key. Consumers name the token, never the provider,
 * which is what makes a provider swappable.
 */
export interface ServiceToken<TValue> {
  readonly key: string
  /** Phantom carrier for `TValue`; never populated at runtime. */
  readonly __value?: TValue
}

/** A typed handle on an event name plus its dispatch mode. */
export interface EventToken<TArgs extends Array<unknown>, TResult> {
  readonly name: string
  readonly mode: EventMode
  /** Phantom carriers; never populated at runtime. */
  readonly __args?: TArgs
  readonly __result?: TResult
}

/** The one object a plugin receives. A scoped view onto the application graph. */
export interface Runtime {
  readonly state: InstanceState
  /** Read a service. Throws if the key is not provided in this scope. */
  get: <TValue>(token: ServiceToken<TValue>) => TValue
  /** Register an undo owned by this instance. */
  effect: (cleanup: Cleanup, label?: string) => void
}

/** A unit of contribution. Composition happens outside it. */
export interface Plugin<TConfig = void> {
  readonly name: string
  readonly requires: ReadonlyArray<ServiceToken<unknown>>
  setup: (runtime: Runtime, config: TConfig) => void | Promise<void>
}

export interface PluginOptions<TConfig> {
  name: string
  requires?: ReadonlyArray<ServiceToken<unknown>>
  setup: (runtime: Runtime, config: TConfig) => void | Promise<void>
}

export interface RuntimeOptions {
  name?: string
}

/** The root runtime. Mounts plugins; owns the service registry and the event bus. */
export function createRuntime(_options?: RuntimeOptions): Runtime {
  // TODO: kernel — service registry, event bus, effects, lifecycle, mounting.
  throw new Error('@tanstack/compose: createRuntime is not implemented yet')
}

/** Declare a plugin. */
export function definePlugin<TConfig = void>(
  _options: PluginOptions<TConfig>,
): Plugin<TConfig> {
  // TODO: validate the options and normalise `requires`.
  throw new Error('@tanstack/compose: definePlugin is not implemented yet')
}

/** Declare a typed service key. */
export function defineService<TValue>(_key: string): ServiceToken<TValue> {
  // TODO: intern the key so duplicate copies of the package agree on identity.
  throw new Error('@tanstack/compose: defineService is not implemented yet')
}

/** Declare a typed event name and its dispatch mode. */
export function defineEvent<TArgs extends Array<unknown> = [], TResult = void>(
  _name: string,
  _options: { mode: EventMode },
): EventToken<TArgs, TResult> {
  // TODO: intern the name; carry the mode into dispatch.
  throw new Error('@tanstack/compose: defineEvent is not implemented yet')
}
