import { defineBase, defineGrant } from '@tanstack/compose/base'
import { base, demoRows } from './base'
import type { GrantContext } from '@tanstack/compose/base'
import type { Row } from './base'

/** Base v2's renamed table-data grant. */
export const dataV2Stub = defineGrant({
  name: 'data',
  methods: {
    records(_context: GrantContext): Array<Row> {
      return [...demoRows]
    },
  },
})

/** The showcase v2 base: only `data.rows` changes to `data.records`. */
export const baseV2 = defineBase({
  keys: base.keys,
  actions: base.actions,
  slots: base.slots,
  grants: { ...base.grants, data: dataV2Stub },
  plugins: base.plugins,
})
