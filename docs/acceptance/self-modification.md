# Self-modification acceptance criteria

Slice 3 gives the agent tools to edit the plugin list of its own client,
including writing plugins as code. It is done when every criterion below and
[hosts.md §A](./hosts.md) (the host contract and the in-process host) hold and
are covered by the test suite. Terms are as defined in
[CONTEXT.md](../../CONTEXT.md); [kernel.md](./kernel.md) and
[agent.md](./agent.md) continue to hold.

## A. The tools

- **A1** A plugin provides the model with tools to: list the plugin list with each entry's status and, when `pending`, its missing deps; enable or disable an entry; set an entry's options; add an entry from the plugin catalog; write an entry from plugin source; read back the source of an entry it wrote and rewrite it; remove an entry it added.
- **A2** Every one of these tools acts only through the client's plugin list; there is no second path by which the agent changes what runs.
- **A3** A tool's result reports the state after the edit settled — the affected entries and their statuses — so the model can see the consequence of what it did in the same step.
- **A4** These tools are ordinary tools: they go through the tool-call action, so approval, logging and refusal middleware apply to them exactly as to any other tool.

## B. Limits

- **B1** Protected entries cannot be disabled, removed or reconfigured by the agent; the attempt returns an error result naming the entry as protected and changes nothing.
- **B2** The plugin that provides the self-modification tools is itself protected by construction, so the agent can always undo an edit it made.
- **B3** The agent adds pre-built plugins only from the plugin catalog, by name, with options validated by that plugin's validator; an unknown name or invalid options return an error result and change nothing.
- **B4** Which entries are protected, what the catalog contains, which stubs a written plugin receives and which host it runs in are decided by the operator when assembling the client, not by anything the model can call.

## C. Consequences are visible and recoverable

- **C1** Disabling an entry that others depend on leaves those dependents `pending` with their missing deps named in the tool result; re-enabling it restores them, and the model can do both in one turn.
- **C2** Every self-edit is in the session as a tool call and its result, so a replayed or forked session shows what the agent changed and why.
- **C3** An edit that fails to reconcile leaves the client as it was and returns the failure to the model as an error result; the turn continues.
- **C4** A plugin the agent adds mid-turn is fully usable in the next step: its tools are offered, its prompt sections are assembled, its context is available to dependents.

## D. Code

- **D1** A plugin entry may carry plugin source instead of a plugin reference. The client starts it through a host — the in-process host by default — and it is an ordinary instance: id, status, options, held resources and cleanup all behave as in [kernel.md](./kernel.md).
- **D2** A written plugin reaches the client only through the stubs it was handed. With the stubs the operator grants it, it can register tools and prompt sections and use context values; the same source runs unchanged in the in-process host and in a remote host.
- **D3** Rewriting an entry's source restarts the instance with the new code; nothing the previous code registered or held survives the rewrite.
- **D4** Source that fails to parse, fails to load, or throws during setup leaves that entry in `error` with the message and, where available, the line; the tool result carries the error so the model can correct and rewrite in the same turn; no other instance is affected.
- **D5** A tool a written plugin registers is offered and executable in the next step; a prompt section it registers is assembled from the next turn, per [agent.md](./agent.md) C3–C4.
- **D6** The agent can read the source of every entry it wrote and of none it did not; an entry from the catalog or the operator's assembly has no source to read.
- **D7** Plugin source is TypeScript and is type-checked before it is started, against declarations derived from exactly the stubs the entry was granted; source that does not type-check is not started, the entry is left as it was, and the tool result carries the diagnostics with line and column so the model can correct and rewrite in the same turn.
- **D8** The declarations a written plugin is checked against are the ones the model is shown: the composer can hand the model the declarations for the stubs it has, and a plugin that type-checks against them runs against them without casts.
- **D9** Type checking is a plugin behind a context key, not part of core: a client without it starts source unchecked, and a client with it checks in the in-process host and in every remote host alike.

## E. End-to-end

- **E1** One test runs a conversation against the scripted provider in which the model: lists the plugins, disables one that a tool depends on, sees the dependent go `pending`, re-enables it, adds a plugin from the catalog, uses a tool that plugin provides in the next step, writes a plugin as source with a type error, reads the diagnostics, rewrites it so it throws on setup, reads the error, rewrites it again, uses the tool it registers in the next step, attempts to disable a protected entry and is refused, and removes the plugin it wrote; the test asserts the session log, the final plugin list, and that the client holds no leaked resources.
