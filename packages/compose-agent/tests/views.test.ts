import { createPlugin, stubCallAction } from '@tanstack/compose'
import { describe, expect, it } from 'vitest'
import { slotRegistryKey, viewRendererKey, viewStubs } from '../src/index'
import { buildComposer, resultsOf } from './helpers/composer'
import type { AnyPlugin, Cleanup, ResourceNode } from '@tanstack/compose'
import type { Slot, SlotRegistry, ViewNode, ViewRenderer } from '../src/index'

const done = { chunks: ['done'] }

/** What the fake page rendered: the tree, and the handlers it can press. */
interface Rendered {
  view: ViewNode
  callbacks: Record<string, (input?: unknown) => Promise<unknown>>
}

/** One fill of the fake page, and whether it is still there. */
interface Placed {
  slot: string
  order?: number
  key?: string
  rendered: Rendered
  live: boolean
}

/**
 * A page: the slots it has and the fills it is holding. It stands in for the
 * browser client's slot registry and for whatever renders a view's tree, which
 * is what keeps this package free of a framework.
 */
const buildPage = (slots: Array<string>) => {
  const placed: Array<Placed> = []
  const registry: SlotRegistry = {
    slot: (name) => (slots.includes(name) ? { name } : undefined),
    fill: (slot: Slot, fill): Cleanup => {
      const one: Placed = {
        slot: slot.name,
        ...(fill.order === undefined ? {} : { order: fill.order }),
        ...(fill.key === undefined ? {} : { key: fill.key }),
        rendered: fill.render as Rendered,
        live: true,
      }
      placed.push(one)
      return () => {
        one.live = false
      }
    },
  }
  const renderer: ViewRenderer = (view, callbacks) => ({
    view,
    callbacks,
  })
  const plugin: AnyPlugin = createPlugin({
    name: 'page',
    provides: [slotRegistryKey, viewRendererKey],
    setup(instance) {
      instance.provide(slotRegistryKey, registry)
      instance.provide(viewRendererKey, renderer)
    },
  })
  return {
    plugin,
    /** Every fill ever made, live or not. */
    placed,
    /** What the page is showing now. */
    live: () => placed.filter((one) => one.live),
  }
}

/** A plugin with a tool and a handler its view can reach. */
const summariser = `
export default async function ({ stubs }) {
  await stubs.tools({
    name: 'summarise',
    description: 'Summarise something',
    handler: 'summarise',
  })
}

export function summarise(input) {
  return \`summary of \${input?.text ?? 'nothing'}\`
}
`.trim()

/** Its view: one button beside the input, calling the plugin's own handler. */
const summariserView = `
let api
export default async function ({ stubs }) {
  api = stubs
  await api.slots({
    slot: 'chat.input.actions',
    order: 10,
    view: { type: 'button', label: 'Summarise', onPress: 'press' },
  })
}

export async function press() {
  return api.server({ handler: 'summarise', input: { text: 'the turn' } })
}
`.trim()

const write = (id: string, source: string, view?: string) => ({
  name: 'write_plugin',
  args: { id, source, ...(view === undefined ? {} : { view }) },
})
const read = (id: string) => ({ name: 'read_plugin', args: { id } })
const remove = (id: string) => ({ name: 'remove_plugin', args: { id } })

const labels = (node: ResourceNode | undefined): Array<string> => {
  if (!node) return []
  return [node.label, ...node.children.flatMap(labels)]
}

/** A page, an agent that may write views into it, and one script to run. */
const buildPageAgent = async (setup: {
  script: Array<{ toolCalls?: Array<unknown>; chunks?: Array<string> }>
  slots?: Array<string>
  viewSlots?: Array<string>
  granted?: boolean
}) => {
  const page = buildPage(setup.slots ?? ['chat.input.actions', 'chat.header'])
  const built = await buildComposer({
    script: setup.script as never,
    plugins: [{ id: 'page', plugin: page.plugin }],
    ...(setup.granted === false ? {} : { viewStubs: [...viewStubs] }),
    ...(setup.viewSlots === undefined ? {} : { viewSlots: setup.viewSlots }),
  })
  return { ...built, page }
}

