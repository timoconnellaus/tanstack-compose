import { slotsPlugin, viewsPlugin } from '@tanstack/react-compose'
import {
  actionsStub,
  dataStub,
  notifications,
  pageSide,
  serverStub,
  slotsStub,
  tableActions,
  tablePlugin,
  todoActions,
  todoPlugin,
} from './base'
import type { AnyStubGrant, PluginEntry } from '@tanstack/compose'

/**
 * One showcase app: an individual setup with its own client, its own trusted
 * plugin list and its own plugin panel. Every page is one app; nothing is
 * shared between apps but the base module they draw from.
 */
export interface ShowcaseApp {
  id: 'table' | 'todo' | 'hostile'
  title: string
  eyebrow: string
  /** The trusted entries this app's client starts with. */
  plugins: ReadonlyArray<PluginEntry>
  /** The grants the paste-source panel may hand a pasted entry, by name. */
  grants: Readonly<Partial<Record<string, AnyStubGrant>>>
  /** The slots a pasted or fixture view may fill in this app. */
  viewSlots: ReadonlyArray<string>
}

/** Every app runs the slot registry and the view runtime; the rest is its own. */
const shell: ReadonlyArray<PluginEntry> = [
  { id: 'slots', plugin: slotsPlugin },
  { id: 'views', plugin: viewsPlugin },
]

/** Slots the app frame renders for every app. */
const frameSlots = [notifications.name, pageSide.name]

export const tableApp: ShowcaseApp = {
  id: 'table',
  title: 'Invoices',
  eyebrow: 'Page 1 · add UI',
  plugins: [...shell, { id: 'table', plugin: tablePlugin }],
  grants: { data: dataStub, slots: slotsStub, server: serverStub },
  viewSlots: [tableActions.name, ...frameSlots],
}

export const todoApp: ShowcaseApp = {
  id: 'todo',
  title: 'Todos',
  eyebrow: 'Page 2 · change behaviour',
  plugins: [...shell, { id: 'todo', plugin: todoPlugin }],
  grants: { actions: actionsStub, slots: slotsStub, server: serverStub },
  viewSlots: [todoActions.name, ...frameSlots],
}

export const hostileApp: ShowcaseApp = {
  id: 'hostile',
  title: 'Hostile gallery',
  eyebrow: 'Page 3 · what fails, and how',
  // The table plugin is the trusted sibling that must stay active whatever a
  // hostile source does.
  plugins: [...shell, { id: 'table', plugin: tablePlugin }],
  grants: { data: dataStub, slots: slotsStub, server: serverStub },
  viewSlots: [tableActions.name, ...frameSlots],
}

/** Resolve the app id persisted beside one tenant's client. */
export function appById(id: string): ShowcaseApp {
  const app = [tableApp, todoApp, hostileApp].find((one) => one.id === id)
  if (!app) throw new Error(`showcase: unknown app "${id}"`)
  return app
}
