# `@tanstack/compose-agent` — agent layer design

How the agent layer meets [`docs/acceptance/agent.md`](../../docs/acceptance/agent.md).
Terms are from [`CONTEXT.md`](../../CONTEXT.md) and are used exactly as defined
there. The kernel this is built on is [`@tanstack/compose`](../compose/DESIGN.md);
nothing here is privileged — an **agent** is an ordinary **client** whose
**plugin list** happens to contain a model provider, a tool registry, a prompt
registry, a session log and the loop.

Decisions already fixed: [ADR-0001](../../docs/adr/0001-types-by-inference-not-augmentation.md)
(types from builders), [ADR-0002](../../docs/adr/0002-state-in-tanstack-store.md)
(observable state is `@tanstack/store`), [ADR-0003](../../docs/adr/0003-middleware-for-interception.md)
(middleware intercepts, events observe).

## Context keys

Five keys, created with the kernel's `createContextKey`, so the value type
travels with the key and a consumer imports the key and never a provider (A2).
All five are **stable**: each is provided by exactly one plugin for the life of
the client, and everything else — providers, tools, sections — registers into
them. Nothing downstream ever loses a dep because a contribution came or went.

```ts
/** The model registry: the current provider. Providers register into it. */
export const modelKey: ContextKey<ModelRegistry> =
  createContextKey('agent.model')

/** The tool registry: what the model may call, and how it is executed. */
export const toolsKey: ContextKey<ToolRegistry> =
  createContextKey('agent.tools')

/** The prompt: the sections plugins contribute, assembled per step. */
export const promptKey: ContextKey<PromptRegistry> =
  createContextKey('agent.prompt')

/** The session: the append-only log everything model-visible is derived from. */
export const sessionKey: ContextKey<SessionLog> =
  createContextKey('agent.session')

/** The agent: queue input, cancel a turn, watch the status. */
export const agentKey: ContextKey<Agent> = createContextKey('agent')
```

Their value types:

```ts
interface ModelProvider {
  readonly name: string
  stream: (
    request: ModelRequest,
    signal: AbortSignal,
  ) => AsyncIterable<ModelChunk>
}

interface ModelRegistry {
  register: (provider: ModelProvider) => Cleanup
  list: () => Array<ModelProvider>
  current: () => ModelProvider | undefined
  select: (name: string | undefined) => void
}

interface ToolRegistry {
  register: (tool: AnyTool) => Cleanup
  list: () => Array<AnyTool>
  get: (name: string) => AnyTool | undefined
}

interface PromptRegistry {
  register: (section: PromptSection) => Cleanup
  list: () => Array<PromptSection>
  assemble: () => string
}

interface SessionLog {
  readonly entries: Store<Array<SessionEntry>>
  append: (entry: SessionEntryInput) => SessionEntry
  snapshot: () => Array<SessionEntry>
  messages: () => Array<Message>
  fork: (entryId: string) => Array<SessionEntry>
}

interface Agent {
  readonly status: Store<AgentStatus> // 'idle' | 'running'
  send: (text: string) => void
  cancel: () => Promise<void>
  idle: () => Promise<void>
}
```

## The session event union

One event, `sessionAppendedEvent`, whose payload _is_ the entry (B4). The entry
is a discriminated union on `kind`, so a listener narrows without casts (F2).

```ts
/** Why a turn or a step stopped. */
export type CloseReason = 'complete' | 'cancelled' | 'error'

/** Fields every entry carries. */
export interface SessionEntryFields {
  /** Sequence identity within the log; stable across replay and fork. */
  id: string
  /** When it was appended, in epoch milliseconds. */
  at: number
  /** The turn it belongs to; `0` before the first turn opens. */
  turn: number
}

export type SessionEntry =
  | ({ kind: 'turn-opened' } & SessionEntryFields)
  | ({ kind: 'turn-closed'; reason: CloseReason } & SessionEntryFields)
  | ({ kind: 'step-opened'; step: number } & SessionEntryFields)
  | ({
      kind: 'step-closed'
      step: number
      reason: CloseReason
    } & SessionEntryFields)
  | ({ kind: 'input'; text: string } & SessionEntryFields)
  | ({ kind: 'chunk'; step: number; text: string } & SessionEntryFields)
  | ({
      kind: 'assistant'
      step: number
      text: string
      toolCalls: Array<ToolCall>
    } & SessionEntryFields)
  | ({ kind: 'tool-call'; step: number; call: ToolCall } & SessionEntryFields)
  | ({
      kind: 'tool-result'
      step: number
      callId: string
      name: string
      outcome: ToolOutcome
    } & SessionEntryFields)
  | ({
      kind: 'error'
      step?: number
      scope: 'model' | 'tool' | 'loop'
      message: string
    } & SessionEntryFields)

export const sessionAppendedEvent: EventDefinition<SessionEntry, false> =
  createEvent<SessionEntry>('agent.session.appended')
```

