import {
  createPlugin,
  sourceCheckerKey,
  sourceErrorOf,
  stubDeclarations,
} from '@tanstack/compose'
import { jsonSchemaValidator } from './json-schema'
import { modelKey, toolsKey } from './keys'
import { createTool } from './tools'
import type {
  AnyPlugin,
  AnyStubGrant,
  Client,
  PluginEntry,
  SourceDiagnostic,
  SourceError,
  StandardSchemaIssue,
  StandardSchemaV1,
  Status,
} from '@tanstack/compose'
import type { JsonSchema } from './json-schema'
import type { AnyTool } from './types'

// ------------------------------------------------------------------- results

/** One row of a composer tool's result: a **plugin entry** as it now reads. */
export interface ComposerEntry {
  id: string
  /** The plugin's name, or `source` for an entry that carries plugin source. */
  plugin: string
  kind: 'plugin' | 'source'
  enabled: boolean
  /** Whether the agent may change this entry at all. */
  protected: boolean
  /** `disabled` when the entry is in the list but not running. */
  status: Status | 'disabled'
  /** The context keys it is still waiting for. Present when `pending`. */
  missing?: Array<string>
  /** Why it failed. Present when `error`. */
  error?: string
  /** The detail of a plugin-source failure. Present when `error` on a source entry. */
  sourceError?: SourceError
  /** Whether the agent may read this entry's source back. */
  readable?: boolean
}

/**
 * What every composer **tool** returns — one shape for every tool, and for
 * every way one can fail, so the model corrects and retries through a single
 * recovery loop.
 */
export interface ComposerResult {
  /** Whether the edit happened. `false` means nothing changed. */
  ok: boolean
  /** What happened, in one sentence. */
  message: string
  /** Why it was refused or how it failed. Absent when `ok`. */
  error?: string
  /** The entries this edit touched, as they read once the client settled. */
  entries: Array<ComposerEntry>
  /** When the change reaches the model. */
  effect?: string
  /** The names the plugin catalog offers. */
  catalog?: Array<string>
  /** The entry's plugin source. */
  source?: string
  /** The declarations plugin source is checked against and written against. */
  declarations?: string
  /** Everything the source checker said, when the check is what failed. */
  diagnostics?: Array<SourceDiagnostic>
  /** The registered model providers. */
  providers?: Array<string>
  /** The provider the next turn will use. */
  selected?: string
}

// ------------------------------------------------------------------- options

/** What an operator hands the composer when assembling the client. */
export interface ComposerOptionsInput {
  /** Pre-built plugins the agent may add, by name. */
  catalog?: Record<string, AnyPlugin>
  /** Entry ids the agent cannot change. The composer's own id is always one. */
  protected?: ReadonlyArray<string>
  /** The stubs every plugin the agent writes is granted. */
  stubs?: ReadonlyArray<AnyStubGrant>
  /** The host plugins the agent writes run in. Defaults to the in-process host. */
  host?: string
}

interface ComposerOptions {
  catalog: Record<string, AnyPlugin>
  protected: Array<string>
  stubs: Array<AnyStubGrant>
  host: string | undefined
}

/**
 * The composer's own options are the operator's half of the contract (B4), so
 * they are validated rather than trusted: a catalog of real plugins, a list of
 * ids, a list of stub grants, and the name of a host.
 */
const composerOptions: StandardSchemaV1<
  ComposerOptionsInput | undefined,
  ComposerOptions
