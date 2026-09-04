import { act, render, screen } from '@testing-library/react'
import { Slot, createSlot } from '@tanstack/react-compose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposeStart, useComposeSnapshot } from '../src'
import type { ComposeSnapshot } from '../src'

const statusSlot = createSlot('status')

const snapshot = (generation: number, withFill = false): ComposeSnapshot => ({
  generation,
  baseVersion: 'v1',
  outcome: 'good',
  lastKnownGood: generation,
  pluginList: [],
  instances: [],
  fills: withFill
    ? [
        {
          id: 'status#1',
          instanceId: 'followed.view',
          slot: 'status',
          order: 0,
          view: { type: 'text', text: 'followed' },
        },
      ]
    : [],
})

class TestSocket extends EventTarget {
  static instances: Array<TestSocket> = []
  readonly url: string
  readonly sent: Array<string> = []

  constructor(url: string) {
    super()
    this.url = url
    TestSocket.instances.push(this)
  }

  close(): void {}

  send(message: string): void {
    this.sent.push(message)
  }
}

const Generation = () => {
  const value = useComposeSnapshot()
  return <output>{value.generation}</output>
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  TestSocket.instances = []
})

describe('ComposeStart follow', () => {
  it('applies newer whole snapshots, ignores older ones and reconnects', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', TestSocket)
    const page = render(
      <ComposeStart snapshot={snapshot(2)} follow="/follow">
        <Generation />
      </ComposeStart>,
    )

    expect(screen.getByText('2')).toBeTruthy()
    expect(TestSocket.instances).toHaveLength(1)
    const first = TestSocket.instances[0]!

    act(() => {
      first.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify(snapshot(3)) }),
      )
    })
    expect(screen.getByText('3')).toBeTruthy()

    act(() => {
      first.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify(snapshot(1)) }),
      )
    })
    expect(screen.getByText('3')).toBeTruthy()

    first.dispatchEvent(new CloseEvent('close'))
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(TestSocket.instances).toHaveLength(2)
    expect(TestSocket.instances[1]?.url).toBe('/follow')
    page.unmount()
  })

  it('reports a mounted followed view over the same socket', () => {
    vi.stubGlobal('WebSocket', TestSocket)
    const page = render(
      <ComposeStart snapshot={snapshot(4, true)} follow="/follow">
        <Slot of={statusSlot} />
      </ComposeStart>,
    )
    const socket = TestSocket.instances[0]!

    act(() => socket.dispatchEvent(new Event('open')))

    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      generation: 4,
      entries: [{ id: 'followed.view', status: 'active' }],
    })
    page.unmount()
  })
})
