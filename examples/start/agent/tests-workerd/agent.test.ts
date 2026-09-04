import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { ComposeDurableObject } from '@tanstack/start-compose'
import type { AgentEnv } from '../src/tenant'

const tenant = (name = 'integration:agent'): ComposeDurableObject => {
  const namespace = (env as unknown as AgentEnv).TENANT
  return namespace.get(
    namespace.idFromName(name),
  ) as unknown as ComposeDurableObject
}

describe('the agent in its tenant object', () => {
  it('writes a facet fill, exposes its reply, presses it, then removes it', async () => {
    const object = tenant()
    await object.snapshot('agent')

    await object.dispatch({ action: 'send', input: { text: 'Add the button' } })
    const written = await object.snapshot()
    expect(JSON.stringify(written.state)).toContain(
      'The facet button is ready.',
    )
    expect(written.pluginList).toContainEqual(
      expect.objectContaining({
        id: 'facet-button',
        plugin: { written: true },
      }),
    )
    const fill = written.fills.find(
      (candidate) => candidate.instanceId === 'facet-button',
    )
    expect(fill).toMatchObject({
      slot: 'chat.input.actions',
      view: { type: 'button', label: 'Facet hello', onPress: 'press' },
    })

    await expect(
      object.press({ viewInstanceId: 'facet-button', handler: 'press' }),
    ).resolves.toBe('hello from the isolated facet')

    await object.dispatch({ action: 'send', input: { text: 'Remove it' } })
    const removed = await object.snapshot()
    expect(JSON.stringify(removed.state)).toContain(
      'The facet plugin is removed.',
    )
    expect(removed.pluginList.map((entry) => entry.id)).not.toContain(
      'facet-button',
    )
    expect(removed.fills).not.toContainEqual(
      expect.objectContaining({ instanceId: 'facet-button' }),
    )
  })

  it('keeps a written plugin and its fill across an object restart', async () => {
    const object = tenant('integration:restart')
    await object.snapshot('agent')
    await object.dispatch({ action: 'send', input: { text: 'Add the button' } })
    expect(
      (await object.snapshot()).pluginList.map((entry) => entry.id),
    ).toContain('facet-button')

    // Eviction: the next call reaches a fresh instance that must rebuild
    // everything from storage.
    await runInDurableObject(
      object as unknown as DurableObjectStub,
      (_instance, state) => {
        state.abort()
      },
    ).catch(() => {})

    // The old stub may still answer for the aborted instance once; a fresh
    // stub reaches the rebuilt one.
    const restarted = tenant('integration:restart')
    const after = await restarted.snapshot()
    expect(after.pluginList.map((entry) => entry.id)).toContain('facet-button')
    expect(after.fills).toContainEqual(
      expect.objectContaining({ instanceId: 'facet-button' }),
    )
    await expect(
      restarted.press({ viewInstanceId: 'facet-button', handler: 'press' }),
    ).resolves.toBe('hello from the isolated facet')
  })
})