> = {
  '~standard': {
    version: 1,
    vendor: 'compose-agent',
    validate: (value: unknown) => {
      const input = (value ?? {}) as ComposerOptionsInput
      const issues: Array<StandardSchemaIssue> = []
      const catalog: Record<string, AnyPlugin> = {}
      const isObject = (one: unknown): boolean =>
        typeof one === 'object' && one !== null && !Array.isArray(one)

      if (input.catalog !== undefined) {
        if (!isObject(input.catalog)) {
          issues.push({
            message: 'expected an object of plugins by name',
            path: ['catalog'],
          })
        } else {
          for (const [name, plugin] of Object.entries(input.catalog)) {
            if (
              (plugin as { type?: unknown } | null)?.type !== 'compose/plugin'
            ) {
              issues.push({
                message: 'expected a plugin created by createPlugin',
                path: ['catalog', name],
              })
            } else {
              catalog[name] = plugin
            }
          }
        }
      }

      if (input.protected !== undefined && !Array.isArray(input.protected)) {
        issues.push({
          message: 'expected an array of entry ids',
          path: ['protected'],
        })
      }
      const guarded = Array.isArray(input.protected) ? [...input.protected] : []
      guarded.forEach((id, index) => {
        if (typeof id !== 'string' || id === '') {
          issues.push({
            message: 'expected a non-empty entry id',
            path: ['protected', index],
          })
        }
      })

      if (input.stubs !== undefined && !Array.isArray(input.stubs)) {
        issues.push({
          message: 'expected an array of stub grants',
          path: ['stubs'],
        })
      }
      const stubs = Array.isArray(input.stubs) ? [...input.stubs] : []
      stubs.forEach((grant, index) => {
        if ((grant as { type?: unknown } | null)?.type !== 'compose/stub') {
          issues.push({
            message: 'expected a stub grant created by createStub',
            path: ['stubs', index],
          })
        }
      })

      if (input.host !== undefined && typeof input.host !== 'string') {
        issues.push({ message: 'expected a host name', path: ['host'] })
      }

      if (issues.length > 0) return { issues }
      return {
        value: {
          catalog,
          protected: guarded,
          stubs,
          host: input.host,
        },
      }
    },
  },
}

// ------------------------------------------------------------------- helpers

const messageOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error)

const issuesOf = (issues: ReadonlyArray<StandardSchemaIssue>): string =>
  issues
    .map((issue) => {
      const path = (issue.path ?? [])
        .map((segment) =>
          typeof segment === 'object' ? String(segment.key) : String(segment),
        )
        .join('.')
      return path === '' ? issue.message : `${path}: ${issue.message}`
    })
    .join('; ')

/** The two ways an edit reaches the model, in the words agent.md C3 uses. */
const nextTurn =
  'Takes effect from the next turn: a turn takes its tools and prompt sections when it opens, so what changed here is offered to the model from the next turn onwards.'
const atOnce =
  'Takes effect at the next turn open, and nothing restarts to make it happen.'

const idSchema: JsonSchema = {
  type: 'string',
  description: 'The plugin entry id.',
}

/**
 * One JSON Schema is both the `parameters` the model is shown and the
 * `validator` its arguments are checked against, so the two can never drift.
 */
const args = <TArgs>(schema: JsonSchema) => ({
  parameters: schema as unknown as Record<string, unknown>,
  validator: jsonSchemaValidator<TArgs>(schema),
})

// --------------------------------------------------------------- the plugin

/**
 * The **composer**: the plugin that hands the model **tools** for editing the
 * **plugin list** of its own **client**, including writing plugins as **plugin
 * source**.
 *
 * Every tool acts through the client's plugin list and nothing else, waits for
 * the client to settle, and reports the entries the edit touched with their
 * status — so the model sees the consequence of what it did in the same step.
 * Which entries are **protected**, what the **plugin catalog** contains, which
 * **stubs** a written plugin receives and which **host** it runs in are all
 * decided here, by the operator; nothing the model can call changes them.
 *
 * @example
 * ```ts
 * {
 *   id: 'composer',
 *   plugin: composerPlugin,
 *   options: {
 *     catalog: { clock: clockPlugin },
 *     protected: ['session', 'tools', 'prompt', 'models', 'loop'],
 *     stubs: agentStubs,
 *   },
 * }
 * ```
 */
