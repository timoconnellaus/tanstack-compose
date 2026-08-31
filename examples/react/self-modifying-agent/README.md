# Example: self-modifying agent

A chat page where **every element is a plugin**. The page frame, the message
list, the input box, the send **action**, the stop button, the plugin panel, the
model picker and the action log are each one **plugin entry**, and disabling any
of them takes it off the page while the rest keeps working.

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
replaying a canned conversation. The page never holds a key. To talk to a real
model, point `VITE_OPENAI_BASE_URL` (and optionally `VITE_OPENAI_MODEL`) at an
OpenAI-compatible endpoint that needs none from the browser — the app's own
`/ai` route, served by a Worker over the Workers AI binding — and reload;
nothing else in the assembly changes.

```sh
VITE_OPENAI_BASE_URL=/ai pnpm --filter @tanstack/compose-example-react-self-modifying-agent dev
```

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
- **Pick a model.** With a key set, both providers are registered and the picker
  swaps between them through `select_model`, which restarts nothing.

## How a person's edit reaches the plugin list

The panel never writes to the plugin list. It calls the composer's own **tools**
— `enable_plugin`, `disable_plugin`, `remove_plugin`, `select_model` — through
`toolCallAction`, the same action the loop dispatches for the model's calls. So:

- every middleware wrapping tool calls sees a person's edit too;
- the call and its result are appended to the session, and show up in the message
  list beside the conversation;
- a protected entry refuses a person exactly as it refuses the model.

The loop's handler for `toolCallAction` only knows the tools the open turn was
built with, and there is no open turn when someone clicks a button. So
[`src/plugins/ui-tool-calls.ts`](./src/plugins/ui-tool-calls.ts) wraps the action
with middleware that runs a UI-issued call (turn `0`) against the live **tool**
registry. It is one small plugin, and it is the only place that knows a person
can call a tool.

One wrinkle worth knowing: those entries make the session contain a tool result
with no assistant message calling for it, which a strict provider would reject.
Folding UI-issued calls into what the model is shown is a job for middleware
around the **request**, and this example does not do it.

## The slots

| Slot                 | Declared by  | Filled by                                            |
| -------------------- | ------------ | ---------------------------------------------------- |
| `root`               | —            | page frame                                           |
| `chat.main`          | page frame   | message list (0), input box (10)                     |
| `chat.side`          | page frame   | plugin panel (0), model picker (10), action log (20) |
| `chat.message`       | message list | one **keyed** fill per session entry kind            |
| `chat.input.actions` | input box    | stop button                                          |

`chat.message` is keyed by `entry.kind`, so replacing how one kind of entry reads
is a fill, not a change to the message list. An entry of a kind nothing fills —
the turn and step boundaries — renders nothing.

## Not here yet

The assembly in `src/client.ts` ends with the place slice 5a part 2 lands: the
source checker plugin and the UI **stubs** a written **view** is granted. Until
then the agent can write plugins with tools, but not ones that put something on
the page.
