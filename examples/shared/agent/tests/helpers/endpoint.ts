import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')

/** One recorded server-sent-event body, as the endpoint really answers. */
export const fixture = (name: string): string =>
  readFileSync(join(fixtures, `${name}.sse.txt`), 'utf8')

/** What one intercepted call to the endpoint looked like. */
interface RecordedCall {
  url: string
  headers: Record<string, string>
  body: Record<string, any>
  signal: AbortSignal | undefined
}

/**
 * Stand in for the endpoint: replay a recorded body in small pieces, so the
 * provider's framing has to cope with events split across chunks.
 */
export const mockEndpoint = (
  answer:
    | { sse: string; sliceAt?: number; hold?: boolean }
    | { status: number; body: string }
    | { failWith: Error },
) => {
  const calls: Array<RecordedCall> = []
  const original = globalThis.fetch

  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, any>,
      signal: init.signal ?? undefined,
    })
    if ('failWith' in answer) return Promise.reject(answer.failWith)
    if ('status' in answer) {
      return Promise.resolve(
        new Response(answer.body, { status: answer.status }),
      )
    }

    const encoder = new TextEncoder()
    const size = answer.sliceAt ?? 17
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < answer.sse.length; at += size) {
          controller.enqueue(encoder.encode(answer.sse.slice(at, at + size)))
        }
        // A held stream never ends on its own: only the reader's timer does.
        if (!answer.hold) controller.close()
      },
    })
    return Promise.resolve(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )
  }) as unknown as typeof fetch

  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}
