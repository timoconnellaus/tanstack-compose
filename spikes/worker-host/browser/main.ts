/** Browser run of the *same* scenarios and the *same* host code. The only
 * difference from the Node/Bun run is how `makeHost` builds the Worker. */

import { scenarios } from '../scenarios/all.ts'
import { measure } from '../scenarios/bench.ts'
import { runScenarios, runtime } from '../scenarios/harness.ts'

const out = document.getElementById('out')!
const status = document.getElementById('status')!

try {
  const results = await runScenarios(scenarios)
  const lines: Array<string> = [`=== worker-host spike — ${runtime} ===`]
  for (const r of results) {
    lines.push(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.ms.toFixed(0)}ms)`)
    for (const n of r.notes) lines.push(`        ${n}`)
    if (!r.ok)
      lines.push(`        ${r.error?.split('\n').slice(0, 4).join(' | ')}`)
  }
  const passed = results.filter((r) => r.ok).length
  lines.push('', `${passed}/${results.length} scenarios passed on ${runtime}`)

  lines.push('', `=== measurements — ${runtime} ===`)
  const m = await measure()
  for (const [k, v] of Object.entries(m)) lines.push(`  ${k.padEnd(38)} ${v}`)

  out.textContent = lines.join('\n')
  status.textContent = `DONE ${passed}/${results.length}`
  status.className = passed === results.length ? 'pass' : 'fail'
  ;(window as any).__RESULTS__ = lines.join('\n')
} catch (e) {
  status.textContent = 'CRASHED'
  status.className = 'fail'
  out.textContent = (e as Error).stack ?? String(e)
  ;(window as any).__RESULTS__ = out.textContent
}