`SessionEntryInput` is the same union with `id` and `at` removed; the session
log assigns both, so ids are the log's own and nothing else can forge one.

## How messages are derived

`deriveMessages(entries)` is a pure fold over the log, exported so it can be
tested and reused (B2). It is the only way messages are produced; the loop keeps
no message array of its own.

| Entry           | Message                                                         |
| --------------- | --------------------------------------------------------------- |
| `input`         | `{ role: 'user', content: text }`                               |
| `assistant`     | `{ role: 'assistant', content: text, toolCalls }`               |
| `tool-result`   | `{ role: 'tool', callId, name, content, isError: !outcome.ok }` |
| everything else | nothing                                                         |

`chunk` entries are deliberately _not_ derived: they are the streaming trace of
the `assistant` entry that follows them, which carries the complete text. So the
fold is total and idempotent — deriving twice from the same log gives deep-equal
messages (B2), and a fresh client seeded with the same entries derives the same
messages (B3).

`fork(entryId)` returns a copy of the log up to and including `entryId`, and
throws unless that entry is a **step** or **turn** boundary (`step-closed` /
`turn-closed`) — forking in the middle of a step would leave a tool call with no
result. The returned entries are handed to a fresh `sessionPlugin` through its
`entries` option, which is also how replay works (B3).

## Plugins

| Plugin                | Provides     | Deps                                              | Options                                              |
| --------------------- | ------------ | ------------------------------------------------- | ---------------------------------------------------- |
| `sessionPlugin`       | `sessionKey` | —                                                 | `{ entries?: Array<SessionEntry> }`                  |
| `toolsPlugin`         | `toolsKey`   | —                                                 | `{ tools?: Array<AnyTool> }`                         |
| `promptPlugin`        | `promptKey`  | —                                                 | `{ sections?: Array<PromptSection> }`                |
| `modelsPlugin`        | `modelKey`   | —                                                 | `{ select?: string }`                                |
| `loopPlugin`          | `agentKey`   | `sessionKey`, `toolsKey`, `promptKey`, `modelKey` | `{ maxSteps?: number; modelOptions?: object }`       |
| `scriptedModelPlugin` | —            | `modelKey`                                        | `{ name?: string; script: Array<ScriptedResponse> }` |
| `toolsetPlugin`       | —            | `toolsKey`                                        | `{ tools: Array<AnyTool> }`                          |
| `promptSectionPlugin` | —            | `promptKey`                                       | `{ sections: Array<PromptSection> }`                 |

The four registries are the stable half; `scriptedModelPlugin`, `toolsetPlugin`
and `promptSectionPlugin` are the contributing half, each registering into a
registry in `setup` and unregistering through its own cleanup.

Each is an ordinary plugin, so any of them can be removed, replaced or
reconfigured through the plugin list while a conversation is open (A1).

### A turn sees one world

The loop hard-depends on all four registries — `sessionKey`, `toolsKey`,
`promptKey`, `modelKey` — and reads none of them opportunistically. Because the
keys are stable, that costs nothing: a provider, tool or section coming or going
never unpublishes a key, so it never deactivates the loop.

When a turn opens, the loop takes the world once:

```ts
world = {
  provider: models.current(),
  tools: tools.list(),
  system: prompt.assemble(),
}
```

Every step of that turn runs against that snapshot, and the snapshot is dropped
when the turn closes (C3). A contribution added or removed while a turn is
running is therefore picked up by the _next_ turn, and the loop is never
restarted to make that happen.

Two consequences the criteria name explicitly:

- A tool in the turn's world that has since been unregistered is **refused**
  with `tool "…" was unregistered while the turn was running` — offered for the
  whole turn, executable only while it is still registered (C4).
- A provider in the turn's world that has since been unregistered ends the step
  with `the model provider "…" was unregistered while the turn was running`,
  recorded as a model error, and the turn closes; the next turn opens against
  whatever `current()` returns then (E2).

An empty registry is not an exception either: with no provider registered the
request action returns a response carrying `error`, so it behaves exactly like a
provider that failed (D5).

Replacing a _registry_ plugin is a different matter: it unpublishes the key, so
the loop is deactivated and restarted, which cancels the open turn through the
loop's cleanup — the same path as C6. That is the honest behaviour, and A1 only
asks that it work, not that it be invisible.

## Requests and tool calls are actions

Both actions are owned by the loop plugin, which is the only plugin that knows
about both the model and the session.

