import { forgesInstanceIdFixture } from './forges-instance-id'
import { oversizedPayloadFixture } from './oversized-payload'
import { reachesOutsideFixture } from './reaches-outside'
import { smugglesAFunctionFixture } from './smuggles-a-function'
import { spinsFixture } from './spins'
import { throwsInHandlerFixture } from './throws-in-handler'
import { throwsInSetupFixture } from './throws-in-setup'
import type { HostileFixture } from './types'

export { exportCsvFixture, exportCsvSource, exportCsvView } from './export-csv'
export { forgesInstanceIdFixture } from './forges-instance-id'
export { oversizedPayloadFixture } from './oversized-payload'
export { reachesOutsideFixture } from './reaches-outside'
export { requireTitleFixture, requireTitleSource } from './require-title'
export { smugglesAFunctionFixture } from './smuggles-a-function'
export { spinsFixture } from './spins'
export { sortByDueFixture, sortByDueSource } from './sort-by-due'
export { throwsInHandlerFixture } from './throws-in-handler'
export { throwsInSetupFixture } from './throws-in-setup'
export type { HostileFixture, ShowcaseFixture } from './types'

/** The hostile gallery in display order. */
export const hostileFixtures: ReadonlyArray<HostileFixture> = [
  throwsInSetupFixture,
  throwsInHandlerFixture,
  smugglesAFunctionFixture,
  oversizedPayloadFixture,
  forgesInstanceIdFixture,
  reachesOutsideFixture,
  spinsFixture,
]
