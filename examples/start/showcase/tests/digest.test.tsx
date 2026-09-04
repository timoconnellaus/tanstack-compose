import { act, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DigestPage } from '../src/app/digest-page'
import { digestApp } from '../src/apps'
import { digestFixture } from '../src/fixtures'
import { press, startApp } from './helpers/app'
import type { StartedApp } from './helpers/app'

let page: StartedApp | undefined

afterEach(async () => {
  await page?.stop()
  page = undefined
  vi.useRealTimers()
})

describe('the digest page', () => {
  test('updates after its first unattended tick and removal destroys state', async () => {
    vi.useFakeTimers()
    page = await startApp(digestApp, <DigestPage />)
    await press(screen.getByRole('button', { name: 'Add: scheduled digest' }))
    await page.client.settled()

    expect(screen.queryByTestId('latest-digest')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByTestId('latest-digest').textContent).toContain('Echo:')

    await act(async () => {
      await page!.client.removePlugin(digestFixture.id)
    })
    expect(screen.queryByTestId('latest-digest')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.queryByTestId('latest-digest')).toBeNull()
    await act(async () => {
      await page!.client.addPlugin({
        id: digestFixture.id,
        source: digestFixture.source,
        stubs: digestFixture.stubs,
      })
    })
    expect(screen.queryByTestId('latest-digest')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByTestId('latest-digest')).toBeTruthy()
  })
})