```ts
export const requestAction: ActionDefinition<ModelRequest, ModelResponse> =
  createAction('agent.request')

export const toolCallAction: ActionDefinition<ToolCallInput, ToolOutcome> =
  createAction('agent.toolCall')

interface ModelRequest {
  turn: number
  step: number
  system: string
  messages: Array<Message>
  tools: Array<ToolSchema>
  options: Record<string, unknown>
}
interface ModelResponse {
  text: string
  toolCalls: Array<ToolCall>
  /** Set when the step failed; the loop records it and closes the turn (D5). */
  error?: string
}

interface ToolCallInput {
  call: ToolCall // `call.args` are the model's raw, unvalidated arguments
  turn: number
  step: number
}
type ToolOutcome<TResult = unknown> =
  { ok: true; value: TResult } | { ok: false; error: string }
```

### What middleware sees

- **`requestAction`** — the whole `ModelRequest`. Middleware may rewrite
  `system`, `messages`, `tools` or `options`, or veto the step by returning a
  `ModelResponse` without calling `next` (D1). Neither the loop nor the provider
  can tell which happened: the loop only ever sees a `ModelResponse`.
- **`toolCallAction`** — the `ToolCall` as the model issued it. Middleware may
  rewrite `call.args`, replace the outcome, or refuse with
  `{ ok: false, error }` — which the model sees as a tool error, exactly like a
  thrown tool (D2). Because middleware sees the _raw_ arguments and validation
  happens inside the handler, rewritten arguments are validated too (D3).

Neither action carries the turn's `AbortSignal`: cancellation is the loop's, not
the middleware's, and putting the signal in the input would invite middleware to
rewrite it. The handlers close over the current turn's controller.

Neither handler throws for an expected failure. A missing provider, a stream
that fails mid-flight, an unknown tool, arguments that fail validation and a
tool that throws all become values — `ModelResponse.error` or
`{ ok: false, error }` — so the loop never has to distinguish "the step failed"
from "the runtime broke" (D3, D5). An unexpected throw out of the chain is still
caught by the loop and turned into the same value.

### `toolMiddleware` — typed interception (F1)

The actions are monomorphic, because middleware may be registered for tools it
does not know about. `toolMiddleware(tool, fn)` narrows on the tool's name,
validates `call.args` with the tool's own validator, and hands `fn` a typed
`args: TArgs` and a `next` that returns `ToolOutcome<TResult>`. Arguments that
fail validation skip `fn` and fall straight through to `next`, so the handler
produces the usual error outcome.

## The turn / step state machine

```
                  send(text)            queue drained, nothing owed
   ┌── idle ─────────────────▶ running ─────────────────────────▶ idle ──┐
   └──────────────────────────────────────────────────────────────────────┘

   running:
     while input is queued:
       turn ─▶ take the world once: models.current(), tools.list(), prompt.assemble()
               turn-opened, drain queue into `input` entries
         step ─▶ step-opened
                 dispatch(requestAction)      ── chunk entries appended as they stream
                 append assistant entry       ── always, whatever came back (E1)
                 error?    ─▶ error entry, step-closed(error),  turn-closed(error)
                 aborted?  ─▶ step-closed(cancelled),           turn-closed(cancelled)
                 run tool calls in concurrency batches
                 step-closed(complete)
                 drain queue into `input` entries        ── C1, at the step boundary
                 another step while the response called tools or input arrived
       turn-closed(complete)
```

- **Turn** numbers start at `1` and continue past the highest turn already in a
  replayed log. **Step** numbers start at `1` within each turn.
- **The world is per turn**, not per step: the provider, the tool list and the
  assembled prompt are all fixed for the turn (C3, C4, E2).
- **`maxSteps`** (default `16`) bounds a turn; exceeding it appends an `error`
  entry with scope `loop` and closes the turn with reason `error`. Nothing in
  the criteria asks for a bound, but an unbounded loop against a misbehaving
  model never returns, and C7's "await idle" would never resolve.
- **`send` is `void`.** C7 asks for a way to await the agent becoming idle, and
  `idle()` is that way; making `send` awaitable as well would give two answers
  to one question. `idle()` resolves immediately when the agent is already idle.

### Cancellation (C5, C6)

One `AbortController` per turn.

1. `cancel()` clears the queued input, aborts the controller and awaits the
   turn. Clearing the queue is what makes the agent "idle and reusable": input
   queued before a cancellation belongs to the cancelled turn.
2. The request handler stops consuming the stream and returns what it has, so
   the partial assistant message still reaches the log (E1).
3. Running tool calls receive the signal through `ToolContext`. The loop does
   not wait for a tool that ignores it: it races the batch against the signal
   and abandons the batch, appending no results for it.
4. The loop appends `step-closed(cancelled)` and `turn-closed(cancelled)`, then
   goes `idle`. The controller is gone, so the next `send` opens a fresh turn.
5. The loop's cleanup sets a `stopped` flag and then does exactly the above, so
   removing the loop plugin mid-turn cancels the turn as part of its cleanup and
   nothing writes to the session after removal resolves (C6). The cleanup is
   registered last and therefore runs first, ahead of the `agentKey` provision.

