/** Can the *runtime* cap a worker's heap, since `ses` cannot?
 *
 * Node: `new Worker(url, { resourceLimits: { maxOldGenerationSizeMb } })`.
 * Bun / browsers: no equivalent — checked here so the findings doc is honest.
 *
 * Run with `node scenarios/memory-cap.ts` and `bun scenarios/memory-cap.ts`.
 */

import { detectRuntime } from '../src/worker-shim.ts'

const runtime = detectRuntime()
console.log('runtime:', runtime)

if (runtime !== 'node') {
  console.log(
    'no per-worker heap cap available: the WHATWG Worker constructor has no ' +
      'resourceLimits equivalent, so an allocating plugin is bounded only by ' +
      'the whole process.',
  )
} else {
  const { Worker } = await import('node:worker_threads')
  const cases: Record<string, string> = {
    // Backing stores for typed arrays live OUTSIDE V8's old generation, so
    // the old-generation cap does not see them at all.
    'ArrayBuffer (external backing store)': `
      const chunks = [];
      for (let i = 0; i < 4096; i++) chunks.push(new Uint8Array(1024 * 1024));
      post('allocated 4GB, cap did not apply');`,
    // Ordinary JS objects DO live in the old generation, so the cap bites.
    'plain JS objects (old generation)': `
      const kept = [];
      for (;;) kept.push({ a: 1, b: 'x'.repeat(64), c: [1,2,3] });`,
  }

  for (const [label, body] of Object.entries(cases)) {
    const src = `
      const { parentPort } = require('node:worker_threads');
      const post = (m) => parentPort.postMessage(m);
      try { ${body} } catch (e) { post('threw: ' + e.message); }
    `
    const w = new Worker(src, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: 48 },
    })
    const outcome = await new Promise<string>((resolve) => {
      w.on('message', (m) => resolve(`worker said: ${m}`))
      w.on('error', (e: Error & { code?: string }) =>
        resolve(`worker error: ${e.code ?? e.name}: ${e.message}`),
      )
      w.on('exit', (code) => resolve(`worker exited with code ${code}`))
    })
    await w.terminate()
    console.log(`  cap 48MB, ${label.padEnd(38)} -> ${outcome}`)
  }
}
