import { createPlugin, stubCallAction } from '@tanstack/compose'
import { describe, expect, it } from 'vitest'
import {
  agentStub,
  createServerStub,
  createSlotsStub,
  sessionStub,
  slotRegistryKey,
  viewRendererKey,
} from '../src'
import { buildComposer, resultsOf } from './helpers/composer'
import type { Cleanup } from '@tanstack/compose'
import type { Slot, SlotRegistry, ViewNode, ViewRenderer } from '../src'

interface Rendered {
  view: ViewNode
  callbacks: Record<string, (input?: unknown) => Promise<unknown>>
}

const buildPage = () => {
  const placed: Array<{ slot: string; rendered: Rendered; live: boolean }> = []
  const registry: SlotRegistry = {
    slot: (name) =>
      ['chat.header', 'chat.input.actions'].includes(name)
        ? { name }
        : undefined,
    fill: (slot: Slot, fill): Cleanup => {
      const one = {
        slot: slot.name,
        rendered: fill.render as Rendered,
        live: true,
      }
      placed.push(one)
      return () => {
        one.live = false
      }
    },
  }
  const renderer: ViewRenderer = (view, callbacks) => ({ view, callbacks })
  return {
    placed,
    live: () => placed.filter((one) => one.live),
    plugin: createPlugin({
      name: 'page',
      provides: [slotRegistryKey, viewRendererKey],
      setup(instance) {
        instance.provide(slotRegistryKey, registry)
        instance.provide(viewRendererKey, renderer)
      },
    }),
  }
}

const source = (label = 'Summarise', slot = 'chat.input.actions') =>
  `
let api
export default async function ({ stubs }) {
  api = stubs
  await stubs.slots({
    slot: '${slot}',
    order: 10,
    view: { type: 'button', label: '${label}', onPress: 'press' },
  })
}
export function press() {
  return '${label === 'Summarise' ? 'summary of the turn' : label}'
}
`.trim()

const write = (id: string, value: string, rewrite = false) => ({
  name: rewrite ? 'rewrite_plugin' : 'write_plugin',
  args: { id, source: value },
})
const read = (id: string) => ({ name: 'read_plugin', args: { id } })
const remove = (id: string) => ({ name: 'remove_plugin', args: { id } })
const done = { chunks: ['done'] }

const assemble = async (setup: {
  source?: string
  id?: string
  slots?: Array<string>
  granted?: boolean
  extraStubs?: Array<
    ReturnType<typeof createServerStub> | typeof agentStub | typeof sessionStub
  >
}) => {
  const page = buildPage()
  const slots = createSlotsStub(
    setup.slots === undefined ? {} : { slots: setup.slots },
  )
  const stubs =
    setup.granted === false ? [] : [slots, ...(setup.extraStubs ?? [])]
  const value = setup.source ?? source()
  const id = setup.id ?? 'summariser'
  const built = await buildComposer({
    stubs,
    plugins: [{ id: 'page', plugin: page.plugin }],
    script: [{ toolCalls: [write(id, value)] }, done],
  })
  return { ...built, page, id, value }
}