### Tool concurrency (D4)

The calls in one response are cut into batches by walking them in the order the
model issued them: consecutive `parallel` tools accumulate into one batch, a
tool declared `exclusive` (or an unknown tool) starts and ends its own batch.
Batches run one after another; within a batch every call runs concurrently. Each
batch appends its `tool-call` entries first, then dispatches, then appends its
`tool-result` entries in issue order — so results are always in the order the
model issued the calls, whatever order they finished in.

## Tools

`createTool` infers the argument type from the `validator` (any Standard Schema)
and the result type from `execute` (ADR-0001):

```ts
const search = createTool({
  name: 'search',
  description: 'Search the index',
  validator: v.object({ query: v.string() }),
  parameters: { type: 'object', properties: { query: { type: 'string' } } },
  concurrency: 'parallel', // or 'exclusive'
  execute: ({ query }, { signal }) => results(query, signal),
})
```

`parameters` is the JSON Schema handed to the model. Standard Schema has no
JSON-Schema projection, so the tool states it; it defaults to
`{ type: 'object' }`. It is data for the provider and is never used to validate
— validation is always the `validator`.

`register` returns a `Cleanup`; the caller decides who owns it. `toolsetPlugin`
is the ordinary case: it registers its tools and hands the cleanups to its own
instance, so unloading the plugin unregisters the tools (C4).

## Prompt sections

A section is `{ name, order?, text }` where `text` is a string or a function
returning one, so a section can reflect live state without re-registering.
`assemble()` sorts by `order` (default `0`), stable within equal orders by
registration order, and joins with a blank line. It is called once per step, so
a section added or removed between steps shows up in the very next request (C3).

## The scripted provider (E3)

`scriptedModelPlugin` registers a provider built from a plain array:

```ts
interface ScriptedResponse {
  /** Text pieces streamed in order, one chunk entry each. */
  chunks?: Array<string>
  /** Tool calls yielded after the text. */
  toolCalls?: Array<{ id?: string; name: string; args: unknown }>
  /** Fail the stream after the chunks — a mid-stream failure. */
  error?: string
}
```

Responses are consumed in order, one per request. Running past the end throws,
which the loop records as a model error: a test that scripts too few responses
should fail loudly rather than quietly repeating the last one. Call ids are
`call-1`, `call-2`, … per provider instance unless the script names them, so
they are deterministic. The provider records nothing: a test that wants to know
what the model saw registers middleware on `requestAction`, which is the same
seam a production plugin would use.

## Model providers register into the registry (E2, E4)

`modelsPlugin` owns `modelKey` and nothing else does. `current()` returns the
provider `select` named while it is registered, and otherwise the most recently
registered one — so an agent with a single provider never selects anything, and
a selection naming a provider that is not registered falls back rather than
leaving the agent with no model at all.

`@tanstack/compose-agent-openai` registers into that registry by speaking the
OpenAI-compatible chat-completions streaming protocol over global `fetch`, with
no vendor SDK, so it works against OpenAI, DeepSeek or a local server through
`baseUrl`. It imports `modelKey` and the vocabulary types from this package by
value only (F3). Adding it, removing it or selecting another provider is one
plugin-list edit that restarts nothing and takes effect at the next turn.

## The composer: the agent edits itself

How the package meets [`docs/acceptance/self-modification.md`](../../docs/acceptance/self-modification.md),
except §D7–D9, which belong to the source checker — a plugin behind
`sourceCheckerKey`, in its own package. The host contract and the in-process
host are the kernel's ([`compose/DESIGN.md` §Hosts and plugin source](../compose/DESIGN.md)).

The **composer** is one more plugin. It depends on `toolsKey` and `modelKey`,
registers nine tools into the tool registry, and edits the **plugin list**
through `instance.client`. It is not privileged: remove its entry and the agent
loses the ability to edit itself, exactly as removing `toolsetPlugin` loses a
tool set.

### The tools

| Tool                 | Arguments               | What it does                                                               |
| -------------------- | ----------------------- | -------------------------------------------------------------------------- |
| `list_plugins`       | —                       | Every entry with status, missing deps, protection; and the catalog's names |
| `enable_plugin`      | `{ id }`                | `enabled: true`                                                            |
| `disable_plugin`     | `{ id }`                | `enabled: false`, which is equivalent to removal (kernel F2)               |
| `set_plugin_options` | `{ id, options }`       | Replace the entry's options; the instance restarts                         |
| `add_plugin`         | `{ id, name, options }` | Add a **plugin catalog** entry by name                                     |
| `write_plugin`       | `{ id, source }`        | Write **plugin source** as a new entry, or rewrite one the agent wrote     |
| `read_plugin`        | `{ id }`                | The source of an entry the agent wrote, and its **plugin declarations**    |
| `remove_plugin`      | `{ id }`                | Remove an entry the agent added or wrote                                   |
| `select_model`       | `{ name? }`             | `modelKey`'s `select` — no plugin-list edit, nothing restarts              |

