/**
 * I3 — keep the kernel inside its size budget.
 *
 * Bundles `packages/compose/src/index.ts` with rolldown (the bundler tsdown
 * already uses), minifies it, gzips the result and compares it with the
 * budget. `@tanstack/store` is external: it is a dependency, not core code.
 */
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { rolldown } from 'rolldown'

const BUDGET_BYTES = 6 * 1024

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const bundle = await rolldown({
  input: join(root, 'packages/compose/src/index.ts'),
  external: ['@tanstack/store'],
  logLevel: 'silent',
})
const { output } = await bundle.generate({ format: 'esm', minify: true })
await bundle.close()

const code = output
  .filter((chunk) => chunk.type === 'chunk')
  .map((chunk) => chunk.code)
  .join('')
const bytes = gzipSync(Buffer.from(code, 'utf8'), { level: 9 }).byteLength
const kb = (bytes / 1024).toFixed(2)

if (bytes > BUDGET_BYTES) {
  console.error(
    `@tanstack/compose is ${kb} kB min+gzip, over the ${BUDGET_BYTES / 1024} kB budget`,
  )
  process.exit(1)
}
console.log(
  `@tanstack/compose is ${kb} kB min+gzip, within the ${BUDGET_BYTES / 1024} kB budget`,
)
