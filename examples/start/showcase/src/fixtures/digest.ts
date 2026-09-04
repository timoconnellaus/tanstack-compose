import { aiStub, scheduleStub, storageStub } from '@tanstack/compose/grants'
import { dataStub, slotsStub } from '../base'
import type { ShowcaseFixture } from './types'

/** Scheduled digest source used by page 4. */
export const digestSource = `
let api: Stubs

async function publish(value: { text: string; at: number } | undefined): Promise<void> {
  if (!value) return
  await api.slots({
    slot: 'notifications',
    key: 'digest',
    view: {
      type: 'stack',
      children: [
        { type: 'text', text: 'Latest digest', tone: 'muted' },
        { type: 'pre', text: value.text, testId: 'latest-digest' },
        { type: 'text', text: new Date(value.at).toISOString() },
      ],
    },
  })
}

const setup: Setup = async ({ stubs }) => {
  api = stubs
  await publish(await api.storage.get<{ text: string; at: number }>('latest'))
  await api.schedule.every(15000, 'digest')
}
export default setup

export async function digest(): Promise<void> {
  const rows = await api.data.rows()
  const text = await api.ai.text({
    system: 'Summarise invoice rows in one sentence.',
    prompt: JSON.stringify(rows),
  })
  const value = { text, at: Date.now() }
  await api.storage.set('latest', value)
  await publish(value)
}
`.trim()

/** Page 4's pre-designed scheduled digest. */
export const digestFixture: ShowcaseFixture = {
  id: 'digest-summary',
  source: digestSource,
  stubs: [dataStub, storageStub, scheduleStub, aiStub, slotsStub],
  serializedStubs: ['data', 'storage', 'schedule', 'ai', 'digest.slots'],
}