Every one of them is `concurrency: 'exclusive'`: an edit to the plugin list runs
alone in its step, never alongside another edit or another tool.

They are ordinary tools built with `createTool`, so they go through
`toolCallAction` and approval, logging and refusal middleware apply to them
exactly as to any other tool (A4). Their arguments are validated by their own
validators before they run (agent.md D3).

### One result shape

Every tool returns the same object, whether it worked, was refused, or failed:

```ts
interface ComposerResult {
  ok: boolean
  message: string
  error?: string // why it was refused or how it failed
  entries: Array<ComposerEntry> // the entries the edit touched, after settling
  effect?: string // when the change reaches the model
  catalog?: Array<string>
  source?: string
  declarations?: string
  diagnostics?: Array<SourceDiagnostic>
  providers?: Array<string>
  selected?: string
}

interface ComposerEntry {
  id: string
  plugin: string // the plugin's name, or `source`
  kind: 'plugin' | 'source'
  enabled: boolean
  protected: boolean
  status: Status | 'disabled'
  missing?: Array<string> // when `pending`
  error?: string // when `error`
  sourceError?: SourceError // when `error` on a source entry
  readable?: boolean // whether the agent may read this source back
}
```

`entries` is the entries the tool named **plus every entry the edit left
`pending` or in `error`**, in plugin-list order. That is what makes a
consequence somewhere else in the list visible in the same result: disabling a
provider names the dependents that went `pending` and what each of them is
missing (A3, C1), and a written entry that failed to start carries its
`SourceError` — `phase`, `message`, `line`, `column`, `diagnostics` — so a
check failure, a parse failure, a setup throw and a first-call throw are one
recovery loop with one shape (D4).

**Failure is a value, not an error outcome.** A refusal or a failure comes back
as `{ ok: false, error, entries, … }` inside a successful `ToolOutcome`, rather
than as `{ ok: false, error: string }` at the outcome level. `ToolOutcome`'s
error variant carries only a string, and D4 asks for diagnostics with line and
column in the tool result; a structured payload is the only way to carry them.
The model reads `ok` and `error` at the top of the JSON either way.

### One path to what runs (A2)

Every tool ends in the same three lines:

```ts
await client.setPluginList(next)
await client.settled()
return { ok: true, message, entries: rowsFor([id]), effect: nextTurn }
```

There is no second path. Nothing calls `registry.register` on the model's
behalf, nothing holds an instance handle, nothing reaches into the loop. A
reconcile that fails rejects there; the kernel restores the previous list, the
composer turns the rejection into `{ ok: false, error }`, and the turn carries
on (C3).

`select_model` is the one tool that is not a plugin-list edit: it calls
`select` on the model registry, which the next turn reads. That is not a second
path to what _runs_ — the provider was already registered by its own entry — it
is the registry's own runtime choice (agent.md E2).

### When an edit reaches the model

A **turn** sees one world (agent.md C3): the loop takes the registered tools and
the assembled **prompt sections** when the turn opens and holds them for every
**step** of it. So an edit made during a turn — which is the only time the model
can make one — is offered from the **next turn**, not from the next step of the
same turn. Every tool's description and every successful result say so in
words, in the result's `effect` field.

Where self-modification C4 and D5 say "the next step", this is the same barrier
stated from the other side: the next request the model makes with the new world
in place. Making it literally the next step would mean re-reading the
registries per step, which contradicts agent.md C3 — a delivered criterion — and
would let a conversation change shape underneath itself mid-turn.

### `set options` on a registry entry restarts the loop

The five registry entries — `session`, `tools`, `prompt`, `models`, `loop` —
each provide a stable key. Updating an entry's options restarts that instance
(kernel D2), which unpublishes its key, which deactivates the loop, whose
cleanup cancels the open turn (agent.md C6). In other words: `set_plugin_options`
on any of those five ends the turn the model was in the middle of.

That is honest behaviour, not a bug, and it is why **the recommended assembly
protects all five**. The composer's own entry is protected by construction (B2),
so a recommended assembly protects six entries in total. `select_model` exists
precisely so the common case — "use the other model" — has a path that restarts
nothing.

### Limits

- **Protected entries** (B1, B2). `protected` is a list of entry ids in the
  composer's options, and `instance.id` is always in it. A protected entry
  cannot be enabled, disabled, reconfigured, rewritten or removed; the attempt
  returns `{ ok: false, error: 'the entry "…" is protected …' }` and touches
  nothing. Enabling is refused along with the rest: one rule, and an entry the
  operator both protected and disabled was meant to stay that way.
