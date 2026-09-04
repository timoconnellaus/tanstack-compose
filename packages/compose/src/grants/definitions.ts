import { createStub } from '../host'
import type { StubGrant } from '../host'

/** One server-owned credential attached to an HTTP service request. */
export interface HttpCredential {
  header: string
  value: string
}

/** One service name the HTTP grant may reach. */
export interface HttpService {
  origin: string
  credential?: HttpCredential
}

/** The base-owned service allow-list used by the HTTP grant. */
export type HttpServices = Readonly<Record<string, HttpService>>

/** Structured request options accepted across a host boundary. */
export interface HttpRequestOptions {
  method?: string
  headers?: Readonly<Record<string, string>>
  body?: string | ArrayBuffer
}

/** Structured HTTP response returned across a host boundary. */
export interface HttpGrantResponse {
  status: number
  ok: boolean
  headers: Record<string, string>
  body: string
}

/** Input to `ai.text`. */
export interface AiTextInput {
  prompt: string
  system?: string
}

/** The value returned by `files.get`. */
export interface FileValue {
  body: ArrayBuffer
  contentType?: string
}

/** Operations sent through the storage grant's action dispatch. */
export type StorageOperation =
  | { method: 'get'; key: unknown }
  | { method: 'set'; key: unknown; value: unknown }
  | { method: 'delete'; key: unknown }
  | { method: 'list'; prefix: unknown }

/** Operations sent through the schedule grant's action dispatch. */
export type ScheduleOperation =
  | { method: 'at'; at: unknown; handler: unknown }
  | { method: 'every'; ms: unknown; handler: unknown }
  | { method: 'cancel' }

/** Operations sent through the HTTP grant's action dispatch. */
export interface HttpOperation {
  service: unknown
  path: unknown
  init?: unknown
}

/** Operations sent through the files grant's action dispatch. */
export type FilesOperation =
  | {
      method: 'put'
      key: unknown
      body: unknown
      options?: { contentType?: unknown }
    }
  | { method: 'get'; key: unknown }
  | { method: 'delete'; key: unknown }
  | { method: 'list'; prefix: unknown }

const forwarded = <T>({ input }: { input: T }): T => input

/** Persistent structured-clone-safe key-value storage. */
export const storageStub: StubGrant = createStub({
  name: 'storage',
  declarations: `declare const storage: {
  get<T=unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  list<T=unknown>(prefix?: string): Promise<Record<string, T>>
}`,
  handler: forwarded,
})

/** A single durable alarm that calls a named source export. */
export const scheduleStub: StubGrant = createStub({
  name: 'schedule',
  declarations: `declare const schedule: {
  every(ms: number, handler: string): Promise<void>
  at(when: number | Date, handler: string): Promise<void>
  cancel(): Promise<void>
}`,
  handler: forwarded,
})

/** HTTP access through base-named services and server-owned credentials. */
export const httpStub: StubGrant = createStub({
  name: 'http',
  declarations: `interface HttpGrantResponse {
  status: number
  ok: boolean
  headers: Record<string, string>
  body: string
}
declare const http: {
  fetch(service: string, path: string, init?: {
    method?: string
    headers?: Record<string, string>
    body?: string | ArrayBuffer
  }): Promise<HttpGrantResponse>
}`,
  handler: forwarded,
})

/** Text generation through the host's own model provider. */
export const aiStub: StubGrant = createStub({
  name: 'ai',
  declarations: `declare const ai: {
  text(input: { prompt: string; system?: string }): Promise<string>
}`,
  handler: forwarded,
})

/** Object storage scoped to the calling plugin entry. */
export const filesStub: StubGrant = createStub({
  name: 'files',
  declarations: `interface Blob {
  readonly type: string
  arrayBuffer(): Promise<ArrayBuffer>
}
declare const files: {
  put(key: string, body: Blob | string | ArrayBuffer, options?: { contentType?: string }): Promise<void>
  get(key: string): Promise<{ body: ArrayBuffer; contentType?: string } | undefined>
  delete(key: string): Promise<void>
  list(prefix?: string): Promise<Array<string>>
}`,
  handler: forwarded,
})
