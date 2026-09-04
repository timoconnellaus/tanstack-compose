import h from 'solid-js/h'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import {
  Header,
  JsonTree,
  MainPanel,
  Section,
  SectionDescription,
  SectionTitle,
  Tag,
  ThemeContextProvider,
} from '@tanstack/devtools-ui'
import type { TanStackDevtoolsTheme } from '@tanstack/devtools-ui'
import type { JSX } from 'solid-js'
import type { DevtoolsError, DevtoolsInstance, DevtoolsSnapshot } from './index'

type Tab = 'instances' | 'resources' | 'plugins' | 'context' | 'errors'

const tabs: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'instances', label: 'Instances' },
  { id: 'resources', label: 'Resources' },
  { id: 'plugins', label: 'Plugin list' },
  { id: 'context', label: 'Context' },
  { id: 'errors', label: 'Errors' },
]

const column =
  'display:flex;flex-direction:column;gap:12px;padding:12px;overflow:auto;'
const row = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;'
const muted = 'opacity:0.72;font-family:ui-monospace,monospace;font-size:12px;'
const tabButton =
  'padding:4px 10px;border:1px solid currentColor;border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer;opacity:0.7;'
const waiting =
  'margin-top:8px;padding:8px;border:1px solid currentColor;border-radius:4px;'

const statusColor = (
  status: DevtoolsInstance['status'],
): 'green' | 'yellow' | 'red' | 'gray' => {
  if (status === 'active') return 'green'
  if (status === 'pending') return 'yellow'
  if (status === 'error') return 'red'
  return 'gray'
}

const empty = (message: string) =>
  h(Section, {}, h(SectionDescription, {}, message))

const titledSection = (
  title: string,
  description: string,
  ...children: Array<unknown>
) =>
  h(
    Section,
    {},
    h(SectionTitle, {}, title),
    h(SectionDescription, {}, description),
    ...children,
  )

const renderInstances = (snapshot: DevtoolsSnapshot) =>
  snapshot.instances.length === 0
    ? empty('No plugin instances.')
    : snapshot.instances.map((instance) =>
        titledSection(
          instance.plugin,
          instance.id,
          h(
            'div',
            { style: row },
            h(Tag, {
              color: statusColor(instance.status),
              disabled: true,
              label: instance.status,
            }),
            h('span', { style: muted }, `phase: ${instance.phase}`),
          ),
          instance.status === 'pending'
            ? h(
                'div',
                { style: waiting },
                h('strong', {}, 'Waiting for: '),
                instance.unmetDeps.length > 0
                  ? instance.unmetDeps.join(', ')
                  : 'settlement',
              )
            : [],
        ),
      )

const renderResources = (snapshot: DevtoolsSnapshot) =>
  snapshot.resources.length === 0
    ? empty('No held resources.')
    : snapshot.resources.map((resource) =>
        titledSection(
          resource.tree.label,
          resource.instanceId,
          h(JsonTree, {
            value: resource.tree,
            defaultExpansionDepth: 4,
          }),
        ),
      )

const renderPluginList = (snapshot: DevtoolsSnapshot) =>
  snapshot.pluginList.length === 0
    ? empty('The plugin list is empty.')
    : snapshot.pluginList.map((entry) =>
        titledSection(
          entry.plugin ?? `Plugin source (${entry.source.length} characters)`,
          entry.id,
          h(
            'div',
            { style: row },
            h(Tag, {
              color: entry.enabled ? 'green' : 'gray',
              disabled: true,
              label: entry.enabled ? 'enabled' : 'disabled',
            }),
            entry.source
              ? h('span', { style: muted }, `host: ${entry.source.host}`)
              : [],
          ),
          h(
            'p',
            {},
            h('strong', {}, 'Granted stubs: '),
            entry.granted.length > 0 ? entry.granted.join(', ') : 'none',
          ),
        ),
      )

const renderContext = (snapshot: DevtoolsSnapshot) =>
  snapshot.context.length === 0
    ? empty('No context keys are currently provided.')
    : snapshot.context.map((entry) =>
        titledSection(
          entry.key,
          `provided by ${entry.provider}`,
          h('span', { style: muted }, `${entry.key} → ${entry.provider}`),
        ),
      )

const renderCause = (error: DevtoolsError) =>
  error.cause
    ? h(
        'details',
        {},
        h('summary', {}, 'Cause chain'),
        h(JsonTree, {
          value: error.cause,
          defaultExpansionDepth: 8,
        }),
      )
    : []

const renderErrors = (snapshot: DevtoolsSnapshot) =>
  snapshot.errors.length === 0
    ? empty('No contained client errors.')
    : snapshot.errors.map((error) =>
        titledSection(
          error.message,
          error.instanceId ?? 'client',
          h('span', { style: muted }, `phase: ${error.phase}`),
          renderCause(error),
        ),
      )

const renderTab = (snapshot: DevtoolsSnapshot, tab: Tab): unknown => {
  if (tab === 'instances') return renderInstances(snapshot)
  if (tab === 'resources') return renderResources(snapshot)
  if (tab === 'plugins') return renderPluginList(snapshot)
  if (tab === 'context') return renderContext(snapshot)
  return renderErrors(snapshot)
}

const panel = (
  snapshot: () => DevtoolsSnapshot,
  theme: () => TanStackDevtoolsTheme,
) => {
  const [selected, setSelected] = createSignal<Tab>('instances')
  return h(
    ThemeContextProvider,
    {
      get theme() {
        return theme()
      },
    },
    h(
      MainPanel,
      { withPadding: false },
      h(
        Header,
        {},
        h('strong', { style: 'padding:12px 16px;' }, 'TanStack Compose'),
      ),
      h(
        'nav',
        {
          'aria-label': 'Compose devtools panels',
          style: 'display:flex;gap:8px;padding:8px 12px;flex-wrap:wrap;',
        },
        // The UI kit's components destructure their props, so any reactive
        // prop given to `Button` recurses; the tabs are plain buttons whose
        // reactive attributes Solid handles directly.
        tabs.map((tab) =>
          h(
            'button',
            {
              type: 'button',
              style: tabButton,
              get ['aria-pressed']() {
                return selected() === tab.id
              },
              get ['data-selected']() {
                return selected() === tab.id ? '' : undefined
              },
              onClick: () => setSelected(tab.id),
            },
            tab.label,
          ),
        ),
      ),
      h('div', { style: column }, () => renderTab(snapshot(), selected())),
    ),
  )
}

/** The Solid UI-kit island owned by the React panel. */
export interface MountedComposePanel {
  update: (snapshot: DevtoolsSnapshot, theme: TanStackDevtoolsTheme) => void
  close: () => void
}

/** Mount the UI-kit panel into a React-owned element. */
export function mountComposePanel(
  element: HTMLElement,
  initialSnapshot: DevtoolsSnapshot,
  initialTheme: TanStackDevtoolsTheme,
): MountedComposePanel {
  const [snapshot, setSnapshot] = createSignal(initialSnapshot)
  const [theme, setTheme] = createSignal(initialTheme)
  const close = render(
    (() => panel(snapshot, theme)) as unknown as () => JSX.Element,
    element,
  )
  return {
    update: (nextSnapshot, nextTheme) => {
      setSnapshot(nextSnapshot)
      setTheme(nextTheme)
    },
    close,
  }
}
