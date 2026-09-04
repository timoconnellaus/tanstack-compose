---
status: accepted
---

# Interception is middleware around named actions; events are observe-only

A plugin that wants to change what another plugin does registers middleware around an action the other plugin exposes, with the same `next`-based contract as TanStack Start's `createMiddleware`. Events are strictly for observation: listeners cannot return values or stop anything. We rejected a single event bus with several dispatch modes (broadcast, serial, veto-able) because it blurs "observe" and "alter" into one API, makes the mode part of each event's contract, and has no precedent elsewhere in TanStack.

## Consequences

- Anything interceptable must be declared as an action by its owner; observation needs no such declaration.
- Options updates and reconciliation are actions, so tooling can wrap them.
- Events carry exactly one behavioural choice, fire-and-forget or awaited, expressed in their type.
