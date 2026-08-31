/**
 * The host side. Fully portable — every runtime difference is behind
 * `spawnWorker` in `worker-shim.ts`.
 *
 * One worker per loaded plugin. That is what buys the isolation `ses` cannot
 * give on its own: `lockdown()` confines *authority* (what a plugin can name),
 * but it does nothing about CPU or memory, because a frozen `while(true){}` is
 * still `while(true){}`. Only `terminate()` on a separate thread stops that.
 */

import {
  deserializeError,
  type CallMessage,
  type ResultMessage,
  type WorkerToHost,
} from './protocol.ts'
import {
  spawnWorker,
  type WorkerHandle,
  type WorkerSpec,
} from './worker-shim.ts'

export type HostStubs = {
  log: (msg: unknown) => void | Promise<void>
  contextGet: (key: string) => unknown | Promise<unknown>
}

export type LoadOptions = {
  source: string
  /** Values readable synchronously via `context.peek`. Structured-cloned. */
  context?: Record<string, unknown>
  /** Wall-clock budget for load and for every call. Default 2000ms. */
  timeoutMs?: number
  stubs?: Partial<HostStubs>
}

export class PluginTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(
      `plugin exceeded its ${ms}ms budget during ${what}; worker terminated`,
    )
    this.name = 'PluginTimeoutError'
  }
}

export class PluginTerminatedError extends Error {
  constructor() {
    super('plugin worker is gone')
    this.name = 'PluginTerminatedError'
  }
}

export type LoadedPlugin = {
  /** Names the plugin put on `exports`. */
  exports: Array<string>
  /** Names passed to `tools.register`. */
  tools: Array<string>
  /** ms the worker reported for `import 'ses'` + `lockdown()`. */
  lockdownMs: number
  /** ms from `spawnWorker` to the `ready` message. */
  startupMs: number
  call: (name: string, ...args: Array<unknown>) => Promise<unknown>
  callTool: (name: string, ...args: Array<unknown>) => Promise<unknown>
  /** True once the worker has been terminated, by timeout or by unload. */
  readonly dead: boolean
  /** Terminates the worker; settles only once the thread is actually gone. */
  unload: () => Promise<void>
}

const now = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now()

export type Host = {
  load: (opts: LoadOptions) => Promise<LoadedPlugin>
  /** Unloads every plugin this host started. */
  shutdown: () => Promise<void>
}

/**
 * @param spec how to make a worker running `worker-entry.ts` — a file URL on
 *   Bun/Node, a `new Worker(new URL(...), {type:'module'})` factory in a
 *   bundler-driven browser build.
 */
export function createHost(spec: WorkerSpec): Host {
  const live = new Set<LoadedPlugin>()

  async function load(opts: LoadOptions): Promise<LoadedPlugin> {
    const timeoutMs = opts.timeoutMs ?? 2000
    const t0 = now()
    const worker: WorkerHandle = await spawnWorker(spec)

    let dead = false
    let nextId = 1
    const pending = new Map<
      number,
      {
        resolve: (v: unknown) => void
        reject: (e: Error) => void
        timer: ReturnType<typeof setTimeout>
        what: string
      }
    >()

    /** Terminate and fail everything outstanding. Idempotent. */
    async function kill(reason: Error): Promise<void> {
      if (dead) return
      dead = true
      for (const [, p] of pending) {
        clearTimeout(p.timer)
        p.reject(reason)
      }
      pending.clear()
      await worker.terminate()
    }

    function request(
      what: string,
      body: (id: number) => void,
    ): Promise<unknown> {
      if (dead) return Promise.reject(new PluginTerminatedError())
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          // The worker thread is spinning and will never answer. The *only*
          // remedy is to take the thread away.
          void kill(new PluginTimeoutError(what, timeoutMs))
        }, timeoutMs)
        pending.set(id, { resolve, reject, timer, what })
        body(id)
      })
    }

    const stubs: HostStubs = {
      log: opts.stubs?.log ?? (() => {}),
      contextGet: opts.stubs?.contextGet ?? ((k) => opts.context?.[k]),
    }

    worker.onError((err) => void kill(err))

    let onReady: (m: { lockdownMs: number }) => void = () => {}

    worker.onMessage((raw) => {
      const msg = raw as WorkerToHost
      if (msg.t === 'ready') {
        onReady(msg)
        return
      }
      if (msg.t === 'tool-registered') return // surfaced in the load result

      if (msg.t === 'result') {
        const p = pending.get(msg.id)
        if (!p) return
        clearTimeout(p.timer)
        pending.delete(msg.id)
        if (msg.ok) p.resolve(msg.value)
        else p.reject(deserializeError(msg.error))
        return
      }

      if (msg.t === 'call') {
        // Plugin -> host. Answer on our own time; never block the loop.
        void (async () => {
          const out: ResultMessage = { t: 'result', id: msg.id, ok: true }
          try {
            const [name] = msg.path
            if (name === 'log') out.value = await stubs.log(msg.args[0])
            else if (name === 'context.get') {
              out.value = await stubs.contextGet(msg.args[0] as string)
            } else throw new Error(`no such stub: ${name}`)
          } catch (e) {
            out.ok = false
            out.error = {
              name: (e as Error).name,
              message: (e as Error).message,
            }
          }
          if (!dead) worker.postMessage(out)
        })()
      }
    })

    const readyInfo = await new Promise<{ lockdownMs: number }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          void kill(new PluginTimeoutError('startup', timeoutMs))
          reject(new PluginTimeoutError('startup', timeoutMs))
        }, timeoutMs)
        onReady = (m) => {
          clearTimeout(timer)
          resolve(m)
        }
      },
    )
    const startupMs = now() - t0

    const loadResult = (await request('load', (id) => {
      worker.postMessage({
        t: 'load',
        id,
        source: opts.source,
        context: opts.context ?? {},
      })
    })) as { exports: Array<string>; tools: Array<string> }

    const plugin: LoadedPlugin = {
      exports: loadResult.exports,
      tools: loadResult.tools,
      lockdownMs: readyInfo.lockdownMs,
      startupMs,
      get dead() {
        return dead
      },
      call: (name, ...args) =>
        request(`call ${name}`, (id) => {
          worker.postMessage({
            t: 'call',
            id,
            path: ['export', name],
            args,
          } satisfies CallMessage)
        }),
      callTool: (name, ...args) =>
        request(`tool ${name}`, (id) => {
          worker.postMessage({
            t: 'call',
            id,
            path: ['tool', name],
            args,
          } satisfies CallMessage)
        }),
      unload: async () => {
        await kill(new PluginTerminatedError())
        live.delete(plugin)
      },
    }
    live.add(plugin)
    return plugin
  }

  return {
    load,
    shutdown: async () => {
      await Promise.all([...live].map((p) => p.unload()))
    },
  }
}
