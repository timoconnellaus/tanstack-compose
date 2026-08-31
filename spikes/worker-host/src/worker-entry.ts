/**
 * Runs *inside* the worker. Identical source on Bun, Node and browsers; the
 * only branch is how we reach the message port (see `port` below), which is
 * settled once at startup and then never touched again.
 *
 * Order matters: everything that needs the untamed realm (the port, the timer
 * we use for nothing, the clock) must be captured *before* `lockdown()`, and
 * `lockdown()` must run before the first `new Compartment()`.
 */

import 'ses'
import {
  deserializeError,
  serializeError,
  type CallMessage,
  type HostToWorker,
  type ResultMessage,
} from './protocol.ts'

// No `declare const lockdown/harden/Compartment` needed: ses/types.d.ts has a
// `declare global` block, and the side-effect `import 'ses'` above pulls it in.

// ---------------------------------------------------------------------------
// Port: the one per-runtime branch inside the worker.
// ---------------------------------------------------------------------------

type Port = {
  post: (data: unknown) => void
  onMessage: (fn: (data: any) => void) => void
}

async function getPort(): Promise<Port> {
  const g = globalThis as any
  // Bun and browsers: worker global scope has postMessage/addEventListener.
  // Node's worker_threads global scope has neither; it hands you a parentPort.
  if (typeof g.postMessage === 'function' && typeof g.self !== 'undefined') {
    return {
      post: (d) => g.postMessage(d),
      onMessage: (fn) =>
        g.addEventListener('message', (ev: any) => fn(ev.data)),
    }
  }
  const spec = 'node:worker' + '_threads'
  const { parentPort } = await import(/* @vite-ignore */ spec)
  return {
    post: (d) => parentPort.postMessage(d),
    onMessage: (fn) => parentPort.on('message', fn),
  }
}

const port = await getPort()
const now = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now()

// ---------------------------------------------------------------------------
// Harden the realm.
// ---------------------------------------------------------------------------

const t0 = now()
lockdown({
  // 'unsafe' keeps real stack traces on errors thrown out of a plugin, which
  // is what a plugin author wants to see. The trade is that a plugin can read
  // host stack frames off an error it catches — file paths, essentially.
  // A production host should use the default 'safe' and log the untamed
  // message host-side instead.
  errorTaming: 'unsafe',
  // Give the compartment a real console so `console.log` in a plugin shows up
  // in the worker's output during the spike. 'safe' (default) buffers errors
  // into a side table instead.
  consoleTaming: 'unsafe',
  // MUST stay 'moderate' (the default). 'severe' skips the "override mistake"
  // repair, which makes `Error.prototype.name`/`.stack` non-writable data
  // properties — and then `err.name = 'Foo'` on a *fresh* Error throws inside
  // the worker. That broke this host's own error plumbing, before any plugin
  // ran. 'moderate' installs accessor overrides for exactly that class of
  // property. See ses/src/enablements.js.
  overrideTaming: 'moderate',
  // Keep Math.random and Date deterministic-ish? No — plugins legitimately
  // need both, and denying them buys nothing here. Left at defaults.
  stackFiltering: 'verbose',
})
const lockdownMs = now() - t0

// ---------------------------------------------------------------------------
// RPC plumbing.
// ---------------------------------------------------------------------------

let nextId = 1
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>()

/** Call a stub on the host and await its answer. */
function callHost(path: Array<string>, args: Array<unknown>): Promise<unknown> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    port.post({ t: 'call', id, path, args } satisfies CallMessage)
  })
}

/** Functions the plugin handed us via `tools.register`. Never leave the worker. */
const tools = new Map<string, (...a: Array<unknown>) => unknown>()
/** What the plugin assigned to the `exports` endowment. */
let pluginExports: Record<string, unknown> = {}
let contextSnapshot: Record<string, unknown> = {}

function reply(id: number, ok: boolean, value?: unknown, error?: unknown) {
  const msg: ResultMessage = { t: 'result', id, ok }
  if (ok) msg.value = value
  else msg.error = serializeError(error)
  try {
    port.post(msg)
  } catch (e) {
    // A plugin can return something structured-clone can't carry — a
    // function, a Proxy, or (easiest of all) its own globalThis, which is
    // reachable as `this` inside an *indirect* eval because that runs sloppy.
    // Without this guard the DataCloneError escapes the message handler as an
    // unhandled rejection and the caller waits for the full timeout instead of
    // getting an answer. Downgrade it to an ordinary error result.
    port.post({
      t: 'result',
      id,
      ok: false,
      error: {
        name: 'DataCloneError',
        message: `plugin returned a value that cannot cross the worker boundary: ${
          (e as Error).message
        }`,
      },
    } satisfies ResultMessage)
  }
}

// ---------------------------------------------------------------------------
// The endowments. This is the plugin's entire universe.
// ---------------------------------------------------------------------------

function makeGlobals() {
  // NOTE: harden() is a *deep* freeze. Hardening the container would freeze
  // `exports` with it, and then `exports.greet = ...` throws in the plugin.
  // So: harden each capability individually, leave the bag itself alone.
  // The Compartment copies these onto its own globalThis anyway, so the bag
  // is not reachable from inside.
  return {
    // Nothing ambient: no fetch, no process, no Bun, no setTimeout. Anything
    // the plugin can reach that touches the outside world is one of these.
    log: harden((msg: unknown) => callHost(['log'], [msg])),
    context: harden({
      get: (key: string) => callHost(['context.get'], [key]),
      /** Sync read of the snapshot handed in at load time; no round trip. */
      peek: (key: string) => contextSnapshot[key],
    }),
    tools: harden({
      register: (name: string, fn: (...a: Array<unknown>) => unknown) => {
        if (typeof name !== 'string' || typeof fn !== 'function') {
          throw new TypeError('tools.register(name: string, fn: function)')
        }
        tools.set(name, fn)
        port.post({ t: 'tool-registered', name })
      },
    }),
    // A plugin needs *some* way to publish its own functions to the host.
    // Deliberately NOT hardened.
    exports: {} as Record<string, unknown>,
    harden,
  }
}

// ---------------------------------------------------------------------------
// Message loop.
// ---------------------------------------------------------------------------

port.onMessage(async (msg: HostToWorker) => {
  try {
    if (msg.t === 'load') {
      contextSnapshot = msg.context ?? {}
      const globals = makeGlobals()
      const c = new Compartment({ globals, __options__: true })
      const completion = c.evaluate(msg.source)
      // Two supported shapes: assign onto `exports`, or end the script with an
      // object literal expression. The completion value wins if it is an object.
      pluginExports =
        completion && typeof completion === 'object'
          ? (completion as Record<string, unknown>)
          : (globals.exports as Record<string, unknown>)
      reply(msg.id, true, {
        exports: Object.keys(pluginExports ?? {}),
        tools: [...tools.keys()],
      })
      return
    }

    if (msg.t === 'call') {
      const [kind, name] = msg.path
      const fn =
        kind === 'tool'
          ? tools.get(name!)
          : (pluginExports?.[name!] as
              ((...a: Array<unknown>) => unknown) | undefined)
      if (typeof fn !== 'function') {
        throw new Error(`no such ${kind}: ${name}`)
      }
      const value = await fn(...msg.args)
      reply(msg.id, true, value)
      return
    }

    if (msg.t === 'result') {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.value)
      else p.reject(deserializeError(msg.error))
      return
    }
  } catch (e) {
    if ('id' in msg) reply(msg.id, false, undefined, e)
  }
})

port.post({ t: 'ready', lockdownMs })