- **The catalog** (B3). `add_plugin` takes a catalog _name_, never a plugin. An
  unknown name comes back with the names that do exist. Options are validated by
  the catalog plugin's own validator **before** the list is touched, so invalid
  options change nothing — rather than adding an entry that lands in `error`.
  `set_plugin_options` validates the same way.
- **The operator's half** (B4). The catalog, the protected ids, the **stubs**
  every written plugin is granted and the **host** they run in are the
  composer's options. No tool reads or writes them, and the composer's own entry
  is protected, so the model cannot reconfigure them either. They are validated
  when the composer starts: a catalog holding something that is not a plugin
  leaves the composer in `error` with a path-annotated message, like any other
  options failure (kernel D1).

### Writing plugins

An entry the agent writes is `{ id, source, host, stubs }` — the same
`PluginEntry` shape the operator would write by hand. `host` and `stubs` come
from the composer's options, so what a written plugin can reach is decided once,
by the operator, for every plugin the agent will ever write (B4, hosts A4).

**The stubs this package owns.** A written plugin is handed one async callable
per grant, and each grant carries the `.d.ts` text it is checked against and its
author is shown (D8):

```ts
// toolsStub
declare const tools: (tool: {
  name: string
  description: string
  parameters?: JsonSchema
  handler: string
  concurrency?: 'parallel' | 'exclusive'
}) => Promise<void>

// promptStub
declare const prompt: (section: {
  name: string
  order?: number
  text: string
}) => Promise<void>
```

`toolsStub`'s declarations also carry the `JsonSchema` interface, because a
written plugin cannot hand a validator across a host boundary — it can only hand
plain data. So it declares its tool's arguments as JSON Schema, and that one
object becomes both the `parameters` the model is shown and, through
`jsonSchemaValidator`, the `validator` the model's arguments are checked against
(agent.md D3). The two cannot drift, and the composer's own tools are built the
same way.

`handler` names an export of the written module rather than carrying a function,
for the same reason. The stub's handler calls it back through
`StubCall.call`, which routes through the entry's host.

Both handlers run client-side with the hosted instance's own `Instance` handle
and read context through `instance.context.get(...)` — the grant declares the
dep, so the hosted entry sits in the dependency graph like any other instance
and stays `pending` until `toolsKey` and `promptKey` are provided. Every
registration is `instance.cleanup(...)`, owned by the hosted instance, so
ordinary kernel cleanup undoes it when the entry is removed or rewritten (D3):
nothing the previous code registered survives.

`promptStub` takes a string, not a function: `PromptSection.text` may be a
function, but a function cannot cross a host boundary. A written section that
has to change re-registers.

### The read gate (D3)

Copied, deliberately, from a working agent authoring loop: a rewrite is refused
unless the agent has **read that entry's current source in this session**.

The composer keeps two pieces of state per instance:

- `written` — the ids the agent wrote. Only these can be read back (D6) or
  rewritten; `added` is the same for catalog entries, and only entries in either
  set can be removed. An entry from the operator's assembly has no source the
  agent may read, and one from the catalog has no source at all.
- `observed` — for each entry, the source text `read_plugin` last returned.

`write_plugin` on an id that already exists therefore refuses three ways, in
order: the entry is protected; the entry is not one the agent wrote; the agent
has not read it (`read the source of "…" with read_plugin before rewriting it`);
the source has moved since the read (`the source of "…" has changed since you
read it; read it again and try again`). Writing a _new_ id passes no gate —
there is nothing to have read.

Only `read_plugin` records a read. A successful write does not, so the loop the
model runs is write → read → rewrite, and `read_plugin` is also where the model
goes to see the entry's error: it returns the source, the declarations, and the
entry's status and `SourceError` together.

The state is the composer instance's, so "this session" means "while this
composer instance has been running". A restarted composer has read nothing,
which refuses more, never less.

### Checking before writing (D7, D9)

The kernel checks plugin source through `sourceCheckerKey` when one is provided,
and starts it as written when none is. The composer checks it **once more,
before it touches the plugin list**, for one reason: D7 says source that does
not type-check leaves the entry as it was. If the composer wrote first, a
rewrite that fails to check would already have torn the running instance down.
So the composer asks the checker, and on rejection returns the diagnostics with
the declarations and changes nothing.

The check is the same call the kernel makes, with the same declarations, so the
answer is the same one; a client with no checker skips it and starts source
unchecked, exactly as the kernel does (D9).

`declarationsFor(grants)` is `stubDeclarations(grants)` and nothing else — one
line, deliberately, so that when a checker publishes richer text of its own the
swap happens there.

## Choices made where the criteria are silent

