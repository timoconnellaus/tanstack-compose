import { storageStub } from '@tanstack/compose/grants'
import { slotsStub } from '../base'
import type { ShowcaseFixture } from './types'

/** Same source and same key used independently in each tenant. */
export const tenantStorageSource = `
let api: Stubs

async function show(value: string): Promise<void> {
  await api.slots({
    slot: 'notifications',
    key: 'tenant-value',
    view: { type: 'text', text: value },
  })
}

const setup: Setup = async ({ stubs, options }) => {
  api = stubs
  const value = String((options as { value?: string } | undefined)?.value ?? 'unset')
  await api.storage.set('shared', value)
  await show(value)
}
export default setup

export function read(): Promise<string | undefined> {
  return api.storage.get<string>('shared')
}
`.trim()

/** Page 6's identical per-tenant storage fixture. */
export const tenantStorageFixture: ShowcaseFixture = {
  id: 'tenant-note',
  source: tenantStorageSource,
  stubs: [storageStub, slotsStub],
  serializedStubs: ['storage', 'tenants.slots'],
}
