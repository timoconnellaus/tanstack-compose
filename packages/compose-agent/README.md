# `@tanstack/compose-agent`

The agent layer for [`@tanstack/compose`](../compose). An **agent** is an
ordinary **client**: the **model** provider, the **tool** registry, the **prompt
section** registry, the **session** log and the loop are each **plugins**, every
**request** and tool call is an **action** other plugins can wrap with
**middleware**, and the session is the source of truth everything the model sees
is derived from.

Nothing here is privileged. Removing the loop, swapping the provider or adding a
tool set is an edit to the plugin list, while a conversation is open.

## Installation

```sh
npm install @tanstack/compose @tanstack/compose-agent
```

## An agent is six plugin entries

```ts
import { createClient } from '@tanstack/compose'
import {
  agentKey,
  loopPlugin,
  modelsPlugin,
  promptPlugin,
  scriptedModelPlugin,
  sessionPlugin,
  toolsPlugin,
} from '@tanstack/compose-agent'

const client = createClient({
  plugins: [
    { id: 'session', plugin: sessionPlugin },
    { id: 'tools', plugin: toolsPlugin, options: { tools: [search] } },
    {
      id: 'prompt',
      plugin: promptPlugin,
      options: { sections: [{ name: 'role', text: 'You are a librarian.' }] },
    },
    { id: 'models', plugin: modelsPlugin },
    {
      id: 'model',
      plugin: scriptedModelPlugin,
      options: { script: [{ chunks: ['Hello.'] }] },
    },
    { id: 'loop', plugin: loopPlugin },
  ],
})
await client.settled()

const agent = client.getContext(agentKey)!
agent.send('find me something on cats')
await agent.idle()
```