- **One session event, not one per kind.** `sessionAppendedEvent` carries the
  entry, and F2's narrowing happens on `entry.kind`. A separate event per kind
  would multiply the surface and make "follow the whole conversation" (B4) into
  ten subscriptions.
- **Chunk entries are logged but not derived.** B1 wants streamed chunks in the
  log; B2 wants derivation to be stable. Keeping the complete `assistant` entry
  authoritative satisfies both without the fold having to reassemble deltas.
- **Outcomes are values, exceptions are not part of the contract.** See above.
- **The loop owns both actions.** They are the loop's seams onto the model and
  the tools; removing the loop removes them, which is the honest behaviour when
  there is nothing left to intercept.
- **`send` queues, `idle()` awaits.** See the state machine.
- **`cancel()` clears the queue.** See cancellation.
- **`send` after the loop is removed is ignored, not an error.** A UI holding
  a stale agent handle should not throw; the loop is gone and there is nothing
  left to run.
- **`maxSteps` exists.** See the state machine.
- **Tool results are stringified for the model** with `JSON.stringify`, except a
  string result which is passed through. The session keeps the real value in
  `outcome.value`; only the derived message is text.
- **A composer failure is a value, not an error outcome.** See above: the error
  variant of `ToolOutcome` carries only a string, and D4 wants diagnostics.
- **Only `read_plugin` opens the read gate**, not a successful write. See above.
- **`enable_plugin` is refused on a protected entry** along with everything
  else, rather than being allowed as a way back. One rule is easier to state,
  and the agent can never have disabled a protected entry in the first place.
- **The composer names its tools `verb_noun`** — `list_plugins`,
  `write_plugin`, `select_model` — so a model that knows one knows the shape of
  the rest.

## Criterion → test

Informational: test titles describe behaviour and carry no criterion ids.

| Id  | Test file                                      | `it()` title                                                                                   |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A1  | `tests/plugins.test.ts`                        | `every part of the agent is a plugin that can be removed and replaced mid-conversation`        |
| A2  | `tests/plugins.test.ts`                        | `a consumer declares the keys it needs and never imports a provider`                           |
| A3  | `tests/plugins.test.ts`                        | `a conversation runs on the package's plugins and a scripted model, with no network`           |
| B1  | `tests/session.test.ts`                        | `every model-visible fact is appended to the log as it happens`                                |
| B2  | `tests/session.test.ts`                        | `messages are derived from the log and deriving twice gives the same messages`                 |
| B3  | `tests/session.test.ts`                        | `a log replayed into a fresh client derives the same messages, and forks at a step boundary`   |
| B4  | `tests/session.test.ts`                        | `appends are observable as events and through the entries store`                               |
| C1  | `tests/loop.test.ts`                           | `input while idle starts a turn and input during a turn is taken up at the next step`          |
| C2  | `tests/loop.test.ts`                           | `a step is a request and its tool calls, and the turn closes when nothing is owed`             |
| C3  | `tests/loop.test.ts`                           | `a turn takes the prompt, the tools and the provider once and holds them for every step`       |
| C4  | `tests/loop.test.ts`                           | `the tools of a turn are those registered when it opened, and one removed mid-turn is refused` |
| C5  | `tests/loop.test.ts`                           | `cancelling stops the request and the tool calls and leaves the agent idle and reusable`       |
| C6  | `tests/loop.test.ts`                           | `removing the loop mid-turn cancels it and nothing writes to the session afterwards`           |
| C7  | `tests/loop.test.ts`                           | `the agent status is a store and becoming idle can be awaited`                                 |
| D1  | `tests/actions.test.ts`                        | `middleware can rewrite what the model sees or veto the step`                                  |
| D2  | `tests/actions.test.ts`                        | `middleware can rewrite the arguments, replace the result, or refuse the call`                 |
| D3  | `tests/actions.test.ts`                        | `invalid arguments produce an error result rather than a thrown exception`                     |
| D4  | `tests/actions.test.ts`                        | `tool calls run with their declared concurrency and results keep the model's order`            |
| D5  | `tests/actions.test.ts`                        | `a throwing tool keeps the turn going and a failing model closes it`                           |
| E1  | `tests/providers.test.ts`                      | `chunks are appended as they stream and the assistant message is appended when it ends`        |
| E2  | `tests/providers.test.ts`                      | `the registry chooses the provider at turn open, and one removed mid-turn ends the step`       |
| E3  | `tests/providers.test.ts`                      | `the scripted provider replays responses, tool calls and mid-stream failures`                  |
| E4  | `../compose-agent-openai/tests/openai.test.ts` | the keyless suite: streaming, event framing, the wire shape, failures, and a whole turn        |
| E4  | `../compose-agent-openai/tests/openai.test.ts` | `registers into the model registry and unregisters with its plugin`                            |
| E4  | `../compose-agent-openai/tests/smoke.test.ts`  | `answers one turn of a conversation` — skips itself when no key is present                     |
| F1  | `tests/types.test-d.ts`                        | `a tool's arguments and result are typed from its definition`                                  |
| F2  | `tests/types.test-d.ts`                        | `session entries narrow on their kind`                                                         |
| F3  | `tests/types.test-d.ts`                        | `a plugin authored in another package keeps full types with value imports only`                |
| G1  | `tests/end-to-end.test.ts`                     | `runs a three-turn conversation with tools, middleware, a mid-turn addition and a swap`        |
| —   | `tests/loop.test.ts`                           | `a turn that never stops calling tools is stopped by its step limit`                           |
| —   | `tests/packaging.test.ts`                      | zero runtime deps beyond the kernel and the store; no runtime-specific imports                 |
| —   | `tests/workerd/smoke.test.ts`                  | `an agent runs a turn under workerd`                                                           |

