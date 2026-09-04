import { grantView, viewIdOf, viewStubs } from '@tanstack/react-compose'
import type { AnyStubGrant, Client, PluginEntry } from '@tanstack/compose'
import type { SerializedEntry } from '@tanstack/start-compose'
import type { ShowcaseApp } from './apps'
import type { ShowcaseFixture } from './fixtures'

/** Turn a source/view pair into the two ordinary entries the client runs. */
export async function entriesForWritten(
  client: Client,
  fixture: ShowcaseFixture,
  app: ShowcaseApp,
): Promise<Array<PluginEntry>> {
  const server: PluginEntry = {
    id: fixture.id,
    source: fixture.source,
    options: fixture.options,
    stubs: fixture.stubs,
  }
  if (fixture.view === undefined || fixture.view === '') return [server]

  const grants = fixture.stubs.map((stub) => ({
    name: stub.name,
    declarations: stub.declarations,
  }))
  const exported = await client.checker?.exports?.({
    source: fixture.source,
    grants,
  })
  const narrowed = grantView(viewStubs, {
    slots: app.viewSlots,
    ...(exported === undefined ? {} : { exports: exported }),
  })
  return [
    server,
    { id: viewIdOf(fixture.id), source: fixture.view, stubs: narrowed },
  ]
}

/** Add or replace a written source/view pair in one plugin-list edit. */
export async function addWritten(
  client: Client,
  fixture: ShowcaseFixture,
  app: ShowcaseApp,
): Promise<void> {
  const ids = new Set([fixture.id, viewIdOf(fixture.id)])
  await client.setPluginList([
    ...client.pluginList.state.filter((entry) => !ids.has(entry.id)),
    ...(await entriesForWritten(client, fixture, app)),
  ])
}

/** Remove a written source and its paired view in one plugin-list edit. */
export async function removeWritten(client: Client, id: string): Promise<void> {
  const serverId = id.endsWith('.view') ? id.slice(0, -'.view'.length) : id
  const ids = new Set([serverId, viewIdOf(serverId)])
  await client.setPluginList(
    client.pluginList.state.filter((entry) => !ids.has(entry.id)),
  )
}

/** Persistable server/view entries for the deployed one-client-per-app DO. */
export function serializedEntriesForWritten(
  fixture: ShowcaseFixture,
  app: ShowcaseApp,
): Array<SerializedEntry> {
  const server: SerializedEntry = {
    id: fixture.id,
    plugin: { source: fixture.source },
    options: fixture.options,
    stubs: [
      ...(fixture.serializedStubs ?? fixture.stubs.map((stub) => stub.name)),
    ],
    host: 'cloudflare',
  }
  if (fixture.view === undefined || fixture.view === '') return [server]
  return [
    server,
    {
      id: viewIdOf(fixture.id),
      plugin: { source: fixture.view },
      stubs: [`${app.id}.slots`, 'server'],
      host: 'cloudflare',
    },
  ]
}

/** Resolve selected grant names into the stub values a panel entry receives. */
export function selectedStubs(
  names: ReadonlyArray<string>,
  grants: Readonly<Partial<Record<string, AnyStubGrant>>>,
): Array<AnyStubGrant> {
  return names.flatMap((name) => {
    const stub = grants[name]
    return stub === undefined ? [] : [stub]
  })
}
