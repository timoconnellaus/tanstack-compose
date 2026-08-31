/**
 * `@tanstack/compose-devtools` — observability for a live client.
 *
 * Scaffold only. See `ROADMAP.md` (slice 3) for when it gets built and
 * `CONTEXT.md` for the terms it has to use. The panels it will expose:
 *
 * - **Instances** — every mounted plugin with its lifecycle state and display name.
 * - **Pending** — instances that have not started, and precisely which requirements
 *   are unmet. Silent pending is the framework's most common footgun, so this is
 *   the panel that earns the package.
 * - **Effect tree** — what each instance is currently holding, nested the way the
 *   effects were registered.
 * - **Event trace** — dispatches, their mode, the listeners reached, and any veto.
 * - **Composition** — the reconciled entry list, with the patch layers that produced it.
 */
import type { Client } from '@tanstack/compose'

export interface DevtoolsOptions {
  client: Client
}

export interface Devtools {
  /** Stop observing and release everything the devtools attached. */
  close: () => void
}

/** Attach devtools to a client. */
export function createDevtools(_options: DevtoolsOptions): Devtools {
  // TODO: subscribe to the kernel's instance/effect/event stores.
  throw new Error(
    '@tanstack/compose-devtools: createDevtools is not implemented yet',
  )
}
