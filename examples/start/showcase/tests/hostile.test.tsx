import { screen, waitFor, within } from '@testing-library/react'
import { stubDeclarations } from '@tanstack/compose'
import { afterEach, describe, expect, test } from 'vitest'
import { HostilePage } from '../src/app/hostile-page'
import { hostileApp } from '../src/apps'
import { hostileFixtures } from '../src/fixtures'
import { press, startApp } from './helpers/app'
import type { StartedApp } from './helpers/app'

let page: StartedApp | undefined

afterEach(async () => {
  await page?.stop()
  page = undefined
})

const fixture = (id: string): HTMLElement => screen.getByTestId(`hostile-${id}`)

describe('the hostile gallery', () => {
  for (const hostile of hostileFixtures.filter(
    (one) =>
      !one.disabled &&
      one.id !== 'oversized-payload' &&
      one.id !== 'forges-instance-id',
  )) {
    test(`${hostile.id} ends in error while the base stays active`, async () => {
      page = await startApp(hostileApp, <HostilePage />)

      await press(
        within(fixture(hostile.id)).getByRole('button', {
          name: `Run: ${hostile.label}`,
        }),
      )

      await waitFor(() =>
        expect(fixture(hostile.id).textContent).toContain('error'),
      )
      expect(fixture(hostile.id).textContent).toContain(
        hostile.expected.split(' — ').at(-1),
      )
      // Every trusted entry of this app is untouched by the hostile source.
      for (const entry of hostileApp.plugins) {
        expect(
          page.client.inspect().find((one) => one.id === entry.id)?.status,
          entry.id,
        ).toBe('active')
      }
    })
  }

  test('refuses forged identity through the stub closure', async () => {
    page = await startApp(hostileApp, <HostilePage />)
    const hostile = hostileFixtures.find(
      (one) => one.id === 'forges-instance-id',
    )!

    await press(
      within(fixture(hostile.id)).getByRole('button', {
        name: `Run: ${hostile.label}`,
      }),
    )

    await waitFor(() =>
      expect(fixture(hostile.id).textContent).toContain('active'),
    )
    expect(
      screen.getByTestId('hostile-result-forges-instance-id').textContent,
    ).toContain('Claimed “table”; stubCallAction observed “forges-instance-id”')
  })

  test('keeps the page responsive after the unbounded in-process transfer', async () => {
    page = await startApp(hostileApp, <HostilePage />)
    const hostile = hostileFixtures.find(
      (one) => one.id === 'oversized-payload',
    )!

    await press(
      within(fixture(hostile.id)).getByRole('button', {
        name: `Run: ${hostile.label}`,
      }),
    )

    await waitFor(() =>
      expect(fixture(hostile.id).textContent).toContain('active'),
    )
    expect(
      screen.getByTestId('hostile-result-oversized-payload').textContent,
    ).toContain('no transfer limit')
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Revert to last good',
      }).disabled,
    ).toBe(false)
  })

  test('keeps ambient reach disabled and reverts to the last all-active list', async () => {
    page = await startApp(hostileApp, <HostilePage />)
    const outsideFixture = hostileFixtures.find(
      (one) => one.id === 'reaches-outside',
    )!
    const checkedOutside = await page.client.checker?.check({
      baseVersion: page.client.baseVersion,
      instanceId: outsideFixture.id,
      source: outsideFixture.source,
      declarations: stubDeclarations(outsideFixture.stubs),
      grants: outsideFixture.stubs.map((grant) => ({
        name: grant.name,
        declarations: grant.declarations,
      })),
    })
    expect(typeof checkedOutside?.code).toBe('string')

    const outside = within(fixture('reaches-outside')).getByRole('button', {
      name: 'Requires isolating host',
    })
    expect((outside as HTMLButtonElement).disabled).toBe(true)
    expect(fixture('reaches-outside').textContent).toContain(
      'Requires an isolating host (slice 7)',
    )

    const forgery = hostileFixtures.find(
      (one) => one.id === 'forges-instance-id',
    )!
    await press(
      within(fixture(forgery.id)).getByRole('button', {
        name: `Run: ${forgery.label}`,
      }),
    )
    await waitFor(() =>
      expect(fixture(forgery.id).textContent).toContain('active'),
    )

    const thrown = hostileFixtures.find((one) => one.id === 'throws-in-setup')!
    await press(
      within(fixture(thrown.id)).getByRole('button', {
        name: `Run: ${thrown.label}`,
      }),
    )
    await waitFor(() =>
      expect(fixture(thrown.id).textContent).toContain('error'),
    )

    await press(screen.getByRole('button', { name: 'Revert to last good' }))
    await waitFor(() =>
      expect(
        page!.client.pluginList.state.some(
          (entry) => entry.id === 'throws-in-setup',
        ),
      ).toBe(false),
    )
    expect(
      page.client.pluginList.state.some(
        (entry) => entry.id === 'forges-instance-id',
      ),
    ).toBe(true)
  })
})
