import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { TodoPage } from '../src/app/todo-page'
import { press, pressInPanel, startPage } from './helpers/app'
import type { StartedPage } from './helpers/app'

let page: StartedPage | undefined

afterEach(async () => {
  await page?.stop()
  page = undefined
})

const titles = (): Array<string> =>
  screen
    .getAllByTestId('todo-item')
    .map((item) => item.querySelector('span')?.textContent ?? '')

describe('the todo page', () => {
  test('adds and removes sorting and validation middleware', async () => {
    page = await startPage(<TodoPage />)
    await waitFor(() =>
      expect(titles()).toEqual(['Book dentist', 'Call Alice', 'Write report']),
    )

    await press(screen.getByRole('button', { name: 'Add: sort by due date' }))
    await waitFor(() =>
      expect(titles()).toEqual(['Write report', 'Book dentist', 'Call Alice']),
    )

    await press(screen.getByRole('button', { name: 'Add: block empty titles' }))
    const count = screen.getAllByTestId('todo-item').length
    await press(screen.getByRole('button', { name: 'Add todo' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'a todo needs a title',
    )
    expect(screen.getAllByTestId('todo-item')).toHaveLength(count)

    await pressInPanel('sort-by-due', 'Remove')
    await pressInPanel('require-title', 'Remove')
    await waitFor(() =>
      expect(titles()).toEqual(['Book dentist', 'Call Alice', 'Write report']),
    )

    fireEvent.change(screen.getByLabelText('Todo due date'), {
      target: { value: '2026-09-01' },
    })
    await press(screen.getByRole('button', { name: 'Add todo' }))
    await waitFor(() =>
      expect(screen.getAllByTestId('todo-item')).toHaveLength(count + 1),
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      within(screen.getByTestId('todo-list')).getAllByTestId('todo-item')[0]
        ?.textContent,
    ).toContain('2026-09-01')
  })
})
