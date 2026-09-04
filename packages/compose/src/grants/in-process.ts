import type {
  InProcessGrant,
  InProcessGrantContext,
  InProcessGrantInstance,
} from '../host'
import type {
  AiTextInput,
  FileValue,
  FilesOperation,
  HttpGrantResponse,
  HttpOperation,
  HttpRequestOptions,
  HttpServices,
  ScheduleOperation,
  StorageOperation,
} from './definitions'

/** Options for the standard grants' in-process reference implementation. */
export interface InProcessGrantsOptions {
  services?: HttpServices
  respond?: (input: AiTextInput) => string | Promise<string>
  fetch?: typeof fetch
}

interface LocalAlarm {
  at: number
  every?: number
  handler: string
}

interface LocalState {
  values: Map<string, unknown>
  alarm?: LocalAlarm
  timer?: ReturnType<typeof setTimeout>
  call?: InProcessGrantContext['call']
}

const string = (value: unknown, what: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`@tanstack/compose: ${what} must be a string`)
  }
  return value
}

const operation = <T>(value: unknown): T => value as T
const clone = <T>(value: T): T =>
  typeof structuredClone === 'function' ? structuredClone(value) : value

const method = <T extends { method: string }, TMethod extends T['method']>(
  input: T,
  expected: TMethod,
): Extract<T, { method: TMethod }> => {
  if (input.method !== expected) {
    throw new Error(`@tanstack/compose: expected ${expected} grant operation`)
  }
  return input as Extract<T, { method: TMethod }>
}

const armAlarm = (state: LocalState): void => {
  clearTimeout(state.timer)
  if (!state.alarm || !state.call) return
  state.timer = setTimeout(
    () => {
      const alarm = state.alarm
      if (!alarm) return
      if (alarm.every === undefined) delete state.alarm
      else alarm.at = Date.now() + alarm.every
      void state.call?.(alarm.handler, { scheduledAt: Date.now() }).then(
        () => armAlarm(state),
        () => armAlarm(state),
      )
    },
    Math.max(0, state.alarm.at - Date.now()),
  )
}

const storageGrant = (): InProcessGrant => {
  const states = new Map<string, LocalState>()
  return {
    start(context): InProcessGrantInstance {
      const fresh = !states.has(context.instanceId)
      const state = states.get(context.instanceId) ?? { values: new Map() }
      states.set(context.instanceId, state)
      return {
        value: Object.freeze({
          get: async (key: unknown) => {
            const input = operation<StorageOperation>(
              await context.invoke({ method: 'get', key }),
            )
            return clone(
              state.values.get(string(method(input, 'get').key, 'storage key')),
            )
          },
          set: async (key: unknown, value: unknown) => {
            const input = operation<StorageOperation>(
              await context.invoke({ method: 'set', key, value }),
            )
            const write = method(input, 'set')
            state.values.set(string(write.key, 'storage key'), write.value)
          },
          delete: async (key: unknown) => {
            const input = operation<StorageOperation>(
              await context.invoke({ method: 'delete', key }),
            )
            return state.values.delete(
              string(method(input, 'delete').key, 'storage key'),
            )
          },
          list: async (prefix: unknown = '') => {
            const input = operation<StorageOperation>(
              await context.invoke({ method: 'list', prefix }),
            )
            const start = string(method(input, 'list').prefix, 'storage prefix')
            const result: Record<string, unknown> = {}
            for (const [key, value] of state.values) {
              if (key.startsWith(start)) result[key] = clone(value)
            }
            return result
          },
        }),
        failed: fresh
          ? () => {
              states.delete(context.instanceId)
            }
          : undefined,
        destroy: () => {
          states.delete(context.instanceId)
        },
      }
    },
  }
}

const scheduleGrant = (): InProcessGrant => {
  const states = new Map<string, LocalState>()
  return {
    start(context): InProcessGrantInstance {
      const fresh = !states.has(context.instanceId)
      const state: LocalState = states.get(context.instanceId) ?? {
        values: new Map(),
      }
      states.set(context.instanceId, state)

      const change = async (given: ScheduleOperation): Promise<void> => {
        const input = operation<ScheduleOperation>(await context.invoke(given))
        if (input.method === 'cancel') {
          delete state.alarm
          clearTimeout(state.timer)
          return
        }
        let at: unknown
        let every: number | undefined
        if (input.method === 'every') {
          if (!Number.isFinite(input.ms) || Number(input.ms) <= 0) {
            throw new Error('@tanstack/compose: interval must be >0')
          }
          every = Number(input.ms)
          at = Date.now() + every
        } else {
          at = input.at
        }
        if (
          typeof at !== 'number' ||
          !Number.isFinite(at) ||
          typeof input.handler !== 'string' ||
          input.handler === ''
        ) {
          throw new Error(
            '@tanstack/compose: schedule needs a time and named export',
          )
        }
        state.alarm = {
          at,
          handler: input.handler,
          ...(every ? { every } : {}),
        }
        armAlarm(state)
      }

      return {
        value: Object.freeze({
          every: (ms: unknown, handler: unknown) =>
            change({ method: 'every', ms, handler }),
          at: (when: number | Date, handler: unknown) =>
            change({
              method: 'at',
              at: when instanceof Date ? when.getTime() : when,
              handler,
            }),
          cancel: () => change({ method: 'cancel' }),
        }),
        ready: () => {
          state.call = context.call
          armAlarm(state)
        },
        stop: () => {
          state.call = undefined
          clearTimeout(state.timer)
        },
        failed: fresh
          ? () => {
              clearTimeout(state.timer)
              states.delete(context.instanceId)
            }
          : undefined,
        destroy: () => {
          clearTimeout(state.timer)
          states.delete(context.instanceId)
        },
      }
    },
  }
}

