import { WorkerEntrypoint } from 'cloudflare:workers'
import { resolveStub } from './registry'

/**
 * What a loopback carries about the call it is for. The loader Worker mints the
 * loopback with these; the Dynamic Worker holding it never sees them, so a
 * hosted plugin can neither read nor forge the identity its calls arrive under.
 */
export interface StubProps {
  /** Which host granted the stub. */
  readonly hostId: string
  /** The hosted instance the call is attributed to. */
  readonly instanceId: string
  /** Which of the instance's granted stubs this loopback is. */
  readonly stub: string
}

/**
 * What a loopback answers with. An envelope rather than a throw, so a refused
 * or revoked call is ordinary data on the wire and becomes an exception only
 * where the plugin's own code can catch it.
 */
export interface StubAnswer {
  ok: boolean
  value?: unknown
  message?: string
}

const maxLoopbackBytes = 1024 * 1024
const payloadBytes = (value: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

const tooLarge = (value: unknown): StubAnswer | undefined =>
  payloadBytes(value) > maxLoopbackBytes
    ? {
        ok: false,
        message: `stub payload exceeds the ${maxLoopbackBytes}-byte loopback limit`,
      }
    : undefined

/**
 * The one entrypoint a hosted plugin can reach: a stub, arriving as a loopback
 * binding in the Dynamic Worker's `env` (ADR-0005). Re-export it from your
 * loader Worker's entry module so `exports` can mint it:
 *
 * @example
 * ```ts
 * export { ComposeStubLoopback } from '@tanstack/compose-cloudflare'
 * ```
 */
export class ComposeStubLoopback extends WorkerEntrypoint {
  /**
   * Dispatch one stub call on the client side, under the instance id the props
   * carry rather than anything the caller supplied.
   */
  async stubCall(input: unknown): Promise<StubAnswer> {
    const refused = tooLarge(input)
    if (refused) return refused
    const props = this.ctx.props as StubProps | undefined
    if (!props) {
      return {
        ok: false,
        message:
          '@tanstack/compose-cloudflare: a stub loopback was called without props; mint it through the host',
      }
    }
    const stub = resolveStub(props.hostId, props.instanceId, props.stub)
    if (!stub) {
      return {
        ok: false,
        message: `@tanstack/compose-cloudflare: stub "${props.stub}" was revoked when instance "${props.instanceId}" stopped`,
      }
    }
    try {
      const value = await stub(input)
      return tooLarge(value) ?? { ok: true, value }
    } catch (error) {
      const message = (error as { message?: unknown } | null)?.message
      return {
        ok: false,
        message: typeof message === 'string' ? message : String(error),
      }
    }
  }
}
