/** Tiny scenario runner — no test framework, so the same file runs under
 * `node scenarios/run-all.ts`, `bun scenarios/run-all.ts` and a browser bundle. */

import { createHost, type Host } from '../src/host.ts'
import { detectRuntime } from '../src/worker-shim.ts'

export const runtime = detectRuntime()

export function makeHost(): Host {
  if (runtime === 'browser') {
    // A bundler needs the literal `new Worker(new URL(...), ...)` form to see
    // the worker as an entry point and emit a chunk for it; a URL computed
    // elsewhere and handed in would 404. So the browser gets a factory. This
    // is the second (and last) per-runtime shim point.
    return createHost({
      kind: 'factory',
      create: () =>
        new Worker(new URL('../src/worker-entry.ts', import.meta.url), {
          type: 'module',
        }),
    })
  }
  return createHost({
    kind: 'url',
    url: new URL('../src/worker-entry.ts', import.meta.url),
  })
}

export function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`)
}

export function assertEqual(a: unknown, b: unknown, msg: string): void {
  const sa = JSON.stringify(a)
  const sb = JSON.stringify(b)
  if (sa !== sb) throw new Error(`${msg}: expected ${sb}, got ${sa}`)
}

/** Asserts the promise rejects, and returns the error message. */
export async function assertRejects(
  p: Promise<unknown>,
  msg: string,
): Promise<string> {
  try {
    const v = await p
    throw new Error(`${msg}: expected rejection, resolved with ${String(v)}`)
  } catch (e) {
    const m = (e as Error).message
    if (m.startsWith(msg + ':')) throw e
    return m
  }
}

export type Scenario = {
  name: string
  run: (host: Host) => Promise<Array<string>>
}

export type Result = {
  name: string
  ok: boolean
  notes: Array<string>
  error?: string
  ms: number
}

export async function runScenarios(
  scenarios: Array<Scenario>,
): Promise<Array<Result>> {
  const results: Array<Result> = []
  for (const s of scenarios) {
    const host = makeHost()
    const t = performance.now()
    try {
      const notes = await s.run(host)
      results.push({ name: s.name, ok: true, notes, ms: performance.now() - t })
    } catch (e) {
      results.push({
        name: s.name,
        ok: false,
        notes: [],
        error: (e as Error).stack ?? String(e),
        ms: performance.now() - t,
      })
    } finally {
      await host.shutdown()
    }
  }
  return results
}

export function report(runtimeName: string, results: Array<Result>): boolean {
  let pass = true
  const lines: Array<string> = [`\n=== worker-host spike — ${runtimeName} ===`]
  for (const r of results) {
    lines.push(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.ms.toFixed(0)}ms)`)
    for (const n of r.notes) lines.push(`        ${n}`)
    if (!r.ok) {
      pass = false
      lines.push(
        `        ${r.error?.split('\n').slice(0, 4).join('\n        ')}`,
      )
    }
  }
  lines.push(
    `\n${results.filter((r) => r.ok).length}/${results.length} scenarios passed on ${runtimeName}`,
  )
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'))
  return pass
}