export const composerPlugin = createPlugin({
  name: 'composer',
  deps: [toolsKey, modelKey],
  validator: composerOptions,
  setup(instance, options) {
    const client: Client = instance.client
    const registry = instance.context.get(toolsKey)
    const models = instance.context.get(modelKey)

    /** Entries the agent wrote as source; only these can be read or rewritten. */
    const written = new Set<string>()
    /** Entries the agent added from the catalog; only these can be removed. */
    const added = new Set<string>()
    /** The source the agent last read back, per entry: the read gate's memory. */
    const observed = new Map<string, string>()

    const list = (): Array<PluginEntry> => client.pluginList.state
    const entryOf = (id: string): PluginEntry | undefined =>
      list().find((entry) => entry.id === id)

    const isProtected = (id: string): boolean =>
      id === instance.id || options.protected.includes(id)

    /**
     * The declarations an entry's source is checked against and the model is
     * shown (D8). They are a function of the entry's granted stubs, so what
     * type-checks is what runs. When the client has a source checker that
     * publishes its own text — a base declaration file, a synthesized `stubs`
     * type — that text _is_ the check, so it is what the model is shown; a
     * checker that compiles the grant text as given, and a client with no
     * checker at all, get the concatenation the kernel would use.
     */
    const declarationsFor = (grants: ReadonlyArray<AnyStubGrant> | undefined) =>
      instance.context.peek(sourceCheckerKey)?.declarations?.(
        (grants ?? []).map((grant) => ({
          name: grant.name,
          declarations: grant.declarations,
        })),
      ) ?? stubDeclarations(grants)

    // -------------------------------------------------------------- reporting

    const statusOf = (id: string): Status | 'disabled' => {
      const entry = entryOf(id)
      if (!entry) return 'removed'
      if (entry.enabled === false) return 'disabled'
      return client.inspect().find((one) => one.id === id)?.status ?? 'removed'
    }

    const report = (id: string): ComposerEntry => {
      const entry = entryOf(id)
      const snapshot = client.inspect().find((one) => one.id === id)
      const kind = entry?.source === undefined ? 'plugin' : 'source'
      const status = statusOf(id)
      const row: ComposerEntry = {
        id,
        plugin:
          entry === undefined
            ? 'removed'
            : kind === 'source'
              ? 'source'
              : (entry.plugin?.name ?? 'unknown'),
        kind,
        enabled: entry !== undefined && entry.enabled !== false,
        protected: isProtected(id),
        status,
      }
      if (status === 'pending') row.missing = snapshot?.missing ?? []
      if (status === 'error') {
        row.error = messageOf(snapshot?.error)
        const detail = sourceErrorOf(snapshot?.error)
        if (detail) row.sourceError = detail
      }
      if (kind === 'source') row.readable = written.has(id)
      return row
    }

    /**
     * The entries an edit touched: the ones it named, plus every entry the edit
     * left `pending` or in `error`, so a consequence somewhere else in the list
     * shows up in the same result (A3, C1). In plugin-list order.
     */
    const rowsFor = (targets: ReadonlyArray<string>): Array<ComposerEntry> => {
      const ids: Array<string> = []
      for (const entry of list()) {
        const status = statusOf(entry.id)
        if (
          targets.includes(entry.id) ||
          status === 'pending' ||
          status === 'error'
        ) {
          ids.push(entry.id)
        }
      }
      return ids.map(report)
    }

    const failure = (
      message: string,
      targets: ReadonlyArray<string> = [],
      extra: Partial<ComposerResult> = {},
    ): ComposerResult => ({
      ok: false,
      message,
      error: message,
      entries: rowsFor(targets),
      ...extra,
    })

    // ----------------------------------------------------------- the one path

    /**
     * The only way any of these tools changes what runs: write the plugin list
     * and wait for the client to settle. A reconcile that fails leaves the
     * client as it was and comes back as a message (A2, C3).
     */
    const apply = async (
      next: Array<PluginEntry>,
    ): Promise<string | undefined> => {
      try {
        await client.setPluginList(next)
        await client.settled()
        return undefined
      } catch (error) {
        await client.settled()
        return messageOf(error)
      }
    }

    /** Validate options against the plugin's own validator before adding (B3). */
    const optionsProblem = async (
      plugin: AnyPlugin | undefined,
      value: unknown,
    ): Promise<string | undefined> => {
      const validator = plugin?.validator
      if (!validator) return undefined
      const result = await validator['~standard'].validate(value)
      return result.issues ? issuesOf(result.issues) : undefined
    }

    // ---------------------------------------------------------------- tools

    const listTool = createTool({
      name: 'list_plugins',
      description:
        'List the plugin list of this agent: every entry with its status, the deps it is still missing when pending, whether it is protected, the names the plugin catalog offers, and the declarations a plugin written with write_plugin is checked against.',
      ...args<Record<string, never>>({ type: 'object', properties: {} }),
      concurrency: 'exclusive',
      execute: (): ComposerResult => ({
        ok: true,
        message: 'The plugin list, as it runs now.',
        entries: list().map((entry) => report(entry.id)),
        catalog: Object.keys(options.catalog),
        // The declarations a plugin written here is checked against. They are
        // on the listing because a first write has no entry to read back, and
        // the model has to be able to see them before it writes (D8).
        declarations: declarationsFor(options.stubs),
      }),
    })

    const setEnabled = async (
      id: string,
      enabled: boolean,
    ): Promise<ComposerResult> => {
      const entry = entryOf(id)
      if (!entry) return failure(`there is no plugin entry "${id}"`, [id])
      if (isProtected(id)) {
        return failure(`the entry "${id}" is protected and cannot be changed`, [
          id,
        ])
      }
      if ((entry.enabled !== false) === enabled) {
        return {
          ok: true,
          message: `the entry "${id}" is already ${enabled ? 'enabled' : 'disabled'}`,
          entries: rowsFor([id]),
        }
      }
      const problem = await apply(
        list().map((one) => (one.id === id ? { ...one, enabled } : one)),
      )
      if (problem) return failure(problem, [id])
      return {
        ok: true,
        message: `the entry "${id}" is now ${enabled ? 'enabled' : 'disabled'}`,
        entries: rowsFor([id]),
        effect: nextTurn,
      }
    }

    const enableTool = createTool({
      name: 'enable_plugin',
      description:
        'Enable a disabled plugin entry. Its dependents start again as soon as it is active. Takes effect from the next turn.',
      ...args<{ id: string }>({
        type: 'object',
        properties: { id: idSchema },
        required: ['id'],
      }),
      concurrency: 'exclusive',
      execute: ({ id }) => setEnabled(id, true),
    })

    const disableTool = createTool({
      name: 'disable_plugin',
      description:
        'Disable a plugin entry, which is equivalent to removing it: anything that depends on what it provides goes pending, and the result names what each of them is missing. Protected entries are refused. Takes effect from the next turn.',
      ...args<{ id: string }>({
        type: 'object',
        properties: { id: idSchema },
        required: ['id'],
      }),
      concurrency: 'exclusive',
      execute: ({ id }) => setEnabled(id, false),
    })

    const setOptionsTool = createTool({
      name: 'set_plugin_options',
      description:
        "Replace a plugin entry's options. The options are validated by that plugin's own validator first; invalid options change nothing. The instance restarts with the new options, so anything it held is released and re-acquired. Protected entries are refused.",
      ...args<{ id: string; options: unknown }>({
        type: 'object',
        properties: {
          id: idSchema,
          options: { type: 'object', description: 'The whole options object.' },
        },
        required: ['id', 'options'],
      }),
      concurrency: 'exclusive',
      execute: async ({ id, options: next }): Promise<ComposerResult> => {
        const entry = entryOf(id)
        if (!entry) return failure(`there is no plugin entry "${id}"`, [id])
        if (isProtected(id)) {
          return failure(
            `the entry "${id}" is protected and cannot be changed`,
            [id],
          )
        }
        const problem = await optionsProblem(entry.plugin, next)
        if (problem) {
          return failure(`invalid options for "${id}" — ${problem}`, [id])
        }
        const failed = await apply(
          list().map((one) =>
            one.id === id ? { ...one, options: next } : one,
          ),
        )
        if (failed) return failure(failed, [id])
        return {
          ok: true,
          message: `the entry "${id}" restarted with its new options`,
          entries: rowsFor([id]),
          effect: nextTurn,
        }
      },
    })

    const addTool = createTool({
      name: 'add_plugin',
      description:
        "Add a plugin from the plugin catalog by name, under a new entry id. Only catalog names can be added, and the options are validated by that plugin's validator; an unknown name or invalid options change nothing. Takes effect from the next turn.",
      ...args<{ id: string; name: string; options?: unknown }>({
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The entry id to give it. Must be unused.',
          },
          name: {
            type: 'string',
            description: 'The catalog name of the plugin.',
          },
          options: { type: 'object', description: "The plugin's options." },
        },
        required: ['id', 'name'],
      }),
      concurrency: 'exclusive',
      execute: async ({
        id,
        name,
        options: given,
      }): Promise<ComposerResult> => {
        const plugin = Object.prototype.hasOwnProperty.call(
          options.catalog,
          name,
        )
          ? options.catalog[name]
          : undefined
        if (!plugin) {
          return failure(
            `there is no plugin named "${name}" in the catalog; it offers ${
              Object.keys(options.catalog).join(', ') || 'nothing'
            }`,
            [],
            { catalog: Object.keys(options.catalog) },
          )
        }
        if (entryOf(id)) {
          return failure(`the entry id "${id}" is already in the plugin list`, [
            id,
          ])
        }
        if (isProtected(id)) {
          return failure(
            `the entry id "${id}" is protected and cannot be used`,
            [id],
          )
        }
        const problem = await optionsProblem(plugin, given)
        if (problem) {
          return failure(`invalid options for "${name}" — ${problem}`)
        }
        const failed = await apply([
          ...list(),
          { id, plugin, ...(given === undefined ? {} : { options: given }) },
        ])
        if (failed) return failure(failed, [id])
        added.add(id)
        return {
          ok: true,
          message: `added "${name}" from the catalog as the entry "${id}"`,
          entries: rowsFor([id]),
          effect: nextTurn,
        }
      },
    })

    const writeTool = createTool({
      name: 'write_plugin',
      description:
        "Write a plugin as TypeScript source and start it, either as a new entry or as a rewrite of one this agent wrote. The source is an ES module whose default export is the setup function and whose other exports are the handlers it registers; read_plugin shows the declarations it is checked against. A rewrite is refused unless read_plugin was called for that entry and its source has not changed since. A rewrite runs the previous code's cleanups first, so nothing it registered survives. Takes effect from the next turn.",
      ...args<{ id: string; source: string }>({
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The entry id to write.' },
          source: { type: 'string', description: 'The whole module source.' },
        },
        required: ['id', 'source'],
      }),
      concurrency: 'exclusive',
      execute: async ({ id, source }): Promise<ComposerResult> => {
        const declarations = declarationsFor(options.stubs)
        const existing = entryOf(id)
        if (existing) {
          if (isProtected(id)) {
            return failure(
              `the entry "${id}" is protected and cannot be changed`,
              [id],
            )
          }
          if (!written.has(id)) {
            return failure(
              `the entry "${id}" was not written by this agent, so it cannot be rewritten`,
              [id],
            )
          }
          const seen = observed.get(id)
          if (seen === undefined) {
            return failure(
              `read the source of "${id}" with read_plugin before rewriting it`,
              [id],
            )
          }
          if (seen !== existing.source) {
            observed.delete(id)
            return failure(
              `the source of "${id}" has changed since you read it; read it again and try again`,
              [id],
            )
          }
        } else if (isProtected(id)) {
          return failure(
            `the entry id "${id}" is protected and cannot be used`,
            [id],
          )
        }

        // Check before the list is touched, so source that does not check
        // leaves the entry exactly as it was (D7).
        const checker = instance.context.peek(sourceCheckerKey)
        if (checker) {
          const checked = await checker.check({
            instanceId: id,
            source,
            declarations,
            grants: options.stubs.map((grant) => ({
              name: grant.name,
              declarations: grant.declarations,
            })),
          })
          if (typeof checked.code !== 'string') {
            const diagnostics = checked.diagnostics ?? []
            return failure(
              diagnostics
                .map((one) =>
                  one.line === undefined
                    ? one.message
                    : `${one.line}:${one.column ?? 0} ${one.message}`,
                )
                .join('; ') || 'the source checker rejected this source',
              [id],
              { diagnostics, declarations },
            )
          }
        }

        const entry: PluginEntry = {
          id,
          source,
          ...(options.host === undefined ? {} : { host: options.host }),
          stubs: options.stubs,
          ...(existing?.options === undefined
            ? {}
            : { options: existing.options }),
        }
        const failed = await apply(
          existing
            ? list().map((one) => (one.id === id ? entry : one))
            : [...list(), entry],
        )
        // The entry is the agent's either way: a rewrite that failed to start
        // still replaced what was there, and the agent has to fix it.
        written.add(id)
        // Whatever the entry now holds, the agent has not read it back.
        observed.delete(id)
        if (failed) return failure(failed, [id], { declarations })
        const row = report(id)
        if (row.status === 'error') {
          return {
            ok: false,
            message: `the source of "${id}" did not start`,
            error: row.error ?? 'the source did not start',
            entries: rowsFor([id]),
            declarations,
            ...(row.sourceError?.diagnostics
              ? { diagnostics: row.sourceError.diagnostics }
              : {}),
          }
        }
        return {
          ok: true,
          message: existing
            ? `rewrote the entry "${id}"`
            : `wrote the entry "${id}"`,
          entries: rowsFor([id]),
          effect: nextTurn,
        }
      },
    })

    const readTool = createTool({
      name: 'read_plugin',
      description:
        'Read back the source of an entry this agent wrote, with the declarations it is checked against and its current status and error. Reading is what unlocks rewriting it with write_plugin.',
      ...args<{ id: string }>({
        type: 'object',
        properties: { id: idSchema },
        required: ['id'],
      }),
      concurrency: 'exclusive',
      execute: ({ id }): ComposerResult => {
        const entry = entryOf(id)
        if (!entry) return failure(`there is no plugin entry "${id}"`, [id])
        if (entry.source === undefined) {
          return failure(
            `the entry "${id}" is a plugin from the assembly or the catalog and has no source to read`,
            [id],
          )
        }
        if (!written.has(id)) {
          return failure(
            `the entry "${id}" was not written by this agent, so its source cannot be read`,
            [id],
          )
        }
        observed.set(id, entry.source)
        return {
          ok: true,
          message: `the source of "${id}", as it runs now`,
          entries: rowsFor([id]),
          source: entry.source,
          declarations: declarationsFor(entry.stubs),
        }
      },
    })

    const removeTool = createTool({
      name: 'remove_plugin',
      description:
        "Remove an entry this agent added or wrote. Everything it registered or held is released before the removal reports done. Protected entries and entries from the operator's assembly are refused. Takes effect from the next turn.",
      ...args<{ id: string }>({
        type: 'object',
        properties: { id: idSchema },
        required: ['id'],
      }),
      concurrency: 'exclusive',
      execute: async ({ id }): Promise<ComposerResult> => {
        const entry = entryOf(id)
        if (!entry) return failure(`there is no plugin entry "${id}"`, [id])
        if (isProtected(id)) {
          return failure(
            `the entry "${id}" is protected and cannot be removed`,
            [id],
          )
        }
        if (!added.has(id) && !written.has(id)) {
          return failure(
            `the entry "${id}" was not added or written by this agent, so it cannot be removed`,
            [id],
          )
        }
        const failed = await apply(list().filter((one) => one.id !== id))
        if (failed) return failure(failed, [id])
        added.delete(id)
        written.delete(id)
        observed.delete(id)
        return {
          ok: true,
          message: `removed the entry "${id}"`,
          entries: [report(id), ...rowsFor([])],
          effect: nextTurn,
        }
      },
    })

    const selectModelTool = createTool({
      name: 'select_model',
      description:
        'Choose which registered model provider the next turn uses, by name. Omit the name to fall back to the default. This is not a plugin-list edit: nothing restarts and no turn is cancelled.',
      ...args<{ name?: string }>({
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The provider name, or omit for the default.',
          },
        },
      }),
      concurrency: 'exclusive',
      execute: ({ name }): ComposerResult => {
        const providers = models.list().map((provider) => provider.name)
        if (name !== undefined && !providers.includes(name)) {
          return failure(
            `there is no model provider named "${name}"; the registered ones are ${
              providers.join(', ') || 'none'
            }`,
            [],
            { providers },
          )
        }
        models.select(name)
        const selected = models.current()?.name
        return {
          ok: true,
          message:
            name === undefined
              ? 'the model provider is back to the default'
              : `the model provider is now "${name}"`,
          entries: [],
          providers,
          ...(selected === undefined ? {} : { selected }),
          effect: atOnce,
        }
      },
    })

    const tools: Array<AnyTool> = [
      listTool,
      enableTool,
      disableTool,
      setOptionsTool,
      addTool,
      writeTool,
      readTool,
      removeTool,
      selectModelTool,
    ]
    for (const tool of tools) {
      instance.cleanup(registry.register(tool), `tool(${tool.name})`)
    }
  },
})
