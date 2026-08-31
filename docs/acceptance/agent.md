# Agent layer acceptance criteria — `@tanstack/compose-agent`

The agent layer is done when every criterion below holds and is covered by the
test suite. Criteria are observable from outside the package and say nothing
about how they are met. Terms are as defined in [CONTEXT.md](../../CONTEXT.md);
the kernel's criteria in [kernel.md](./kernel.md) continue to hold.

## A. Everything is a plugin

- **A1** The agent is an ordinary client: the model provider, the tool registry, the prompt assembly, the session log and the loop itself are each plugins, and any of them can be removed, replaced or reconfigured through the plugin list while a conversation is open.
- **A2** The package provides context keys for `model`, `tools`, `prompt`, `session` and `agent`; a consumer declares the keys it needs and never imports a provider.
- **A3** A conversation can be assembled with nothing but the package's plugins and a scripted model, with no network and no credentials; the same assembly with a real model provider swapped in is the production shape.

## B. Session is the source of truth

- **B1** Every model-visible fact — user input, assistant output including streamed chunks, tool calls and tool results, turn and step boundaries — is appended to the session before or as it happens; nothing reaches a request that cannot be derived from the log.
- **B2** The messages for a request are derived from the session log, not kept as separate mutable state; deriving twice from the same log yields identical messages.
- **B3** A session can be replayed from its log into a fresh client and yields the same derived messages; a session can be forked at any step boundary.
- **B4** Session appends are observable as events, so a UI or a persistence plugin can follow a conversation without importing the loop.

## C. The loop

- **C1** Input queued while the agent is idle starts a turn; input queued while a turn is running is taken up at the next step boundary, in order.
- **C2** A step is one request followed by the tool calls in its response; a turn continues with another step while the last response called tools or new input is waiting, and closes otherwise.
- **C3** The prompt for each step is assembled from the prompt sections registered at that moment, in order; a section added or removed between steps shows up in the very next request.
- **C4** The tools offered to the model on each step are exactly those registered at that moment; a tool registered mid-turn is callable in the next step, and a removed one is neither offered nor executable.
- **C5** Cancelling a running turn stops the in-flight request and any running tool calls, records the cancellation in the session, and leaves the agent idle and reusable.
- **C6** Removing the loop plugin mid-turn cancels per C5 as part of its cleanup; nothing continues to run or write to the session after removal reports done.
- **C7** The agent exposes its status (`idle` / `running`) through a store, and a caller can await the moment the agent next becomes idle.

## D. Requests and tool calls are actions

- **D1** Sending a step to the model is an action; middleware can rewrite the messages, tools or options the model receives, or veto the step, and the loop cannot tell which happened.
- **D2** Executing a tool call is an action; middleware can rewrite the arguments, replace the result, or refuse the call with a result the model sees as an error, and the tool cannot tell which happened.
- **D3** Tool arguments are validated against the tool's validator before the tool runs; invalid arguments produce an error result for the model, not a thrown exception in the loop.
- **D4** Tool calls within one step run with their declared concurrency: independent calls may run in parallel, calls marked exclusive run alone, and results are appended in the order the model issued the calls.
- **D5** A tool that throws produces an error result in the session and the turn continues; a model provider that fails ends the step with an error recorded in the session and the turn closes with the agent idle.

## E. Model providers

- **E1** A model provider streams its response; each chunk is appended to the session as it arrives and the complete assistant message is appended when the stream ends, whether it ended normally, with an error, or by cancellation.
- **E2** A provider is chosen entirely by which plugin provides the `model` key; swapping providers between steps takes effect on the next request with no change to any other plugin.
- **E3** The package ships a scripted provider for tests that replays a given sequence of responses, including tool calls and mid-stream failures.
- **E4** One real provider package exists, speaking the OpenAI-compatible chat-completions protocol over `fetch` with no vendor SDK; its keyless tests run in CI and its with-key smoke test skips itself when no key is present.

## F. Types

- **F1** A tool's arguments and result are typed from its definition; the loop, middleware and tests see those types without casts.
- **F2** Session event payloads are a discriminated union; a plugin listening to session events narrows on the event kind.
- **F3** All of the above holds across package boundaries with value imports only.

## G. End-to-end

- **G1** One test runs a two-turn conversation against the scripted provider with three tools, one exclusive; a middleware plugin refuses one call and rewrites another; a prompt section is added between turns; the model provider is swapped between turns; the test asserts the derived messages, the session log, the order of tool results, and that the client holds no leaked resources afterwards.
