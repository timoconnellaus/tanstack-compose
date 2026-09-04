import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTypeScriptChecker } from '@tanstack/compose-typescript'
import { generateDeclarations } from '@tanstack/compose-typescript/generate'
import {
  exportCsvSource,
  pairASource,
  pairBSource,
  requireTitleSource,
  sortByDueSource,
  sortByDueV2Source,
} from '../src/fixtures'

const sourceEntry = resolve(process.cwd(), 'src/base.ts')
const v2Entry = resolve(process.cwd(), 'src/base-v2.ts')

const check = async (
  generated: { text: string; version: string },
  source: string,
  grants: Array<string>,
) =>
  await createTypeScriptChecker({
    baseDeclarations: generated.text,
    baseVersion: generated.version,
  }).check({
    baseVersion: generated.version,
    instanceId: 'fixture',
    source,
    declarations: '',
    grants: grants.map((name) => ({ name, declarations: '' })),
  })

describe('the showcase generated declarations', () => {
  it('type-check every passing product fixture without hand-written grant text', async () => {
    const v1 = generateDeclarations({ entry: sourceEntry, exportName: 'base' })

    for (const [source, grants] of [
      [exportCsvSource, ['data']],
      [requireTitleSource, ['actions']],
      [sortByDueSource, ['actions', 'data']],
      [pairASource, ['exports']],
      [pairBSource, ['deps']],
    ] as const) {
      expect((await check(v1, source, [...grants])).diagnostics).toBeUndefined()
    }
    expect(v1.text).not.toContain('rowDeclaration')
    expect(v1.text).not.toContain("operation: 'rows'")
    expect(v1.text).not.toContain('interface TableRow')
  })

  it('rejects rows after v2 renames it and accepts the repaired fixture', async () => {
    const v2 = generateDeclarations({ entry: v2Entry, exportName: 'baseV2' })
    const broken = await check(v2, sortByDueSource, ['actions', 'data'])
    expect(broken.diagnostics?.[0]?.message).toContain('rows')
    expect(
      (await check(v2, sortByDueV2Source, ['actions', 'data'])).diagnostics,
    ).toBeUndefined()
  })
})
