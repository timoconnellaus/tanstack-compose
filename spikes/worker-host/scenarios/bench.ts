/** Measurements: startup, lockdown, round-trip latency, memory per worker. */

import { makeHost } from './harness.ts'

export type Measurements = Record<string, string>

const isBrowser =
  typeof (globalThis as any).document !== 'undefined' &&
  typeof (globalThis as any).Bun === 'undefined'

function memMB(): number | null {
  const g = globalThis as any
  if (typeof g.process?.memoryUsage === 'function') {
    return g.process.memoryUsage().rss / 1024 / 1024
  }
  // `performance.memory` is Chrome-only AND main-thread-only: a worker's heap
  // is not counted, so this cannot measure cost per worker from the page.
  if (g.performance?.memory) {
    return g.performance.memory.usedJSHeapSize / 1024 / 1024
  }
  return null
}

function pct(sorted: Array<number>, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!
}

export async function measure(): Promise<Measurements> {
  const out: Measurements = {}
  const host = makeHost()

  // --- startup + lockdown, averaged over 5 cold workers ---------------------
  const starts: Array<number> = []
  const locks: Array<number> = []
  for (let i = 0; i < 5; i++) {
    const p = await host.load({ source: `exports.ping = () => 1;` })
    starts.push(p.startupMs)
    locks.push(p.lockdownMs)
    await p.unload()
  }
  const mean = (a: Array<number>) => a.reduce((x, y) => x + y, 0) / a.length
  out['worker spawn -> ready (mean of 5)'] = `${mean(starts).toFixed(1)} ms`
  out['of which lockdown() (mean of 5)'] = `${mean(locks).toFixed(1)} ms`

  // --- round-trip latency, 1000 host->plugin calls --------------------------
  const p = await host.load({
    source: `exports.id = (x) => x;`,
    timeoutMs: 30000,
  })
  for (let i = 0; i < 200; i++) await p.call('id', i) // warm up
  const samples: Array<number> = []
  for (let i = 0; i < 1000; i++) {
    const t = performance.now()
    await p.call('id', i)
    samples.push(performance.now() - t)
  }
  samples.sort((a, b) => a - b)
  if (isBrowser) {
    // Chrome coarsens performance.now() to 100us without cross-origin
    // isolation (COOP+COEP), so anything faster than that reads as 0.
    out['NOTE (timing)'] =
      'performance.now() is coarsened to 100us here; sub-100us latency is unmeasurable without COOP/COEP'
  }
  out['host->plugin->host call, median'] =
    `${(pct(samples, 0.5) * 1000).toFixed(0)} us`
  out['host->plugin->host call, p95'] =
    `${(pct(samples, 0.95) * 1000).toFixed(0)} us`
  out['host->plugin->host call, p99'] =
    `${(pct(samples, 0.99) * 1000).toFixed(0)} us`

  // --- payload size effect --------------------------------------------------
  const big = new Uint8Array(64 * 1024)
  const bigT = performance.now()
  for (let i = 0; i < 200; i++) await p.call('id', big)
  out['64KB Uint8Array echo, mean'] =
    `${(((performance.now() - bigT) / 200) * 1000).toFixed(0)} us`
  await p.unload()

  // --- memory per idle worker ----------------------------------------------
  const before = memMB()
  const many = []
  for (let i = 0; i < 10; i++) {
    many.push(await host.load({ source: `exports.ping = () => 1;` }))
  }
  await new Promise((r) => setTimeout(r, 200))
  const after = memMB()
  if (isBrowser) {
    out['memory per idle worker'] =
      'not observable: performance.memory covers the main thread only'
  } else if (before !== null && after !== null) {
    out['RSS per idle worker (10 workers)'] =
      `~${((after - before) / 10).toFixed(1)} MB (rss delta ${(after - before).toFixed(0)} MB)`
  } else {
    out['RSS per idle worker'] = 'unavailable in this runtime'
  }
  await Promise.all(many.map((m) => m.unload()))
  await host.shutdown()
  return out
}
