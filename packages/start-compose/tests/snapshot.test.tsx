import { createSlotRegistry } from '@tanstack/react-compose'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { applySnapshot } from '../src'
import type { ComposeSnapshot } from '../src'

const snapshot: ComposeSnapshot = {
  generation: 1,
  pluginList: [],
  instances: [],
  fills: [
    {
      id: 'one',
      instanceId: 'writer.view',
      slot: 'toolbar',
      order: 3,
      key: 'export',
      view: { type: 'button', label: 'Export', onPress: 'exportCsv' },
    },
  ],
}

describe('applySnapshot', () => {
  it('replaces fills and binds presses to the shell-owned instance id', async () => {
    const registry = createSlotRegistry()
    const press = vi.fn(() => Promise.resolve('csv'))

    const cleanup = applySnapshot(registry, snapshot, press)
    const fill = registry.state.state.fills.toolbar?.[0]
    expect(fill?.serialized).toEqual({
      instanceId: 'writer.view',
      view: snapshot.fills[0]?.view,
    })

    const Render = fill!.render
    const page = render(<Render />)
    fireEvent.click(page.getByRole('button', { name: 'Export' }))
    await waitFor(() =>
      expect(press).toHaveBeenCalledWith({
        viewInstanceId: 'writer.view',
        handler: 'exportCsv',
        input: undefined,
      }),
    )

    page.unmount()
    cleanup()
    expect(registry.state.state.fills.toolbar).toEqual([])
  })

  it('reports a render error and removes the failed fill', async () => {
    const registry = createSlotRegistry()
    const report = vi.fn()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken: ComposeSnapshot = {
      ...snapshot,
      fills: [
        {
          ...snapshot.fills[0]!,
          view: { type: 'text', text: { invalid: true } } as never,
        },
      ],
    }

    const cleanup = applySnapshot(registry, broken, undefined, report)
    const Render = registry.state.state.fills.toolbar![0]!.render
    const page = render(<Render />)

    await waitFor(() =>
      expect(report).toHaveBeenCalledWith({
        id: 'writer.view',
        status: 'error',
        error: {
          message: expect.stringContaining('not valid as a React child'),
        },
      }),
    )
    await waitFor(() => expect(registry.state.state.fills.toolbar).toEqual([]))

    page.unmount()
    cleanup()
    logged.mockRestore()
  })
})
