import { createClient } from '@tanstack/compose'
import {
  agentKey,
  createScriptedModelPlugin,
  createSessionPlugin,
  loopPlugin,
  modelsPlugin,
  promptPlugin,
  sessionKey,
  toolsPlugin,
} from '@tanstack/compose-example-agent-runtime'
import { slotsPlugin, viewsPlugin } from '@tanstack/react-compose'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DeployedAgent } from '../src/app/deployed-app'
import {
  controllerPlugin,
  markdownPlugin,
  pageTitlePlugin,
  sendAction,
  sendOnEnterPlugin,
  workingIndicatorPlugin,
} from '../src/base'
import type { Client } from '@tanstack/compose'
import type {
  ComposeSnapshot,
  ComposeTransport,
  SnapshotEntry,
} from '@tanstack/start-compose'

class TestWebSocket {
  static current: TestWebSocket | undefined
  readonly listeners = new Map<
    string,
    Array<(event: { data: string }) => void>
  >()

  constructor(_url: string) {
    TestWebSocket.current = this
    queueMicrotask(() => this.emit('open', ''))
  }

  addEventListener(name: string, listener: (event: { data: string }) => void) {
    const listeners = this.listeners.get(name) ?? []
    listeners.push(listener)
    this.listeners.set(name, listeners)
  }

  emit(name: string, data: string) {
    for (const listener of this.listeners.get(name) ?? []) listener({ data })
  }

  send(_message: string) {}
  close() {}
}

const entries: Array<SnapshotEntry> = [
  'slots',
  'views',
  'session',
  'tools',
  'prompt',
  'models',
  'model',
  'loop',
  'controller',
  'page-title',
  'markdown',
  'working-indicator',
  'send-on-enter',
].map((id) => ({ id, plugin: { catalog: id }, stubs: [] }))

const snapshotOf = (client: Client): ComposeSnapshot => ({
  generation: 1,
  baseVersion: 'test',
  outcome: 'good',
  pluginList: entries,
  instances: client.inspect().map(({ error, ...instance }) => ({
    ...instance,
    ...(error === undefined ? {} : { error: { message: String(error) } }),
  })),
  fills: [],
  state: {
    session: client.getContext(sessionKey)?.snapshot() ?? [],
    status: client.getContext(agentKey)?.status.state ?? 'idle',
  } as unknown as ComposeSnapshot['state'],
})

const clients: Array<Client> = []

afterEach(async () => {
  document.body.innerHTML = ''
  TestWebSocket.current = undefined
  for (const client of clients.splice(0)) await client.destroy()
})

describe('the deployed chat follower', () => {
  it('renders a snapshot and follows a turn driven by the scripted model', async () => {
    Object.assign(globalThis, { WebSocket: TestWebSocket })
    const session = createSessionPlugin()
    const client = createClient({
      plugins: [
        { id: 'slots', plugin: slotsPlugin },
        { id: 'views', plugin: viewsPlugin },
        { id: 'session', plugin: session },
        { id: 'tools', plugin: toolsPlugin },
        { id: 'prompt', plugin: promptPlugin },
        { id: 'models', plugin: modelsPlugin },
        {
          id: 'model',
          plugin: createScriptedModelPlugin([
            { chunks: ['Hello ', '**from the tenant**.'] },
          ]),
        },
        { id: 'loop', plugin: loopPlugin },
        { id: 'controller', plugin: controllerPlugin },
        { id: 'page-title', plugin: pageTitlePlugin },
        { id: 'markdown', plugin: markdownPlugin },
        { id: 'working-indicator', plugin: workingIndicatorPlugin },
        { id: 'send-on-enter', plugin: sendOnEnterPlugin },
      ],
    })
    clients.push(client)
    await client.settled()
    const publish = () =>
      TestWebSocket.current?.emit('message', JSON.stringify(snapshotOf(client)))
    const sessionSubscription = client
      .getContext(sessionKey)!
      .entries.subscribe(publish)
    const statusSubscription = client
      .getContext(agentKey)!
      .status.subscribe(publish)
    const transport: ComposeTransport = {
      edit: () => Promise.resolve(undefined),
      press: () => Promise.resolve(undefined),
      dispatch: async ({ action, input }) => {
        if (action !== 'send') throw new Error(`unexpected action ${action}`)
        await client.dispatch(sendAction, input as { text: string })
      },
    }

    render(
      <DeployedAgent
        snapshot={snapshotOf(client)}
        transport={transport}
        follow="/test-follow"
      />,
    )
    expect(screen.getByTestId('page-title')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Say hello' },
    })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })

    await waitFor(() =>
      expect(
        screen.getByText('from the tenant', { exact: false }),
      ).toBeTruthy(),
    )
    expect(screen.getByTestId('markdown')).toBeTruthy()
    expect(screen.getByText('Say hello')).toBeTruthy()

    sessionSubscription.unsubscribe()
    statusSubscription.unsubscribe()
  })
})