`agent.send` queues input. Input while the agent is idle opens a **turn**; input
during a turn is taken up at the next **step** boundary. `agent.status` is a
[`@tanstack/store`](https://tanstack.com/store) store holding `idle` or
`running`, and `agent.cancel()` stops the in-flight request and any running tool
calls, records the cancellation, and leaves the agent idle and reusable.

The five keys — `session`, `tools`, `prompt`, `model` and `agent` — are stable:
each is provided by one plugin for the life of the client, and everything else
registers into them. Swap the scripted provider for a real one
(`@tanstack/compose-agent-openai`, or your own) and nothing else changes.

## A turn sees one world

When a turn opens, the loop takes the current model provider, the registered
tools and the assembled prompt **once**, and every step of that turn runs
against them. A provider, tool or prompt section added or removed while a turn
is running is picked up by the next turn — the loop is never restarted to make
that happen, and a conversation never changes shape underneath itself.

Within a turn: a tool the turn opened with but that has since been unregistered
is refused with an error result, and a provider that has since been unregistered
ends the step with an error and closes the turn.

## Tools

A tool's argument type comes from its **validator** (any
[Standard Schema](https://standardschema.dev)) and its result type from
`execute`, so both travel with the definition.

```ts
import { createTool } from '@tanstack/compose-agent'
import * as v from 'valibot'

const search = createTool({
  name: 'search',
  description: 'Search the catalogue',
  validator: v.object({ query: v.string() }),
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  concurrency: 'parallel', // or 'exclusive', to run alone in its step
  execute: ({ query }, { signal }) => lookup(query, signal),
})
```

Arguments are validated before the tool runs; invalid arguments and a tool that
throws both reach the model as an error result, and the turn carries on. Tools
contributed by their own plugin entry come and go with it:

```ts
import { toolsetPlugin } from '@tanstack/compose-agent'

await client.addPlugin({
  id: 'catalogue',
  plugin: toolsetPlugin,
  options: { tools: [search, borrow] },
})
```

A tool registered while a turn is running is first offered in the next turn; one
removed mid-turn is refused if the model calls it.

## Wrapping what the agent does

Every step and every tool call goes through an action, so a plugin can change it
without the loop or the tool knowing.

```ts
import {
  requestAction,
  toolCallAction,
  toolMiddleware,
} from '@tanstack/compose-agent'
import type { ToolOutcome } from '@tanstack/compose-agent'

const policy = createPlugin({
  name: 'policy',
  setup(instance) {
    // Rewrite what the model sees — or veto the step by not calling `next`.
    instance.use(requestAction, ({ input, next }) =>
      next({ ...input, options: { temperature: 0 } }),
    )

    // Refuse a call. The model reads it as a tool error, like any other failure.
    const refusal: ToolOutcome = { ok: false, error: 'not allowed here' }
    instance.use(toolCallAction, ({ input, next }) =>
      input.call.name === 'borrow' ? refusal : next(input),
    )

    // `toolMiddleware` narrows on one tool and types its arguments and result.
    instance.use(
      toolCallAction,
      toolMiddleware(search, ({ input, next }) =>
        next({ query: input.args.query.trim() }),
      ),
    )
  },
})
```

## Prompt sections

Sections are assembled in order once per turn, so one added or removed while a
turn is running shows up in the next turn's requests.

```ts
import { promptSectionPlugin } from '@tanstack/compose-agent'

await client.addPlugin({
  id: 'tone',
  plugin: promptSectionPlugin,
  options: {
    sections: [{ name: 'tone', order: 10, text: () => `It is ${today()}.` }],
  },
})
```

## The session

Everything model-visible is appended to the session as it happens: input,
streamed chunks, the complete assistant message, tool calls and results, and the
turn and step boundaries. The messages for a request are derived from that log
rather than kept alongside it.

```ts
import { sessionAppendedEvent, sessionKey } from '@tanstack/compose-agent'

const session = client.getContext(sessionKey)!
session.messages() // what the next request would send
session.entries.subscribe(() => render(session.snapshot()))

// Or follow the conversation as an event, without importing the loop.
client.on(sessionAppendedEvent, (entry) => {
  if (entry.kind === 'chunk') stream(entry.text)
})
```

Because the log is the whole truth, a conversation can be replayed or branched
by handing entries to a fresh session:

```ts
const branch = session.fork(stepBoundaryEntryId)
const other = createClient({
  plugins: [
    { id: 'session', plugin: sessionPlugin, options: { entries: branch } },
    ...rest,
  ],
})
```

## Letting the agent edit itself

Add the **composer** and the agent gets tools for editing its own **plugin
list** — listing it, enabling and disabling entries, setting their options,
adding pre-built plugins from a **plugin catalog**, and writing new plugins as
**plugin source**.

What it is allowed to do is decided here, in the assembly, and by nothing the
model can call:

```ts
import { createClient, inProcessHost } from '@tanstack/compose'
import {
  agentStubs,
  composerPlugin,
  loopPlugin,
  modelsPlugin,
  promptPlugin,
  sessionPlugin,
  toolsPlugin,
} from '@tanstack/compose-agent'

const client = createClient({
  hosts: { 'in-process': inProcessHost },
  plugins: [
    { id: 'session', plugin: sessionPlugin },
    { id: 'tools', plugin: toolsPlugin },
    { id: 'prompt', plugin: promptPlugin },
    { id: 'models', plugin: modelsPlugin },
    { id: 'model', plugin: openaiModelPlugin, options: { model: 'gpt-4o' } },
    { id: 'loop', plugin: loopPlugin },
    {
      id: 'composer',
      plugin: composerPlugin,
      options: {
        // What it may add, by name. It cannot add anything else.
        catalog: { clock: clockPlugin, notes: notesPlugin },
        // What it may not touch. Its own entry is always protected.
        protected: ['session', 'tools', 'prompt', 'models', 'loop'],
        // What a plugin it writes is handed, and where that plugin runs.
        stubs: agentStubs,
        host: 'in-process',
      },
    },
  ],
})
```

`hosts` is only needed when you name a host other than the in-process one, which
ships in the kernel and is the default.

### The tools it gets

| Tool                 | What the model can do                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| `list_plugins`       | See every entry, its status, what a `pending` one is missing           |
| `enable_plugin`      | Turn an entry back on                                                  |
| `disable_plugin`     | Turn an entry off, which is the same as removing it                    |
| `set_plugin_options` | Replace an entry's options; that instance restarts                     |
| `add_plugin`         | Add a catalog plugin by name, with options its validator accepts       |
| `write_plugin`       | Write, or rewrite, a plugin as source                                  |
| `read_plugin`        | Read back source it wrote, with the declarations it is checked against |
| `remove_plugin`      | Remove something it added or wrote                                     |
| `select_model`       | Use a different registered model provider                              |

They are ordinary tools: every call goes through `toolCallAction`, so the same
approval, logging and refusal middleware you wrap any other tool with applies to
them too. Every result carries the entries the edit touched with their status —
including the ones that went `pending` because of it, and what each of them is
now missing — so the model sees the consequence of what it did in the same step.

An edit is offered to the model from the **next turn**: a turn takes its tools
and prompt sections when it opens, and holds them for every step (see _A turn
sees one world_ above). Each tool says so in its description and in its result.

### Limits are the operator's

- **Protected entries** cannot be enabled, disabled, reconfigured, rewritten or
  removed. The composer's own entry is protected by construction, so the agent
  can always undo an edit it made.
- **Setting options on a registry entry restarts it**, which restarts the loop
  and cancels the open turn. That is why the assembly above protects all five
  registry entries, and why `select_model` exists: swapping the model is the one
  common change that restarts nothing.
- **The catalog is a closed list.** An unknown name comes back as an error
  naming what is on offer, and options that the plugin's own validator rejects
  change nothing at all.
- **The agent removes only what it added or wrote**, and reads back only source
  it wrote.

### Plugins it writes

Plugin source is an ES module: its default export is the setup function, its
other exports are the handlers it registers. It reaches the client only through
the **stubs** the operator granted it.

```ts
export default async function ({ stubs }) {
  await stubs.tools({
    name: 'add_up',
    description: 'Add two numbers',
    parameters: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
    handler: 'addUp',
  })
  await stubs.prompt({ name: 'arithmetic', text: 'Use add_up to add.' })
}

export function addUp({ a, b }) {
  return a + b
}
```

`agentStubs` is the pair above — `toolsStub` and `promptStub`. Grant one, both,
or your own: whatever a written plugin can do, a stub was granted for it. Each
grant carries the `.d.ts` text it is checked against, and `read_plugin` hands
the model exactly those declarations, so what type-checks is what runs.

A tool declares its arguments as JSON Schema, because plain data is all that can
cross a host boundary. That one schema is both what the model is shown and what
its arguments are validated against.

Rewriting works the way a careful editor does: the agent must `read_plugin` the
entry first, and the rewrite is refused if the source moved since that read.
Rewriting runs the previous code's cleanups, so nothing it registered — a tool,
a prompt section, anything it held — survives.

When source fails, the failure comes back in the tool result rather than in a
log: the phase (`check`, `parse`, `load`, `setup`, `call`), the message, the
line and column where they are known, and the checker's diagnostics. One shape
for all five, so the model corrects and rewrites in the same turn.

### Type checking is optional, and is a plugin

Provide `sourceCheckerKey` and source is type-checked against the declarations
of exactly the stubs its entry was granted, before anything starts it; the
diagnostics reach the model in the tool result. Provide nothing and source
starts as written. Either way the tools behave the same.

## Writing a model provider

A provider is any plugin that provides `modelKey` with something that streams.

```ts
import { createPlugin } from '@tanstack/compose'
import { modelKey } from '@tanstack/compose-agent'

const myModel = createPlugin({
  name: 'my-model',
  provides: [modelKey],
  setup(instance) {
    instance.provide(modelKey, {
      name: 'my-model',
      async *stream(request, signal) {
        yield { kind: 'text', text: 'hello' }
        yield {
          kind: 'tool-call',
          call: { id: 'c1', name: 'search', args: {} },
        }
      },
    })
  },
})
```

The loop reads the key at the moment it makes a request, so a provider can be
swapped between steps and nothing downstream is restarted.

## Learn more

- [`DESIGN.md`](./DESIGN.md) — the keys, the session log, the turn/step machine, cancellation
- [`@tanstack/compose-agent-openai`](../compose-agent-openai) — the OpenAI-compatible provider
- [`CONTEXT.md`](../../CONTEXT.md) — the glossary these terms come from
- [`docs/acceptance/agent.md`](../../docs/acceptance/agent.md) — the contract, criterion by criterion
- [`docs/acceptance/self-modification.md`](../../docs/acceptance/self-modification.md) — what the composer is held to
