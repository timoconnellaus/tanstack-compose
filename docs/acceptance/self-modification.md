# Self-modification acceptance criteria

Slice 3 gives the agent tools to edit the plugin list of its own client. It is
done when every criterion below holds and is covered by the test suite. Terms
are as defined in [CONTEXT.md](../../CONTEXT.md); [kernel.md](./kernel.md) and
[agent.md](./agent.md) continue to hold.

## A. The tools

- **A1** A plugin provides the model with tools to: list the plugin list with each entry's status and, when `pending`, its missing deps; enable or disable an entry; set an entry's options; add an entry from the plugin catalog; remove an entry it added.
- **A2** Every one of these tools acts only through the client's plugin list; there is no second path by which the agent changes what runs.
- **A3** A tool's result reports the state after the edit settled — the affected entries and their statuses — so the model can see the consequence of what it did in the same step.
- **A4** These tools are ordinary tools: they go through the tool-call action, so approval, logging and refusal middleware apply to them exactly as to any other tool.

## B. Limits

- **B1** Protected entries cannot be disabled, removed or reconfigured by the agent; the attempt returns an error result naming the entry as protected and changes nothing.
- **B2** The plugin that provides the self-modification tools is itself protected by construction, so the agent can always undo an edit it made.
- **B3** The agent can only add plugins from the plugin catalog, by name, with options validated by that plugin's validator; an unknown name or invalid options return an error result and change nothing.
- **B4** Which entries are protected and what the catalog contains are decided by the operator when assembling the client, not by anything the model can call.

## C. Consequences are visible and recoverable

- **C1** Disabling an entry that others depend on leaves those dependents `pending` with their missing deps named in the tool result; re-enabling it restores them, and the model can do both in one turn.
- **C2** Every self-edit is in the session as a tool call and its result, so a replayed or forked session shows what the agent changed and why.
- **C3** An edit that fails to reconcile leaves the client as it was and returns the failure to the model as an error result; the turn continues.
- **C4** A plugin the agent adds mid-turn is fully usable in the next step: its tools are offered, its prompt sections are assembled, its context is available to dependents.

## D. End-to-end

- **D1** One test runs a conversation against the scripted provider in which the model: lists the plugins, disables one that a tool depends on, sees the dependent go `pending`, re-enables it, adds a plugin from the catalog, uses a tool that plugin provides in the next step, attempts to disable a protected entry and is refused; the test asserts the session log, the final plugin list, and that the client holds no leaked resources.
