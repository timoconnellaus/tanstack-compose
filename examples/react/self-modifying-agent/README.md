# Example: self-modifying agent

A chat page where **every element is a plugin**. The page frame, the message
list, the input box, the send **action**, the stop button, the plugin panel, the
model picker and the action log are each one **plugin entry**, and disabling any
of them takes it off the page while the rest keeps working. The plugin that lets
a **view** the agent writes fill a **slot** is another entry — which is how the
agent adds UI to the page it is made of. The **source checker** is client
infrastructure, so editing the plugin list cannot bypass it.

`main.tsx` is the whole of the wiring:

```tsx
createRoot(root).render(
  <ComposeProvider client={createAppClient()}>
    <Slot of={rootSlot} />
  </ComposeProvider>,
)
```

Everything else is [`src/client.ts`](./src/client.ts) — one **plugin list** — and
one file per plugin under [`src/plugins`](./src/plugins).

## Running it

```sh
pnpm install
pnpm build:all
pnpm --filter @tanstack/compose-example-react-self-modifying-agent dev
```

It runs with **no credential**: the **model provider** is the scripted one,
replaying a canned conversation. The page never holds a key.

### With a real model, still with no key

The app's own `/ai` route speaks the OpenAI-compatible protocol over a Cloudflare
**Workers AI** binding. The binding stays in the Worker; the page is talking to
its own origin, so there is no key in the browser and `credential: null` in
`src/client.ts` says so.

```sh
pnpm --filter @tanstack/compose-cloudflare exec wrangler login   # once
VITE_OPENAI_BASE_URL=/ai pnpm --filter @tanstack/compose-example-react-self-modifying-agent dev:ai
```

`dev:ai` runs two things: `wrangler dev` on port 8787, serving
[`packages/compose-cloudflare/dev/worker.ts`](../../../packages/compose-cloudflare/dev/worker.ts)
— whose `/ai/chat/completions` route is `handleChatCompletions(request, env.AI)`
and nothing else — and Vite on port 3060, which proxies `/ai` to it
(`vite.config.ts`). `VITE_OPENAI_MODEL` picks the model; nothing else in the
assembly changes when you swap the provider.

Inference always runs on Cloudflare, including under `wrangler dev`, so this
needs a logged-in account and spends its allocation.

Tests:

```sh
pnpm --filter @tanstack/compose-example-react-self-modifying-agent test:lib
```

They also run from the root, as part of `pnpm test:ci`.

## What to click

- **Type something and press Send.** The input box owns a send action; the agent
  takes the input, opens a **turn**, and the message list renders the **session**
  as it fills up. Watch the Actions panel: the click arrived as an action, and
  **middleware** wrapped it.
- **Press Stop while it is answering.** The stop button is enabled only while the
  turn is running, and cancels it through an action of its own. Nothing else on
  the page knows the button exists.
- **Disable `stop-button` in the Plugins panel.** The button beside Send
  disappears; Send, the message list and everything else keep working. Enable it
  and it comes back in the same place. Do the same to `message-list`,
  `model-picker`, `action-log` — or to `page-frame`, which leaves a blank page
  and a client that is still running perfectly well.
- **Ask the agent to put it back.** `stop-button` and `model-picker` are in the
  **plugin catalog**, so the model can `add_plugin` either of them.
- **Try to disable `loop`.** It is a **protected entry**: the refusal appears in
  the conversation, because a person's edit and the model's edit take the same
  path.
- **Watch the agent write itself a button.** Keep sending messages: the canned
  conversation reaches a turn where the model calls `write_plugin` with a
  **view** — a Summarise button that appears beside Stop, with no reload. Press
  it: the view reads the end of the **session**, calls its own plugin's handler
  through the `server` **stub**, and fills the same place again with the answer.
  Remove `summariser` in the panel and both halves go, the button with them.
- **Pick a model.** With `/ai` in use, both providers are registered and the
  picker swaps between them through `select_model`, which restarts nothing.

## How a person's edit reaches the plugin list

The panel never writes to the plugin list. It calls the composer's own **tools**
— `enable_plugin`, `disable_plugin`, `remove_plugin`, `select_model` — through
`agent.invoke`, the **human step**: one tool call issued by a person, outside any
**turn**, dispatched through the same `toolCallAction` the loop dispatches for
the model's calls. So:

- every middleware wrapping tool calls sees a person's edit too, and the Actions
  panel writes a line for a person's call beside the model's;
- the call and its result are appended to the session as `human-tool-call` and
  `human-tool-result`, and show up in the message list beside the conversation;
- a protected entry refuses a person exactly as it refuses the model.

What the model is shown is not a tool message — there is no assistant message
asking for a call a person made, and a transcript with an orphan tool result is
not one a provider accepts. A human step derives one `user` message instead:

```
The operator ran the tool "disable_plugin" with {"id":"action-log"} — result: …
```

so the model reads what you did as a plain fact at its next request.

## The slots

| Slot                 | Declared by  | Filled by                                            |
| -------------------- | ------------ | ---------------------------------------------------- |
| `root`               | —            | page frame                                           |
| `chat.main`          | page frame   | message list (0), input box (10)                     |
| `chat.side`          | page frame   | plugin panel (0), model picker (10), action log (20) |
| `chat.message`       | message list | one **keyed** fill per session entry kind            |
| `chat.input.actions` | input box    | stop button, and any **view** the agent writes       |

`chat.message` is keyed by `entry.kind`, so replacing how one kind of entry reads
is a fill, not a change to the message list. An entry of a kind nothing fills —
the turn and step boundaries — renders nothing.

## Views: the agent adds UI by writing a plugin

`write_plugin { id, source, view }` writes **two** plugin entries: `summariser`,
the server half, and `summariser.view`, the part that runs in the browser. Both
are type-checked by the client's `createTypeScriptChecker()` before either is
started, against the **plugin declarations** derived from exactly the **stubs**
the entry was granted — so a view calling a handler its plugin does not export,
or filling a slot the operator did not grant it, is a diagnostic in the tool
result rather than a failure on the page.

What this app grants a view, in `src/client.ts`:

```ts
viewStubs,                                              // slots, server, agent, session
viewSlots: ['chat.input.actions', 'chat.side', 'chat.main'],
```

`root` is not in the list: the page frame is the operator's, and a view that
could replace it could replace the whole page.

A view describes its fill as plain data — a tree of `text`, `button`, `input`,
`row` and `stack`, with the _name_ of one of its own exports where a callback
would be, because a function cannot cross a **host** boundary.
`viewsPlugin` from `@tanstack/react-compose` turns that tree into a component
and publishes it with this page's **slot** registry. That entry is
**protected**: a view that could remove it could take every view off the page.

The source the canned conversation writes is in
[`src/written.ts`](./src/written.ts), so you can read what the model "wrote".
