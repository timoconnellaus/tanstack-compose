import type { AnyStubGrant } from '@tanstack/compose'

/** Source and grants for one pre-designed written plugin. */
export interface ShowcaseFixture {
  id: string
  source: string
  view?: string
  stubs: ReadonlyArray<AnyStubGrant>
}

/** A hostile fixture and the S1 behavior its page explains. */
export interface HostileFixture extends ShowcaseFixture {
  label: string
  expected: string
  disabled?: boolean
  call?: string
}
