/**
 * Every acceptance criterion is proven by a test whose title starts with the
 * criterion id. This fails if any id in a docs/acceptance markdown file is
 * missing from a test title anywhere under packages.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const walk = (directory: string): Array<string> => {
  let found: Array<string> = []
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage')
      continue
    const path = join(directory, name)
    if (statSync(path).isDirectory()) found = found.concat(walk(path))
    else if (/\.test(-d)?\.tsx?$/.test(name)) found.push(path)
  }
  return found
}

const acceptanceDir = join(root, 'docs/acceptance')
const testFiles = walk(join(root, 'packages')).map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
}))

let failures = 0
for (const file of readdirSync(acceptanceDir).filter((name) =>
  name.endsWith('.md'),
)) {
  const text = readFileSync(join(acceptanceDir, file), 'utf8')
  const ids = [...text.matchAll(/^- \*\*([A-Z]\d+)\*\*/gm)].map(
    (match) => match[1]!,
  )
  if (ids.length === 0) continue
  for (const id of ids) {
    // The title may be opened by any of the three quote characters.
    const pattern = new RegExp(
      '\\b(it|test)\\(\\s*[\\x27\\x22\\x60]' + id + ' ',
    )
    const proof = testFiles.find((candidate) => pattern.test(candidate.text))
    if (proof) continue
    failures++
    console.error(`${file}: no test title starts with "${id}"`)
  }
  console.log(`${file}: ${ids.length} criteria`)
}

if (failures > 0) {
  console.error(`\n${failures} criteria are not proven by a test.`)
  process.exit(1)
}
console.log('Every acceptance criterion is proven by a test.')
