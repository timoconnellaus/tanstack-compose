import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { createViewRenderer } from '../src/index'
import type { ComponentType } from 'react'
import type { ViewNode } from '../src/index'

/** Render one view tree with the handlers it names, as the slot registry would. */
const show = (
  view: ViewNode,
  callbacks: Record<string, (input?: unknown) => Promise<unknown>> = {},
): void => {
  const Fill = createViewRenderer()(view, callbacks) as ComponentType
  render(<Fill />)
}

const resolved = () => vi.fn((): Promise<unknown> => Promise.resolve(undefined))

describe('the view renderer', () => {
  test('renders text with its tone', () => {
    show({ type: 'text', text: 'nine entries', tone: 'muted' })

    const text = screen.getByText('nine entries')
    expect(text.tagName).toBe('SPAN')
    expect(text.className).toBe('view-text view-tone-muted')
  })

  test('renders a button that calls the handler it names', () => {
    const pressed = resolved()
    show(
      { type: 'button', label: 'Summarise', onPress: 'press' },
      { press: pressed },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Summarise' }))

    expect(pressed).toHaveBeenCalledTimes(1)
  })

  test('renders a disabled button, and one whose handler the module never exported', () => {
    show(
      {
        type: 'row',
        children: [
          { type: 'button', label: 'Busy', onPress: 'press', disabled: true },
          { type: 'button', label: 'Bare' },
          { type: 'button', label: 'Missing', onPress: 'gone' },
        ],
      },
      {},
    )

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Busy' }).disabled,
    ).toBe(true)
    // Neither of these has anything to call, and pressing them is not an error.
    fireEvent.click(screen.getByRole('button', { name: 'Bare' }))
    fireEvent.click(screen.getByRole('button', { name: 'Missing' }))
  })

  test('renders an input that reports what is typed and what is submitted', () => {
    const changed = resolved()
    const submitted = resolved()
    show(
      {
        type: 'input',
        name: 'note',
        placeholder: 'say something',
        value: 'draft',
        onChange: 'changed',
        onSubmit: 'submitted',
      },
      { changed, submitted },
    )

    const field = screen.getByLabelText<HTMLInputElement>('note')
    expect(field.value).toBe('draft')
    expect(field.placeholder).toBe('say something')

    fireEvent.change(field, { target: { value: 'drafted' } })
    expect(field.value).toBe('drafted')
    expect(changed).toHaveBeenCalledWith({ name: 'note', value: 'drafted' })

    fireEvent.keyDown(field, { key: 'Enter' })
    expect(submitted).toHaveBeenCalledWith({ name: 'note', value: 'drafted' })
  })

  test('renders rows and stacks as containers around their children', () => {
    show({
      type: 'stack',
      children: [
        { type: 'text', text: 'top' },
        {
          type: 'row',
          children: [
            { type: 'text', text: 'left' },
            { type: 'text', text: 'right' },
          ],
        },
      ],
    })

    const stack = screen.getByText('top').parentElement!
    expect(stack.className).toBe('view-stack')
    const row = screen.getByText('left').parentElement!
    expect(row.className).toBe('view-row')
    expect(row.parentElement).toBe(stack)
    expect(row.textContent).toBe('leftright')
  })

  test('renders nothing for an element it does not know, and does not throw', () => {
    const { container } = render(
      (() => {
        const Fill = createViewRenderer()(
          {
            type: 'stack',
            children: [
              { type: 'text', text: 'kept' },
              { type: 'marquee' } as unknown as ViewNode,
            ],
          },
          {},
        ) as ComponentType
        return <Fill />
      })(),
    )

    expect(container.textContent).toBe('kept')
  })
})