describe('the views an agent writes with ordinary source grants', () => {
  it('fills a slot of the page with the source entry it wrote', async () => {
    const { page, agent, session } = await assemble({})

    agent.send('put a button beside the input')
    await agent.idle()

    const [written] = resultsOf(session)
    expect(written?.ok).toBe(true)
    expect(written?.entries).toEqual([
      {
        id: 'summariser',
        plugin: 'source',
        kind: 'source',
        enabled: true,
        protected: false,
        status: 'active',
        readable: true,
      },
    ])
    expect(page.live()).toHaveLength(1)
    expect(page.live()[0]?.slot).toBe('chat.input.actions')
    expect(page.live()[0]?.rendered.view).toEqual({
      type: 'button',
      label: 'Summarise',
      onPress: 'press',
    })
  })

  it('refuses a slot the source entry was not granted without affecting the page', async () => {
    const { client, page, agent, session } = await assemble({
      slots: ['chat.header'],
    })

    agent.send('put a button beside the input')
    await agent.idle()

    const [written] = resultsOf(session)
    expect(written?.ok).toBe(false)
    expect(written?.error).toContain(
      'was not granted the slot "chat.input.actions"',
    )
    expect(client.inspect().find((entry) => entry.id === 'page')?.status).toBe(
      'active',
    )
    expect(
      client.inspect().find((entry) => entry.id === 'summariser')?.status,
    ).toBe('error')
    expect(page.live()).toEqual([])
  })

  it('calls an export of the source entry when its fill is pressed', async () => {
    const { page, agent } = await assemble({})

    agent.send('put it up')
    await agent.idle()

    const pressed = await page.live()[0]?.rendered.callbacks.press?.()
    expect(pressed).toBe('summary of the turn')
  })

  it('reaches a paired server source through the server grant as the view entry', async () => {
    const page = buildPage()
    const slots = createSlotsStub({ slots: ['chat.input.actions'] })
    const server = createServerStub()
    const serverSource = `
export default function () {}
export function summarise({ text }) {
  return 'summary of ' + text
}
`.trim()
    const viewSource = `
let api
export default async function ({ stubs }) {
  api = stubs
  await stubs.slots({
    slot: 'chat.input.actions',
    view: { type: 'button', label: 'Summarise', onPress: 'press' },
  })
}
export function press() {
  return api.server({ handler: 'summarise', input: { text: 'the turn' } })
}
`.trim()
    const seen: Array<{ stub: string; instanceId: string }> = []
    const { client, agent } = await buildComposer({
      stubs: [slots, server],
      plugins: [{ id: 'page', plugin: page.plugin }],
      script: [
        { toolCalls: [write('summariser', serverSource)] },
        { toolCalls: [write('summariser.view', viewSource)] },
        done,
      ],
    })
    client.use(stubCallAction, ({ input, next }) => {
      seen.push({ stub: input.stub, instanceId: input.instanceId })
      return next(input)
    })

    agent.send('put the paired view up')
    await agent.idle()
    const pressed = await page.live()[0]?.rendered.callbacks.press?.()

    expect(pressed).toBe('summary of the turn')
    expect(seen).toEqual([
      { stub: 'slots', instanceId: 'summariser.view' },
      { stub: 'server', instanceId: 'summariser.view' },
    ])
  })

  it('replaces the old fill when its source is rewritten', async () => {
    const page = buildPage()
    const slots = createSlotsStub({ slots: ['chat.input.actions'] })
    const first = source()
    const second = source('Summarise again')
    const { agent, session } = await buildComposer({
      stubs: [slots],
      plugins: [{ id: 'page', plugin: page.plugin }],
      script: [
        { toolCalls: [write('summariser', first)] },
        { toolCalls: [read('summariser')] },
        { toolCalls: [write('summariser', second, true)] },
        done,
      ],
    })

    agent.send('write, inspect and replace the button')
    await agent.idle()

    const results = resultsOf(session)
    expect(results[1]?.source).toBe(first)
    expect(results[2]?.ok).toBe(true)
    expect(page.placed).toHaveLength(2)
    expect(page.placed[0]?.live).toBe(false)
    expect(page.live()[0]?.rendered.view).toMatchObject({
      type: 'button',
      label: 'Summarise again',
    })
  })

  it('empties the slot when the source entry is removed', async () => {
    const page = buildPage()
    const slots = createSlotsStub({ slots: ['chat.input.actions'] })
    const { agent, session } = await buildComposer({
      stubs: [slots],
      plugins: [{ id: 'page', plugin: page.plugin }],
      script: [
        { toolCalls: [write('summariser', source())] },
        { toolCalls: [remove('summariser')] },
        done,
      ],
    })

    agent.send('put the button up and take it away')
    await agent.idle()

    expect(resultsOf(session)[1]?.ok).toBe(true)
    expect(page.live()).toEqual([])
  })

  it('leaves source whose setup throws in error with the page intact', async () => {
    const page = buildPage()
    const broken = `
export default async function ({ stubs }) {
  await stubs.slots({
    slot: 'chat.input.actions',
    view: { type: 'button', label: 'Before the error' },
  })
  throw new Error('the view could not start')
}
`.trim()
    const { client, agent, session } = await buildComposer({
      stubs: [createSlotsStub({ slots: ['chat.input.actions'] })],
      plugins: [{ id: 'page', plugin: page.plugin }],
      script: [{ toolCalls: [write('broken-view', broken)] }, done],
    })

    agent.send('try the broken view')
    await agent.idle()

    const failed = resultsOf(session)[0]
    expect(failed?.ok).toBe(false)
    expect(failed?.error).toContain('the view could not start')
    expect(
      client.inspect().find((entry) => entry.id === 'broken-view')?.status,
    ).toBe('error')
    expect(client.inspect().find((entry) => entry.id === 'page')?.status).toBe(
      'active',
    )
    expect(page.live()).toEqual([])
  })

  it('reads the agent and the end of the session from a view handler', async () => {
    const lookup = `
let api
export default async function ({ stubs }) {
  api = stubs
  await stubs.slots({
    slot: 'chat.input.actions',
    view: { type: 'button', label: 'Look', onPress: 'press' },
  })
}
export async function press() {
  const status = await api.agent()
  const entries = await api.session({ last: 2 })
  return { status: status.status, kinds: entries.map((entry) => entry.kind) }
}
`.trim()
    const { page, agent } = await assemble({
      source: lookup,
      extraStubs: [agentStub, sessionStub],
    })

    agent.send('put the lookup up')
    await agent.idle()
    const looked = (await page.live()[0]?.rendered.callbacks.press?.()) as {
      status: string
      kinds: Array<string>
    }

    expect(looked.status).toBe('idle')
    expect(looked.kinds).toHaveLength(2)
  })

  it('refuses source that tries to fill a slot when no slot grant was given', async () => {
    const { client, agent, session } = await assemble({ granted: false })

    agent.send('try to put it up')
    await agent.idle()

    const [written] = resultsOf(session)
    expect(written?.ok).toBe(false)
    expect(written?.error).toContain('stubs.slots is not a function')
    expect(
      client.inspect().find((entry) => entry.id === 'summariser')?.status,
    ).toBe('error')
  })

  it('binds fill callbacks to the source entry that registered them', async () => {
    const page = buildPage()
    const seen: Array<string> = []
    const { client, agent } = await buildComposer({
      stubs: [createSlotsStub({ slots: ['chat.input.actions'] })],
      plugins: [{ id: 'page', plugin: page.plugin }],
      script: [
        { toolCalls: [write('first', source('First'))] },
        { toolCalls: [write('second', source('Second'))] },
        done,
      ],
    })
    client.use(stubCallAction, ({ input, next }) => {
      seen.push(input.instanceId)
      return next(input)
    })

    agent.send('write both fills')
    await agent.idle()
    expect(page.live()).toHaveLength(2)
    const first = await page.live()[0]?.rendered.callbacks.press?.()
    const second = await page.live()[1]?.rendered.callbacks.press?.()

    expect(first).toBe('First')
    expect(second).toBe('Second')
    expect(seen).toEqual(['first', 'second'])
  })
})
