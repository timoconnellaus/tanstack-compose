import { defineBase, defineGrant } from '@tanstack/compose/base'
import type { GrantContext } from '@tanstack/compose/base'

export interface RecordRow {
  id: number
  label: string
}

const data = defineGrant({
  name: 'data',
  methods: {
    rows(
      filter: { prefix?: string },
      _context: GrantContext,
    ): Array<RecordRow> {
      return [{ id: 1, label: filter.prefix ?? 'one' }]
    },
  },
})

export const testBase = defineBase({
  keys: {},
  actions: {},
  slots: {},
  grants: { data },
  plugins: {},
})
