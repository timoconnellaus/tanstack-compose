import { useState } from 'react'
import type { ComponentType, ReactNode } from 'react'

/**
 * The renderer that turns a **view**'s declarative tree into a **fill**'s
 * renderer.
 *
 * The vocabulary below is a structural copy of the one the agent layer
 * publishes, not an import of it: this package knows nothing about agents,
 * sessions or chat (B1), and a value of either shape satisfies the other. The
 * one producer of the vocabulary is `@tanstack/compose-agent`, which puts it in
 * the declarations a written view is checked against; this file only has to
 * render what arrives.
 */

/** How prominent an element is. The page decides what each tone looks like. */
export type ViewTone = 'default' | 'muted' | 'primary' | 'danger'

/**
 * What a **view** puts in a **slot**, as plain data. Nothing here is a
 * function: where a callback would be there is the *name* of one of the view
 * module's exports, so the same tree crosses every **host** boundary.
 */
export type ViewNode =
  | { type: 'text'; text: string; tone?: ViewTone }
  | {
      type: 'button'
      label: string
      /** The name of the handler to call when it is pressed. */
      onPress?: string
      disabled?: boolean
      tone?: ViewTone
    }
  | {
      type: 'input'
      name: string
      placeholder?: string
      value?: string
      /** Called with `{ name, value }` as the text changes. */
      onChange?: string
      /** Called with `{ name, value }` when the text is submitted. */
      onSubmit?: string
    }
  | { type: 'row'; children: Array<ViewNode> }
  | { type: 'stack'; children: Array<ViewNode> }

/** One handler of the view module, already bound to the module's export. */
export type ViewCallback = (input?: unknown) => Promise<unknown>

/**
 * Turns a view's declarative tree and its bound handlers into whatever the page
 * renders. The agent layer holds this as a **context key** and never looks
 * inside the result, which is how React stays out of that package.
 */
export type ViewRenderer = (
  view: ViewNode,
  callbacks: Readonly<Record<string, ViewCallback>>,
) => unknown

/** The class names a node renders with: its type, and its tone when it has one. */
const classesOf = (type: string, tone: ViewTone | undefined): string =>
  tone === undefined || tone === 'default'
    ? `view-${type}`
    : `view-${type} view-tone-${tone}`

/** Call a named handler, if the tree named one and the module exported it. */
const press = (
  callbacks: Readonly<Record<string, ViewCallback>>,
  name: string | undefined,
  input?: unknown,
): void => {
  if (name === undefined) return
  void callbacks[name]?.(input)
}

/**
 * A text input, in its own component because it holds the text it shows. Enter
 * submits: a view fills a slot that may already be inside a form — the input
 * box's actions are — so a nested `<form>` would be invalid markup.
 */
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
        press(callbacks, node.onChange, {
          name: node.name,
          value: event.target.value,
        })
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        press(callbacks, node.onSubmit, { name: node.name, value })
      }}
    />
  )
}

/**
 * One node of the tree. An element of a type this vocabulary does not name
 * renders nothing and does not throw, so a view written against a newer
 * vocabulary degrades rather than taking the page with it (D1a).
 */
function ViewElement(properties: {
  node: ViewNode
  callbacks: Readonly<Record<string, ViewCallback>>
}): ReactNode {
  const { node, callbacks } = properties
  switch (node.type) {
    case 'text':
      return <span className={classesOf('text', node.tone)}>{node.text}</span>
    case 'button':
      return (
        <button
          type="button"
          className={classesOf('button', node.tone)}
          disabled={node.disabled ?? false}
          onClick={() => press(callbacks, node.onPress)}
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
            // The tree is data with no identity of its own; a rewritten view is
            // a new fill, so position is the only key there is.
            <ViewElement key={at} node={child} callbacks={callbacks} />
          ))}
        </div>
      )
    default:
      return null
  }
}

/**
 * The React **view** renderer: it turns a view's declarative tree into a
 * component the **slot** registry can hold as a **fill**.
 *
 * `text` is a span with a tone class, `button` is a button that calls the
 * handler its `onPress` names, `input` is a controlled input that calls
 * `onChange` as it is typed in and `onSubmit` on Enter, and `row` and `stack`
 * are flex containers the page's stylesheet lays out. An element of an unknown
 * type renders nothing rather than throwing.
 *
 * The page provides the result under the agent layer's renderer key; nothing in
 * this package knows what a view is for.
 *
 * @example
 * ```ts
 * instance.provide(viewRendererKey, createViewRenderer())
 * ```
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
