import type { AnyStubGrant } from '@tanstack/compose'
import type { ComposeValue } from '@tanstack/start-compose'

/** Source and grants for one pre-designed written plugin. */
export interface ShowcaseFixture {
  id: string
  source: string
  view?: string
  options?: ComposeValue
  stubs: ReadonlyArray<AnyStubGrant>
  /** Persisted catalog names when they differ from the stubs' public names. */
  serializedStubs?: ReadonlyArray<string>
}

/** A hostile fixture and the S1 behavior its page explains. */
export interface HostileFixture extends ShowcaseFixture {
  label: string
  expected: string
  /** What the deployed facet host proves when S1 intentionally differs. */
  deployedExpected?: string
  disabled?: boolean
  call?: string
}
