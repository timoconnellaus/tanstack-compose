/**
 * The only per-runtime code on the host side.
 *
 * Bun and browsers have the WHATWG `Worker` global; Node has
 * `node:worker_threads`, whose API differs in four ways that matter here:
 *
 *   | thing        | web Worker                    | node:worker_threads          |
 *   | ------------ | ----------------------------- | ---------------------------- |
 *   | receive      | `onmessage = (ev) => ev.data` | `.on('message', (data) =>)`  |
 *   | errors       | `onmessageerror` / `onerror`  | `.on('error', (err) =>)`     |
 *   | terminate    | sync, returns `undefined`     | returns a `Promise`          |
 *   | module type  | `{ type: 'module' }`          | implicit (respects package)  |
 *
 * `WorkerHandle` papers over all four so `host.ts` has no runtime branches.
 */

export type WorkerHandle = {
  postMessage: (data: unknown) => void
  onMessage: (fn: (data: unknown) => void) => void
  onError: (fn: (err: Error) => void) => void
  /** Resolves only once the worker thread is actually gone. */
  terminate: () => Promise<void>
}

/** How to produce the underlying worker. Supplied per runtime. */
export type WorkerSpec =
  { kind: 'url'; url: URL } | { kind: 'factory'; create: () => Worker }

export type RuntimeName = 'bun' | 'node' | 'browser' | 'unknown'

export function detectRuntime(): RuntimeName {
  const g = globalThis as any
  if (typeof g.Bun !== 'undefined') return 'bun'
  if (typeof g.window !== 'undefined' && typeof g.document !== 'undefined') {
    return 'browser'
  }
  if (typeof g.process !== 'undefined' && g.process.versions?.node)
    return 'node'
  return 'unknown'
}

/**
 * Node needs `node:worker_threads`, which cannot be statically imported in a
 * browser bundle. The specifier goes through a variable so bundlers leave it
 * alone.
 */
async function nodeWorkerThreads(): Promise<any> {
  const spec = 'node:worker' + '_threads'
  return import(/* @vite-ignore */ spec)
}

export async function spawnWorker(spec: WorkerSpec): Promise<WorkerHandle> {
  const runtime = detectRuntime()

  if (runtime === 'node') {
    if (spec.kind !== 'url') {
      throw new Error('node worker host requires a URL spec')
    }
    const { Worker: NodeWorker } = await nodeWorkerThreads()
    const w = new NodeWorker(spec.url)
    return {
      postMessage: (data) => w.postMessage(data),
      onMessage: (fn) => w.on('message', fn),
      onError: (fn) => w.on('error', fn),
      terminate: async () => {
        // node's terminate() resolves with the exit code once the thread is
        // torn down, so awaiting it is already the quiescence guarantee.
        await w.terminate()
      },
    }
  }

  // Bun and browsers: the WHATWG Worker global.
  const w: Worker =
    spec.kind === 'factory'
      ? spec.create()
      : new Worker(spec.url, { type: 'module' })

  let exited = false
  return {
    postMessage: (data) => w.postMessage(data),
    onMessage: (fn) => {
      w.addEventListener('message', (ev) => fn((ev as MessageEvent).data))
    },
    onError: (fn) => {
      w.addEventListener('error', (ev) => {
        const e = ev as ErrorEvent
        fn(e.error instanceof Error ? e.error : new Error(String(e.message)))
      })
    },
    terminate: async () => {
      if (exited) return
      exited = true
      w.terminate()
      // Web `terminate()` is synchronous and returns nothing; the spec says the
      // agent is torn down "immediately" but gives no signal. Yield a macrotask
      // so the event loop drains the worker's queued messages before we claim
      // quiescence. See HTML spec 10.2.5 "terminate a worker".
      await new Promise((r) => setTimeout(r, 0))
    },
  }
}
