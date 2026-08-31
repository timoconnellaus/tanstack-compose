---
status: accepted
---

# Stubs cross a remote host boundary as loopback entrypoints carrying the caller

In the in-process host a stub is a closure the client built for one instance, so the calling instance is known by construction. A closure cannot enter an isolate. For remote hosts the stub must be an RPC handle, and the handle must carry the calling instance's id where the plugin's code cannot read or change it.

For `@tanstack/compose-cloudflare` a hosted instance's `env` holds one loopback entrypoint per granted stub, minted by the host from the loader Worker's own exports with `props` set to `{ instanceId, stub }`. The plugin calls `env.tools(input)`; the entrypoint runs in the loader Worker, reads `ctx.props`, and dispatches `stubCallAction` with the id from `props` and the input from the call. Nothing else is placed in `env`: no bindings, no raw resources, no ability to reach the loader's other exports. The client and the kernel run in the loader Worker; only the written module runs in the Dynamic Worker.

We chose this over the alternatives: passing platform bindings into `env` (ambient authority the plugin did not ask for, and no attribution); passing live RPC targets in `env` (not a documented path, and the target would have to re-resolve the client per call); and a fetch-based protocol into the host's own handler (loses RPC's typing and structured-clone semantics for no gain).

## Consequences

- The written module's `stubs` object is built by a host-generated wrapper module that maps `env.<name>` to `stubs.<name>`, so plugin source is identical to what runs in-process.
- A host package never sees the plugin's authority as data it could leak: the props are readable only by the loader Worker, and every call is a client-side action that middleware can refuse.
- Any host with an RPC-and-props equivalent (a `Compartment` with endowments, a `MessagePort` with a per-port id) implements the same rule with its own mechanism; the in-process host remains the oracle for behaviour.
