import { createClient, createPlugin } from '@tanstack/compose'
import { createTypeScriptChecker } from '@tanstack/compose-typescript'
import { describe, expect, it } from 'vitest'
import {
  agentKey,
  agentStubs,
  composerPlugin,
  grantView,
  loopPlugin,
  modelsPlugin,
  promptPlugin,
  scriptedModelPlugin,
  sessionKey,
  sessionPlugin,
  slotRegistryKey,
  toolCallAction,
  toolsPlugin,
  viewRendererKey,
  viewStubs,
} from '@tanstack/compose-example-agent-runtime'
import type { ComposerResult } from '@tanstack/compose-tools'
import type { Cleanup } from '@tanstack/compose'
import type {
  SessionLog,
  Slot,
  SlotRegistry,
  ViewNode,
  ViewRenderer,
} from '@tanstack/compose-example-agent-runtime'

/** The plugin half: one handler the view is meant to reach. */
const plugin = `const setup: Setup = async ({ stubs }) => {
  await stubs.tools({
    name: 'summarise',
    description: 'Summarise a piece of text',
    handler: 'summarise',
  })
}
export default setup

export function summarise(input: { text: string }): string {
  return \`summary of \${input.text}\`
}
`

/** The model's first view: it calls a handler the plugin does not export. */
const wrongHandler = `let api: Stubs
const setup: Setup = async ({ stubs }) => {
  api = stubs
  await api.slots({
    slot: 'chat.input.actions',
    view: { type: 'button', label: 'Summarise', onPress: 'press' },
  })
}
export default setup

export async function press() {
  return api.server({ handler: 'summarize', input: { text: 'the turn' } })
}
`

/** Its second view, which calls the handler the plugin really has. */
const rightHandler = wrongHandler.replace("'summarize'", "'summarise'")

/** A view that fills a slot the operator did not grant it. */
const wrongSlot = rightHandler.replace("'chat.input.actions'", "'chat.footer'")

/** What the fake page rendered, and the handlers it can press. */
interface Rendered {
  view: ViewNode
  callbacks: Record<string, (input?: unknown) => Promise<unknown>>
}

const buildPage = () => {
  const placed: Array<{ slot: string; rendered: Rendered; live: boolean }> = []
  const registry: SlotRegistry = {
    slot: (name) =>
      ['chat.input.actions', 'chat.footer'].includes(name)
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

const composerTools = ['list_plugins', 'write_plugin']

const resultsOf = (session: SessionLog): Array<ComposerResult> =>
  session
    .snapshot()
    .filter(
      (entry) =>
        entry.kind === 'tool-result' && composerTools.includes(entry.name),
    )
    .map(
      (entry) =>
        (entry as { outcome: { value?: unknown } }).outcome
          .value as ComposerResult,
    )

const write = (view: string) => ({
  toolCalls: [
    {
      name: 'write_plugin',
      args: { id: 'summariser.view', source: view },
    },
  ],
})

describe('a view checked against the plugin it belongs to', () => {
  it('recovers the named exports of plugin source with the type of each', async () => {
    const checker = createTypeScriptChecker()
    const exported = await checker.exports!({
      source: plugin,
      grants: agentStubs.map((grant) => ({
        name: grant.name,
        declarations: grant.declarations,
      })),
    })
    expect(exported).toEqual([
      { name: 'summarise', type: '(input: { text: string; }) => string' },
    ])
  })

  it('makes a view calling a handler the plugin does not export a diagnostic', async () => {
    const page = buildPage()
    const checker = createTypeScriptChecker()
    const exported = await checker.exports!({
      source: plugin,
      grants: agentStubs.map((grant) => ({
        name: grant.name,
        declarations: grant.declarations,
      })),
    })
    const grants = grantView(viewStubs, {
      slots: ['chat.input.actions'],
      exports: exported,
    })
    const client = createClient({
      checker,
      plugins: [
        { id: 'session', plugin: sessionPlugin },
        { id: 'tools', plugin: toolsPlugin },
        { id: 'prompt', plugin: promptPlugin },
        { id: 'models', plugin: modelsPlugin },
        {
          id: 'model',
          plugin: scriptedModelPlugin,
          options: {
            script: [
              { toolCalls: [{ name: 'list_plugins', args: {} }] },
              write(wrongHandler),
              write(wrongSlot),
              write(rightHandler),
              { chunks: ['The button is up.'] },
            ],
          },
        },
        { id: 'loop', plugin: loopPlugin },
        { id: 'page', plugin: page.plugin },
        { id: 'summariser', source: plugin, stubs: [...agentStubs] },
        {
          id: 'composer',
          plugin: composerPlugin,
          options: {
            protected: ['session', 'tools', 'prompt', 'models', 'loop'],
            stubs: grants,
          },
        },
      ],
    })
    await client.settled()
    const agent = client.getContext(agentKey)!
    const session = client.getContext(sessionKey)!

    /** The plugin list as it stood after each `write_plugin` returned. */
    const listAfterWrite: Array<Array<string>> = []
    client.use(toolCallAction, async ({ input, next }) => {
      const outcome = await next(input)
      if (input.call.name === 'write_plugin') {
        listAfterWrite.push(client.pluginList.state.map((one) => one.id))
      }
      return outcome
    })

    agent.send('put a summarise button beside the input')
    await agent.idle()

    const [listed, handler, slot, written] = resultsOf(session)

    // What the model is shown before it writes anything names the slots it may
    // fill; the server half's handlers are only nameable once there is source.
    expect(listed?.declarations).toContain(
      'type GrantedSlot = "chat.input.actions"',
    )
    expect(listed?.declarations).toContain('declare const slots')

    // A handler the plugin does not export is a type error, at the position
    // the model wrote it at, and neither entry was created.
    expect(handler?.ok).toBe(false)
    expect(handler?.diagnostics?.[0]?.message).toContain(
      `Type '"summarize"' is not assignable to type '"summarise"'`,
    )
    expect(handler?.diagnostics?.[0]).toMatchObject({ line: 12, column: 23 })
    expect(wrongHandler.split('\n')[11]).toContain('summarize')
    expect(handler?.entries).toEqual([])
    expect(handler?.declarations).toContain(
      'summarise: (input: { text: string; }) => string',
    )
    expect(listAfterWrite[0]).toContain('summariser')
    expect(listAfterWrite[0]).not.toContain('summariser.view')

    // A slot it was not granted is a type error too, for the same reason: the
    // grant is in the declarations, so it never reaches the page to be refused.
    expect(slot?.ok).toBe(false)
    expect(slot?.diagnostics?.[0]?.message).toContain(
      `Type '"chat.footer"' is not assignable to type '"chat.input.actions"'`,
    )

    // The corrected view checks, runs, and its button reaches the plugin.
    expect(written?.ok).toBe(true)
    expect(written?.entries.map((one) => one.id)).toEqual(['summariser.view'])
    expect(page.live()).toHaveLength(1)
    expect(page.live()[0]?.slot).toBe('chat.input.actions')
    const pressed = await page.live()[0]?.rendered.callbacks.press?.()
    expect(pressed).toBe('summary of the turn')

    await client.destroy()
  })
})
