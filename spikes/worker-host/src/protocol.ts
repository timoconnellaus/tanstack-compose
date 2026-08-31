/**
 * Wire protocol between the host and the plugin worker.
 *
 * Every payload here must survive structured clone: plain objects, arrays,
 * primitives, Date, Map, Set, ArrayBuffer. No functions, no class instances,
 * no Error objects (we flatten those into `SerializedError`).
 */

export type SerializedError = {
  name: string
  message: string
  stack?: string
}

/** host -> worker: evaluate this plugin source in a fresh Compartment. */
export type LoadMessage = {
  t: 'load'
  id: number
  source: string
  /** Context values the plugin may read through `context.get(key)`. */
  context: Record<string, unknown>
}

/** Either direction: invoke a named function on the other side. */
export type CallMessage = {
  t: 'call'
  id: number
  /**
   * host -> worker: `['export', name]` for a plugin export, `['tool', name]`
   * for a function the plugin handed us via `tools.register`.
   * worker -> host: `['log']`, `['context.get']` — the injected stubs.
   */
  path: Array<string>
  args: Array<unknown>
}

/** Either direction: settle a `call` or a `load`. */
export type ResultMessage = {
  t: 'result'
  id: number
  ok: boolean
  value?: unknown
  error?: SerializedError
}

/** worker -> host: emitted once the compartment is up, before any call. */
export type ReadyMessage = {
  t: 'ready'
  /** ms spent importing ses + running lockdown() inside the worker. */
  lockdownMs: number
}

/** worker -> host: the plugin called `tools.register(name, fn)`. */
export type ToolRegisteredMessage = {
  t: 'tool-registered'
  name: string
}

export type HostToWorker = LoadMessage | CallMessage | ResultMessage
export type WorkerToHost =
  ReadyMessage | CallMessage | ResultMessage | ToolRegisteredMessage

export function serializeError(e: unknown): SerializedError {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack }
  }
  return { name: 'Error', message: String(e) }
}

/**
 * Rebuild an Error from the wire.
 *
 * The assignments are guarded because under `lockdown({overrideTaming:'severe'})`
 * `Error.prototype.name` and `.stack` become non-writable data properties, so
 * `err.name = x` on a fresh instance throws "not extensible" / "read only" —
 * the classic "override mistake". This function runs on both sides of the
 * bridge, and the worker side is inside the hardened realm.
 */
export function deserializeError(e: SerializedError | undefined): Error {
  const err = new Error(e?.message ?? 'unknown plugin error')
  try {
    Object.defineProperty(err, 'name', {
      value: e?.name ?? 'Error',
      configurable: true,
      writable: true,
    })
    if (e?.stack) {
      Object.defineProperty(err, 'stack', {
        value: e.stack,
        configurable: true,
        writable: true,
      })
    }
  } catch {
    // Hardened realm refused the redefinition; the message still carries.
  }
  return err
}
