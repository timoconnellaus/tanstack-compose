import { DurableObject } from 'cloudflare:workers'
import {
  createClient,
  createStub,
  scheduleStub,
  storageStub,
} from '@tanstack/compose'
import { createFacetHost } from '../src/index'
import type { Client, PluginEntry } from '@tanstack/compose'
import type { FacetHost } from '../src/index'

interface Env {
  LOADER: WorkerLoader
  FACET_TEST: DurableObjectNamespace
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
  #host?: FacetHost

  #facetHost(): FacetHost {
    this.#host ??= createFacetHost({
      ctx: this.ctx,
      self: () => this.env.FACET_TEST.get(this.ctx.id),
      loader: this.env.LOADER,
      compatibilityDate: '2026-05-01',
      callTimeoutMs: 6000,
    })
    return this.#host
  }

  #noteStub() {
    return createStub<string, void>({
      name: 'note',
      declarations: 'declare const note: (value: string) => Promise<void>',
      handler: ({ input }) => {
        this.#events.push(input)
      },
    })
  }

  /** Direct-only test hook used while `runInDurableObject` owns the context. */
  facetHost() {
    return this.#facetHost()
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
      hosts: { cloudflare: this.#facetHost() },
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
    const note = this.#noteStub()
    const source = `
let api
export default async function ({ stubs }) {
  api = stubs
  await stubs.schedule.at(Date.now() + 20, 'fire')
}
export async function fire() { await api.note('fired') }
`
    this.#client = createClient({
      hosts: { cloudflare: this.#facetHost() },
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

  async scheduleEvery(): Promise<void> {
    const note = this.#noteStub()
    this.#client = createClient({
      hosts: { cloudflare: this.#facetHost() },
      plugins: [
        {
          id: 'recurring',
          source: `
let api
export default async function ({ stubs }) {
  api = stubs
  await stubs.schedule.every(20, 'fire')
}
export async function fire() { await api.note('tick') }
export async function cancel() { await api.schedule.cancel() }
`,
          host: 'cloudflare',
          stubs: [scheduleStub, note],
        },
      ],
    })
    await this.#client.settled()
  }

  async cancelRecurring(): Promise<void> {
    await this.#client?.callSource('recurring', 'cancel')
  }

  async scheduleThroughRestartAndRewrite(): Promise<void> {
    const note = this.#noteStub()
    const first = `
let api
export default async function ({ options, stubs }) {
  api = stubs
  if (options.arm) await stubs.schedule.at(Date.now() + 100, 'fire')
}
export async function fire() { await api.note('first') }
`
    const rewritten = `
let api
export default function ({ stubs }) { api = stubs }
export async function fire() { await api.note('survived') }
export async function arm() {
  await api.schedule.at(Date.now() + 40, 'fire')
}
`
    const entry = (source: string, arm: boolean): PluginEntry => ({
      id: 'survivor',
      source,
      options: { arm },
      host: 'cloudflare',
      stubs: [scheduleStub, note],
    })
    this.#client = createClient({
      hosts: { cloudflare: this.#facetHost() },
      plugins: [entry(first, true)],
    })
    await this.#client.settled()
    await this.#client.setOptions('survivor', { arm: false })
    await this.#client.setPluginList([entry(rewritten, false)])
  }

  async armSurvivor(): Promise<void> {
    await this.#client?.callSource('survivor', 'arm')
  }

  async removeScheduled(id: string): Promise<void> {
    await this.#client?.removePlugin(id)
  }

  async schedulePair(): Promise<void> {
    const note = this.#noteStub()
    const source = `
let api, label
export default async function ({ options, stubs }) {
  api = stubs
  label = options.label
  await stubs.schedule.every(30, 'fire')
}
export async function fire() { await api.note(label) }
`
    const entry = (id: string): PluginEntry => ({
      id,
      source,
      options: { label: id },
      host: 'cloudflare',
      stubs: [scheduleStub, note],
    })
    this.#client = createClient({
      hosts: { cloudflare: this.#facetHost() },
      plugins: [entry('left'), entry('right')],
    })
    await this.#client.settled()
  }

  events(): Array<string> {
    return [...this.#events]
  }

  async alarm(): Promise<void> {
    await this.#facetHost().alarm()
  }

  /** Re-entered schedule writes; call only as an RPC into this object. */
  async composeSchedule(operation: unknown): Promise<void> {
    await this.#facetHost().schedule(operation)
  }

  async stopClient(): Promise<void> {
    await this.#client?.destroy()
  }
}
