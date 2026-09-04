import { DurableObject } from 'cloudflare:workers'
import {
  createClient,
  createStub,
  scheduleStub,
  storageStub,
} from '@tanstack/compose'
import { createFacetHost } from '../src/index'
import type { Client, PluginEntry } from '@tanstack/compose'

interface Env {
  LOADER: WorkerLoader
}

const storageSource = (step: number): string => `
let api
export default async function ({ stubs }) {
  api = stubs
  const before = await stubs.storage.get('count') ?? 0
  await stubs.storage.set('count', before + ${step})
}
export async function read() { return await api.storage.get('count') }
`

/** A test-only supervisor proving the installed workerd can execute facets. */
export class FacetTestObject extends DurableObject<Env> {
  #client?: Client
  #events: Array<string> = []

  #host() {
    return createFacetHost({
      ctx: this.ctx,
      loader: this.env.LOADER,
      compatibilityDate: '2026-05-01',
      callTimeoutMs: 2000,
    })
  }

  /** Direct-only test hook used while `runInDurableObject` owns the context. */
  facetHost() {
    return this.#host()
  }

  async storageLifecycle(): Promise<Array<number | undefined>> {
    const entry = (source: string, options?: unknown): PluginEntry => ({
      id: 'stored',
      source,
      host: 'cloudflare',
      stubs: [storageStub],
      options,
    })
    const client = createClient({
      hosts: { cloudflare: this.#host() },
      plugins: [entry(storageSource(1))],
    })
    this.#client = client
    await client.settled()
    const values: Array<number | undefined> = [
      (await client.callSource('stored', 'read')) as number,
    ]

    await client.setOptions('stored', { changed: true })
    values.push((await client.callSource('stored', 'read')) as number)

    await client.setPluginList([entry(storageSource(10))])
    values.push((await client.callSource('stored', 'read')) as number)

    await client.removePlugin('stored')
    await client.addPlugin(entry(storageSource(10)))
    values.push((await client.callSource('stored', 'read')) as number)
    return values
  }

  async scheduleOnce(): Promise<void> {
    const note = createStub<string, void>({
      name: 'note',
      declarations: 'declare const note: (value: string) => Promise<void>',
      handler: ({ input }) => {
        this.#events.push(input)
      },
    })
    const source = `
let api
export default async function ({ stubs }) {
  api = stubs
  await stubs.schedule.at(Date.now() + 20, 'fire')
}
export async function fire() { await api.note('fired') }
`
    this.#client = createClient({
      hosts: { cloudflare: this.#host() },
      plugins: [
        {
          id: 'scheduled',
          source,
          host: 'cloudflare',
          stubs: [scheduleStub, note],
        },
      ],
    })
    await this.#client.settled()
  }

  events(): Array<string> {
    return [...this.#events]
  }

  async stopClient(): Promise<void> {
    await this.#client?.destroy()
  }
}