### `docs/acceptance/self-modification.md`

D7–D9 are the source checker's; the rows below are what this package proves
about carrying its diagnostics and its absence.

| Id  | Test file                    | `it()` title                                                                                                                                                                                                                         |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | `tests/composer.test.ts`     | the first five titles, one per tool, plus `tests/code.test.ts` for `write_plugin` and `read_plugin`                                                                                                                                  |
| A2  | `tests/composer.test.ts`     | `changes what runs only by writing the plugin list`                                                                                                                                                                                  |
| A3  | `tests/composer.test.ts`     | `lists every entry with its status, and names what a pending entry is missing` / `disables an entry and enables it again, both in one turn`                                                                                          |
| A4  | `tests/composer.test.ts`     | `is an ordinary tool, so middleware can refuse an edit`                                                                                                                                                                              |
| B1  | `tests/limits.test.ts`       | `refuses to disable, reconfigure or remove a protected entry`                                                                                                                                                                        |
| B2  | `tests/limits.test.ts`       | `protects its own entry, whatever the operator listed`                                                                                                                                                                               |
| B3  | `tests/limits.test.ts`       | `adds only what the catalog offers, and only with options that validate` / `refuses options that the entry's own validator rejects`                                                                                                  |
| B4  | `tests/limits.test.ts`       | `offers the model no tool that changes the catalog, the protection, the stubs or the host` / `leaves the composer in error when the operator's own options are wrong`                                                                |
| C1  | `tests/consequences.test.ts` | `leaves dependents pending with their missing deps named, and restores them in the same turn`                                                                                                                                        |
| C2  | `tests/consequences.test.ts` | `is in the session as a tool call and its result, so a replay shows what changed`                                                                                                                                                    |
| C3  | `tests/consequences.test.ts` | `leaves the client as it was when a reconcile fails, and the turn carries on`                                                                                                                                                        |
| C4  | `tests/consequences.test.ts` | `offers a plugin it added from the next turn: its tools, its prompt and its context`                                                                                                                                                 |
| D1  | `tests/code.test.ts`         | `starts written source, and its tool and prompt section arrive in the next turn`                                                                                                                                                     |
| D2  | `tests/code.test.ts`         | `starts written source, …` / `validates a written tool's arguments against the schema it declared`                                                                                                                                   |
| D3  | `tests/code.test.ts`         | `runs the previous code's cleanups on a rewrite, …` / `refuses to rewrite source it has not read back in this session` / `refuses a rewrite when the source moved since it was read`                                                 |
| D4  | `tests/code.test.ts`         | `carries the checker diagnostics and leaves the entry exactly as it was` / `carries a failure to start in the same shape as a failure to check` / `puts the entry in error when the first call into it throws, and the turn goes on` |
| D5  | `tests/code.test.ts`         | `starts written source, and its tool and prompt section arrive in the next turn`                                                                                                                                                     |
| D6  | `tests/code.test.ts`         | `reads and rewrites only what it wrote itself` / `removes a written entry, leaving no resources and no tools behind`                                                                                                                 |
| D7  | `tests/code.test.ts`         | `carries the checker diagnostics and leaves the entry exactly as it was` — the checker itself is its own package                                                                                                                     |
| D8  | `tests/code.test.ts`         | `hands the model the declarations of exactly the stubs the entry was granted`                                                                                                                                                        |
| D9  | `tests/code.test.ts`         | `starts source unchecked when no checker is provided, and checked when one is`                                                                                                                                                       |
| E1  | `tests/self-editing.test.ts` | `lists, disables, re-enables, adds, writes, corrects, uses and removes its own plugins`                                                                                                                                              |

### Notes on coverage

The suite runs under Node and jsdom (`vitest.config.ts`,
`vitest.jsdom.config.ts`) and a smoke test runs under workerd
(`vitest.workerd.config.ts`), mirroring the kernel.
