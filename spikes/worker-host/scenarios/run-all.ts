/** Entry point. `node scenarios/run-all.ts` / `bun scenarios/run-all.ts`,
 * and imported by `browser/main.ts` for the browser run. */

import { scenarios } from './all.ts'
import { measure } from './bench.ts'
import { report, runScenarios, runtime } from './harness.ts'

const results = await runScenarios(scenarios)
const ok = report(runtime, results)

console.log(`\n=== measurements — ${runtime} ===`)
const m = await measure()
for (const [k, v] of Object.entries(m)) {
  console.log(`  ${k.padEnd(38)} ${v}`)
}

const g = globalThis as any
if (typeof g.process?.exit === 'function') g.process.exit(ok ? 0 : 1)
