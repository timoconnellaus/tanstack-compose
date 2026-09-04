import type { ReactNode } from 'react'

const unavailable = (): ReactNode => {
  throw new Error('showcase: browser-only mode is not in this deployment')
}

/** Unreachable production placeholder selected instead of the S1 client. */
export const BrowserTableApp = unavailable

/** Unreachable production placeholder selected instead of the S1 client. */
export const BrowserTodoApp = unavailable

/** Unreachable production placeholder selected instead of the S1 client. */
export const BrowserHostileApp = unavailable

/** Unreachable production placeholder selected instead of the S1 client. */
export const BrowserPairApp = unavailable

/** Unreachable production placeholder selected instead of the S1 client. */
export const BrowserUpgradeApp = unavailable
