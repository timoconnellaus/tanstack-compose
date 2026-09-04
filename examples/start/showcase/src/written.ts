import { grantView, viewIdOf, viewStubs } from '@tanstack/react-compose'
import { notifications, pageSide, tableActions, todoActions } from './base'
import type { AnyStubGrant, Client, PluginEntry } from '@tanstack/compose'
import type { ShowcaseFixture } from './fixtures'

/** Every slot a pasted S1 view may be granted. */
export const viewSlotNames = [
  tableActions.name,
  todoActions.name,
  notifications.name,
  pageSide.name,
]

/** Turn a source/view pair into the two ordinary entries the client runs. */
export function entriesForWritten(
  client: Client,
  fixture: ShowcaseFixture,
): Array<PluginEntry> {
  const server: PluginEntry = {
    id: fixture.id,
    source: fixture.source,
    stubs: fixture.stubs,
  }
  if (fixture.view === undefined || fixture.view === '') return [server]

  const grants = fixture.stubs.map((stub) => ({
    name: stub.name,
    declarations: stub.declarations,
  }))
  const exported = client.checker?.exports?.({
    source: fixture.source,
    grants,
  })
  const narrowed = grantView(viewStubs, {
    slots: viewSlotNames,
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
): Promise<void> {
  const ids = new Set([fixture.id, viewIdOf(fixture.id)])
  await client.setPluginList([
    ...client.pluginList.state.filter((entry) => !ids.has(entry.id)),
    ...entriesForWritten(client, fixture),
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