describe('the views the agent writes', () => {
  it('fills a slot of the page with the view of the plugin it wrote', async () => {
    const { client, agent, session, page } = await buildPageAgent({
      script: [
        { toolCalls: [write('summariser', summariser, summariserView)] },
        done,
      ],
    })

    agent.send('put a summarise button beside the input')
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
      {
        id: 'summariser.view',
        plugin: 'source',
        kind: 'source',
        enabled: true,
        protected: false,
        status: 'active',
        view: true,
        readable: false,
      },
    ])
    expect(page.live()).toHaveLength(1)
    expect(page.live()[0]?.slot).toBe('chat.input.actions')
    expect(page.live()[0]?.order).toBe(10)
    expect(page.live()[0]?.rendered.view).toEqual({
      type: 'button',
      label: 'Summarise',
      onPress: 'press',
    })
    expect(client.pluginList.state.map((entry) => entry.id).slice(-2)).toEqual([
      'summariser',
      'summariser.view',
    ])
  })

  it('refuses a view the slot it was not granted, and the plugin keeps running', async () => {
    const { client, agent, session, page } = await buildPageAgent({
      script: [
        { toolCalls: [write('summariser', summariser, summariserView)] },
        done,
      ],
      viewSlots: ['chat.header'],
    })

    agent.send('put a summarise button beside the input')
    await agent.idle()

    const [written] = resultsOf(session)
    expect(written?.ok).toBe(false)
    expect(written?.error).toContain(
      'was not granted the slot "chat.input.actions"',
    )
    expect(page.live()).toHaveLength(0)
    const status = (id: string) =>
      client.inspect().find((one) => one.id === id)?.status
    expect(status('summariser')).toBe('active')
    expect(status('summariser.view')).toBe('error')
  })

  it('calls the view of its own module when a fill is pressed', async () => {
    const { agent, page } = await buildPageAgent({
      script: [
        { toolCalls: [write('summariser', summariser, summariserView)] },
        done,
      ],
    })

    agent.send('add the button')
    await agent.idle()

    const pressed = await page.live()[0]?.rendered.callbacks.press?.()
    expect(pressed).toBe('summary of the turn')
  })

  it('reaches the server half through the server stub, as the view itself', async () => {
    const seen: Array<{ stub: string; instanceId: string }> = []
    const { client, agent, page } = await buildPageAgent({
      script: [
        { toolCalls: [write('summariser', summariser, summariserView)] },
        done,
      ],
    })
    client.use(stubCallAction, ({ input, next }) => {
      seen.push({ stub: input.stub, instanceId: input.instanceId })
      return next(input)
    })

    agent.send('add the button')
    await agent.idle()
    await page.live()[0]?.rendered.callbacks.press?.()

    // Every call is attributed by the host: the plugin registered its tool,
    // the view filled its slot, and the call into the server half is the
    // view's own — not the plugin's.
    expect(seen).toEqual([
      { stub: 'tools', instanceId: 'summariser' },
      { stub: 'slots', instanceId: 'summariser.view' },
      { stub: 'server', instanceId: 'summariser.view' },
    ])
  })

  it('replaces the fills of a view when the plugin is rewritten', async () => {
    const rewritten = summariserView.replace('Summarise', 'Recap')
    const { agent, session, page } = await buildPageAgent({
      script: [
        { toolCalls: [write('summariser', summariser, summariserView)] },
        { toolCalls: [read('summariser')] },
        { toolCalls: [write('summariser', summariser, rewritten)] },
        done,
      ],
    })

    agent.send('add the button, then rename it')
    await agent.idle()

    const results = resultsOf(session)
    expect(results[1]?.view).toBe(summariserView)
    expect(results[2]?.ok).toBe(true)
    expect(page.placed).toHaveLength(2)
    expect(page.live()).toHaveLength(1)
    expect(page.live()[0]?.rendered.view).toMatchObject({ label: 'Recap' })
  })

  it('empties the slot when the plugin is removed, leaving nothing behind', async () => {
    const { client, agent, page } = await buildPageAgent({
      script: [
        { toolCalls: [write('summariser', summariser, summariserView)] },
        { toolCalls: [remove('summariser')] },
        done,
      ],
    })

    agent.send('add the button and then take it away')
    await agent.idle()

    expect(page.live()).toHaveLength(0)
    expect(
      client.pluginList.state.some((entry) =>
        entry.id.startsWith('summariser'),
      ),
    ).toBe(false)
    expect(labels(client.resources('summariser.view'))).toEqual([])
    expect(labels(client.resources('summariser'))).toEqual([])
  })

  it('leaves a view whose setup throws in error, with its plugin and the page intact', async () => {
    const other = `
let api
export default async function ({ stubs }) {
  api = stubs
  await api.slots({
    slot: 'chat.header',
    view: { type: 'text', text: 'still here' },
  })
}
`.trim()
    const broken = `
export default async function () {
  throw new Error('the view could not start')
}
`.trim()
    const { client, agent, session, page } = await buildPageAgent({
      script: [
        { toolCalls: [write('banner', summariser, other)] },
        { toolCalls: [write('summariser', summariser, broken)] },
        done,
      ],
    })

    agent.send('add a banner, then a broken one')
    await agent.idle()

    const failed = resultsOf(session)[1]
    expect(failed?.ok).toBe(false)
    expect(failed?.error).toContain('the view could not start')
    expect(
      client.inspect().find((one) => one.id === 'summariser.view')?.status,
    ).toBe('error')
    expect(
      client.inspect().find((one) => one.id === 'summariser')?.status,
    ).toBe('active')
    // The rest of the page is untouched: the banner's fill is still there.
    expect(page.live()).toHaveLength(1)
    expect(page.live()[0]?.slot).toBe('chat.header')
  })

  it('reads the agent and the end of the session from a view handler', async () => {
    const reader = `
let api
export default async function ({ stubs }) {
  api = stubs
  await api.slots({
    slot: 'chat.header',
    view: { type: 'button', label: 'What is happening?', onPress: 'look' },
  })
}

export async function look() {
  const agent = await api.agent()
  const session = await api.session({ last: 2 })
  return { status: agent.status, kinds: session.map((one) => one.kind) }
}
`.trim()
    const { agent, page } = await buildPageAgent({
      script: [{ toolCalls: [write('reader', summariser, reader)] }, done],
    })

    agent.send('add a reader')
    await agent.idle()
    const looked = (await page.live()[0]?.rendered.callbacks.look?.()) as {
      status: string
      kinds: Array<string>
    }

    expect(looked.status).toBe('idle')
    expect(looked.kinds).toHaveLength(2)
  })

  it('refuses to write a view when the operator granted none', async () => {
    const { client, agent, session } = await buildPageAgent({
      script: [
        { toolCalls: [write('summariser', summariser, summariserView)] },
        done,
      ],
      granted: false,
    })

    agent.send('add the button')
    await agent.idle()

    const [written] = resultsOf(session)
    expect(written?.ok).toBe(false)
    expect(written?.error).toContain('was not granted views')
    expect(
      client.pluginList.state.some((entry) => entry.id === 'summariser'),
    ).toBe(false)
  })

  it('writes a view only through the plugin it belongs to', async () => {
    const { agent, session } = await buildPageAgent({
      script: [
        { toolCalls: [write('summariser', summariser, summariserView)] },
        {
          toolCalls: [
            write('summariser.view', summariserView),
            read('summariser.view'),
            remove('summariser.view'),
          ],
        },
        done,
      ],
    })

    agent.send('add the button and then poke at its view directly')
    await agent.idle()

    const [, written, readBack, removed] = resultsOf(session)
    expect(written?.ok).toBe(false)
    expect(written?.error).toContain('is the id of a view')
    expect(readBack?.ok).toBe(false)
    expect(readBack?.error).toContain('is the view of "summariser"')
    expect(removed?.ok).toBe(false)
    expect(removed?.error).toContain('is the view of "summariser"')
  })
})