const httpGrant = (
  services: HttpServices,
  doFetch: typeof fetch,
): InProcessGrant => ({
  start(context) {
    return {
      value: Object.freeze({
        fetch: async (
          service: unknown,
          path: unknown,
          init?: unknown,
        ): Promise<HttpGrantResponse> => {
          const input = operation<HttpOperation>(
            await context.invoke({ service, path, init }),
          )
          const name = string(input.service, 'HTTP service')
          const policy = services[name]
          if (!policy) throw new Error(`no service named "${name}" is granted`)
          const base = new URL(policy.origin)
          const url = new URL(string(input.path, 'HTTP path'), base)
          if (url.origin !== base.origin) {
            throw new Error(`HTTP path leaves the granted "${name}" origin`)
          }
          const request = (input.init ?? {}) as HttpRequestOptions
          const headers = new Headers(request.headers)
          if (policy.credential) {
            headers.set(policy.credential.header, policy.credential.value)
          }
          const response = await doFetch(url, { ...request, headers })
          return {
            status: response.status,
            ok: response.ok,
            headers: Object.fromEntries(response.headers),
            body: await response.text(),
          }
        },
      }),
    }
  },
})

const aiGrant = (
  respond: NonNullable<InProcessGrantsOptions['respond']>,
): InProcessGrant => ({
  start(context) {
    return {
      value: Object.freeze({
        text: async (given: unknown): Promise<string> => {
          const input = operation<AiTextInput>(await context.invoke(given))
          if (typeof input.prompt !== 'string') {
            throw new Error('@tanstack/compose: ai.text needs a prompt')
          }
          if (input.system !== undefined && typeof input.system !== 'string') {
            throw new Error(
              '@tanstack/compose: ai.text system must be a string',
            )
          }
          return await respond(input)
        },
      }),
    }
  },
})

const bytes = async (value: unknown): Promise<ArrayBuffer> => {
  if (typeof value === 'string') return new TextEncoder().encode(value).buffer
  if (value instanceof ArrayBuffer) return value
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return await value.arrayBuffer()
  }
  throw new Error(
    '@tanstack/compose: file body must be text, Blob or ArrayBuffer',
  )
}

const filesGrant = (): InProcessGrant => {
  const objects = new Map<string, FileValue>()
  return {
    start(context) {
      const prefix = `${context.instanceId}/`
      const key = (value: unknown) => `${prefix}${string(value, 'file key')}`
      const fresh = ![...objects.keys()].some((name) => name.startsWith(prefix))
      const removeAll = () => {
        for (const name of objects.keys()) {
          if (name.startsWith(prefix)) objects.delete(name)
        }
      }
      return {
        value: Object.freeze({
          put: async (name: unknown, body: unknown, options?: unknown) => {
            const input = operation<FilesOperation>(
              await context.invoke({ method: 'put', key: name, body, options }),
            )
            if (input.method !== 'put') return
            const contentType = input.options?.contentType
            if (contentType !== undefined && typeof contentType !== 'string') {
              throw new Error(
                '@tanstack/compose: file contentType must be a string',
              )
            }
            objects.set(key(input.key), {
              body: await bytes(input.body),
              ...(contentType === undefined ? {} : { contentType }),
            })
          },
          get: async (name: unknown) => {
            const input = operation<FilesOperation>(
              await context.invoke({ method: 'get', key: name }),
            )
            return clone(objects.get(key(method(input, 'get').key)))
          },
          delete: async (name: unknown) => {
            const input = operation<FilesOperation>(
              await context.invoke({ method: 'delete', key: name }),
            )
            objects.delete(key(method(input, 'delete').key))
          },
          list: async (given: unknown = '') => {
            const input = operation<FilesOperation>(
              await context.invoke({ method: 'list', prefix: given }),
            )
            const start = key(method(input, 'list').prefix)
            return [...objects.keys()]
              .filter((name) => name.startsWith(start))
              .map((name) => name.slice(prefix.length))
              .sort()
          },
        }),
        failed: fresh ? removeAll : undefined,
        destroy: removeAll,
      }
    },
  }
}

/** Build the standard named grants for {@link createInProcessHost}. */
export function createInProcessGrants(
  options: InProcessGrantsOptions = {},
): Readonly<Record<string, InProcessGrant>> {
  return {
    storage: storageGrant(),
    schedule: scheduleGrant(),
    http: httpGrant(options.services ?? {}, options.fetch ?? fetch),
    ai: aiGrant(options.respond ?? ((input) => input.prompt)),
    files: filesGrant(),
  }
}
