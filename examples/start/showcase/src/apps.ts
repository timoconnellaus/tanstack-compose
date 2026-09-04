import { slotsPlugin, viewsPlugin } from '@tanstack/react-compose'
import {
  aiStub,
  httpStub,
  scheduleStub,
  storageStub,
} from '@tanstack/compose/grants'
import {
  actionsStub,
  currencyColumn,
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
  id: 'table' | 'todo' | 'hostile' | 'digest' | 'currency' | 'tenants'
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

export const digestApp: ShowcaseApp = {
  id: 'digest',
  title: 'Digest',
  eyebrow: 'Page 4 · unattended work',
  plugins: [...shell, { id: 'table', plugin: tablePlugin }],
  grants: {
    data: dataStub,
    storage: storageStub,
    schedule: scheduleStub,
    ai: aiStub,
    slots: slotsStub,
  },
  viewSlots: [tableActions.name, ...frameSlots],
}

export const currencyApp: ShowcaseApp = {
  id: 'currency',
  title: 'Currency',
  eyebrow: 'Page 5 · named network service',
  plugins: [...shell, { id: 'table', plugin: tablePlugin }],
  grants: { data: dataStub, http: httpStub, slots: slotsStub },
  viewSlots: [currencyColumn.name, ...frameSlots],
}

export const tenantsApp: ShowcaseApp = {
  id: 'tenants',
  title: 'Two tenants',
  eyebrow: 'Page 6 · tenant isolation',
  plugins: [...shell],
  grants: { storage: storageStub, slots: slotsStub },
  viewSlots: frameSlots,
}

/** Resolve the app id persisted beside one tenant's client. */
export function appById(id: string): ShowcaseApp {
  const app = [
    tableApp,
    todoApp,
    hostileApp,
    digestApp,
    currencyApp,
    tenantsApp,
  ].find((one) => one.id === id)
  if (!app) throw new Error(`showcase: unknown app "${id}"`)
  return app
}
