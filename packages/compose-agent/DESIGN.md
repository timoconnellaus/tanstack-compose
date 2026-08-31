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

```ts
/** The model: turns messages and tool definitions into a streamed response. */
export const modelKey: ContextKey<ModelProvider> =
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

| Plugin                | Provides     | Deps         | Options                                              |
| --------------------- | ------------ | ------------ | ---------------------------------------------------- |
| `sessionPlugin`       | `sessionKey` | —            | `{ entries?: Array<SessionEntry> }`                  |
| `toolsPlugin`         | `toolsKey`   | —            | `{ tools?: Array<AnyTool> }`                         |
| `promptPlugin`        | `promptKey`  | —            | `{ sections?: Array<PromptSection> }`                |
| `loopPlugin`          | `agentKey`   | `sessionKey` | `{ maxSteps?: number; modelOptions?: object }`       |
| `scriptedModelPlugin` | `modelKey`   | —            | `{ name?: string; script: Array<ScriptedResponse> }` |
| `toolsetPlugin`       | —            | `toolsKey`   | `{ tools: Array<AnyTool> }`                          |
| `promptSectionPlugin` | —            | `promptKey`  | `{ sections: Array<PromptSection> }`                 |

Each is an ordinary plugin, so any of them can be removed, replaced or
reconfigured through the plugin list while a conversation is open (A1).

### Why the loop only _depends_ on the session

The loop declares `deps: [sessionKey]` and reads `modelKey`, `toolsKey` and
`promptKey` with `context.peek` at the moment it needs them. This is the choice
E2, C3 and C4 force: a dep that disappears deactivates its dependent, so if the
loop depended on `modelKey`, swapping the model provider would restart the loop
and abort the conversation — where E2 requires the swap to "take effect on the
next request with no change to any other plugin". Peeking also makes C3 and C4
fall out for free, since the registries are read per step rather than captured
at setup.

The session is different: it is the source of truth, and a loop without one has
nothing to write to. Replacing the session plugin mid-turn therefore does
deactivate the loop, which cancels the open turn through the loop's cleanup —
the same path as C6.

An absent model provider is not an exception: the request action returns a
response carrying `error`, so a missing provider behaves exactly like a provider
that failed (D5).

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
       turn ─▶ turn-opened, drain queue into `input` entries
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

`scriptedModelPlugin` provides `modelKey` from a plain array:

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

## Model providers are chosen by the key alone (E2, E4)

`@tanstack/compose-agent-openai` provides `modelKey` by speaking the
OpenAI-compatible chat-completions streaming protocol over global `fetch`, with
no vendor SDK, so it works against OpenAI, DeepSeek or a local server through
`baseUrl`. It imports `modelKey` and the vocabulary types from this package by
value only (F3). Swapping it for the scripted provider — or for another
endpoint — is one plugin-list edit and touches nothing else.

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

## Criterion → test

Informational: test titles describe behaviour and carry no criterion ids.

| Id  | Test file                                      | `it()` title                                                                                 |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A1  | `tests/plugins.test.ts`                        | `every part of the agent is a plugin that can be removed and replaced mid-conversation`      |
| A2  | `tests/plugins.test.ts`                        | `a consumer declares the keys it needs and never imports a provider`                         |
| A3  | `tests/plugins.test.ts`                        | `a conversation runs on the package's plugins and a scripted model, with no network`         |
| B1  | `tests/session.test.ts`                        | `every model-visible fact is appended to the log as it happens`                              |
| B2  | `tests/session.test.ts`                        | `messages are derived from the log and deriving twice gives the same messages`               |
| B3  | `tests/session.test.ts`                        | `a log replayed into a fresh client derives the same messages, and forks at a step boundary` |
| B4  | `tests/session.test.ts`                        | `appends are observable as events and through the entries store`                             |
| C1  | `tests/loop.test.ts`                           | `input while idle starts a turn and input during a turn is taken up at the next step`        |
| C2  | `tests/loop.test.ts`                           | `a step is a request and its tool calls, and the turn closes when nothing is owed`           |
| C3  | `tests/loop.test.ts`                           | `the prompt is assembled per step from the sections registered at that moment`               |
| C4  | `tests/loop.test.ts`                           | `the tools offered are the ones registered at that moment`                                   |
| C5  | `tests/loop.test.ts`                           | `cancelling stops the request and the tool calls and leaves the agent idle and reusable`     |
| C6  | `tests/loop.test.ts`                           | `removing the loop mid-turn cancels it and nothing writes to the session afterwards`         |
| C7  | `tests/loop.test.ts`                           | `the agent status is a store and becoming idle can be awaited`                               |
| D1  | `tests/actions.test.ts`                        | `middleware can rewrite what the model sees or veto the step`                                |
| D2  | `tests/actions.test.ts`                        | `middleware can rewrite the arguments, replace the result, or refuse the call`               |
| D3  | `tests/actions.test.ts`                        | `invalid arguments produce an error result rather than a thrown exception`                   |
| D4  | `tests/actions.test.ts`                        | `tool calls run with their declared concurrency and results keep the model's order`          |
| D5  | `tests/actions.test.ts`                        | `a throwing tool keeps the turn going and a failing model closes it`                         |
| E1  | `tests/providers.test.ts`                      | `chunks are appended as they stream and the assistant message is appended when it ends`      |
| E2  | `tests/providers.test.ts`                      | `the provider is chosen by the key alone and can be swapped between steps`                   |
| E3  | `tests/providers.test.ts`                      | `the scripted provider replays responses, tool calls and mid-stream failures`                |
| E4  | `../compose-agent-openai/tests/openai.test.ts` | the keyless suite: streaming, event framing, the wire shape, failures, and a whole turn      |
| E4  | `../compose-agent-openai/tests/smoke.test.ts`  | `answers one turn of a conversation` — skips itself when no key is present                   |
| F1  | `tests/types.test-d.ts`                        | `a tool's arguments and result are typed from its definition`                                |
| F2  | `tests/types.test-d.ts`                        | `session entries narrow on their kind`                                                       |
| F3  | `tests/types.test-d.ts`                        | `a plugin authored in another package keeps full types with value imports only`              |
| G1  | `tests/end-to-end.test.ts`                     | `runs a two-turn conversation with tools, middleware, a new prompt section and a swap`       |
| —   | `tests/loop.test.ts`                           | `a turn that never stops calling tools is stopped by its step limit`                         |
| —   | `tests/packaging.test.ts`                      | zero runtime deps beyond the kernel and the store; no runtime-specific imports               |
| —   | `tests/workerd/smoke.test.ts`                  | `an agent runs a turn under workerd`                                                         |

### Notes on coverage

The suite runs under Node and jsdom (`vitest.config.ts`,
`vitest.jsdom.config.ts`) and a smoke test runs under workerd
(`vitest.workerd.config.ts`), mirroring the kernel.
