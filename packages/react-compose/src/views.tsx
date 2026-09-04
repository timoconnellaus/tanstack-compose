import { createPlugin } from '@tanstack/compose'
import { useState } from 'react'
import { slotsKey } from './slots'
import { slotRegistryKey, viewRendererKey } from './view-runtime'
import type { AnySlot } from './slots'
import type {
  ViewCallback,
  ViewNode,
  ViewRenderer,
  ViewSlotRegistry,
  ViewTone,
} from './view-runtime'
import type { ComponentType, ReactNode } from 'react'

const classesOf = (type: string, tone: ViewTone | undefined): string =>
  tone === undefined || tone === 'default'
    ? `view-${type}`
    : `view-${type} view-tone-${tone}`

const press = async (
  callbacks: Readonly<Record<string, ViewCallback>>,
  name: string | undefined,
  input?: unknown,
): Promise<unknown> =>
  name === undefined ? undefined : callbacks[name]?.(input)

/** Start a browser download without exposing the DOM to written view source. */
const download = (text: string, filename: string, mediaType?: string): void => {
  const anchor = document.createElement('a')
  anchor.download = filename
  anchor.href = `data:${mediaType ?? 'text/plain'};charset=utf-8,${encodeURIComponent(text)}`
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

function ViewInput(properties: {
  node: Extract<ViewNode, { type: 'input' }>
  callbacks: Readonly<Record<string, ViewCallback>>
}): ReactNode {
  const { node, callbacks } = properties
  const [value, setValue] = useState(node.value ?? '')
  return (
    <input
      className="view-input"
      aria-label={node.name}
      name={node.name}
      value={value}
      {...(node.placeholder === undefined
        ? {}
        : { placeholder: node.placeholder })}
      onChange={(event) => {
        setValue(event.target.value)
        void press(callbacks, node.onChange, {
          name: node.name,
          value: event.target.value,
        })
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        void press(callbacks, node.onSubmit, { name: node.name, value })
      }}
    />
  )
}

function ViewElement(properties: {
  node: ViewNode
  callbacks: Readonly<Record<string, ViewCallback>>
}): ReactNode {
  const { node, callbacks } = properties
  switch (node.type) {
    case 'text':
      return <span className={classesOf('text', node.tone)}>{node.text}</span>
    case 'pre':
      return (
        <pre
          className={classesOf('pre', node.tone)}
          {...(node.testId === undefined ? {} : { 'data-testid': node.testId })}
        >
          {node.text}
        </pre>
      )
    case 'button':
      return (
        <button
          type="button"
          className={classesOf('button', node.tone)}
          disabled={node.disabled ?? false}
          onClick={() => {
            void press(callbacks, node.onPress).then((result) => {
              if (node.download !== undefined && typeof result === 'string') {
                download(result, node.download, node.mediaType)
              }
            })
          }}
        >
          {node.label}
        </button>
      )
    case 'input':
      return <ViewInput node={node} callbacks={callbacks} />
    case 'row':
    case 'stack':
      return (
        <div className={`view-${node.type}`}>
          {node.children.map((child, at) => (
            <ViewElement key={at} node={child} callbacks={callbacks} />
          ))}
        </div>
      )
    default:
      return null
  }
}

/**
 * Turn a declarative view tree into a React component held by a slot fill.
 * Unknown node types render nothing so a newer view degrades in place.
 */
export function createViewRenderer(): ViewRenderer {
  return (view, callbacks) => {
    const ViewFill: ComponentType = () => (
      <ViewElement node={view} callbacks={callbacks} />
    )
    ViewFill.displayName = 'ViewFill'
    return ViewFill
  }
}

/**
 * Publish the browser client's slot registry and React view renderer for the
 * framework-neutral `slots` and `server` view grants.
 */
export const viewsPlugin = createPlugin({
  name: 'views',
  deps: [slotsKey],
  provides: [slotRegistryKey, viewRendererKey],
  setup(instance) {
    const slots = instance.context.get(slotsKey)
    const registry: ViewSlotRegistry = {
      slot: (name) => slots.slot(name),
      fill: (slot, fill) =>
        slots.fill(slot as AnySlot, {
          ...fill,
          render: fill.render as ComponentType<unknown>,
        }),
    }
    instance.provide(slotRegistryKey, registry)
    instance.provide(viewRendererKey, createViewRenderer())
  },
})
