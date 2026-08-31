# Hosts acceptance criteria

Hosts let a plugin's code run somewhere other than the client's own process.
Section A — the contract and the in-process host — is delivered with
self-modification (slice 3), because an agent that writes plugins needs it
first. Sections B–E are delivered per host package, each in its own slice. A
host is done when every criterion below holds for it and is covered by the test
suite. Terms are as defined in [CONTEXT.md](../../CONTEXT.md); earlier slices'
criteria continue to hold.

## A. The host contract (core)

- **A1** The core package defines what a host is: given a plugin's source as a string and the stubs it may use, a host starts it, lets the client call into it, and stops it. The in-process host ships in core and is the reference every other host is measured against.
- **A2** A hosted plugin appears to the client as an ordinary instance: it has an id, a status, options, deps and provides, held resources, and cleanup; the kernel's criteria hold for it unchanged.
- **A3** A plugin entry may name the host it runs in; entries that name none run in-process. Changing an entry's host is an options change: the instance restarts in the new host.
- **A4** Authority crosses a host boundary only as stubs. A hosted plugin can call what it was handed and nothing else; the set of stubs an entry receives is decided by the operator when assembling the client.
- **A5** Stub calls are asynchronous in both directions and carry only structured-clone-safe values; a plugin written against stubs runs unchanged in every host, including in-process.

## B. Every host

- **B1** A hosted plugin cannot reach the network, the filesystem, the process, the DOM, timers, or another plugin except through a stub it was given; a test for each attempts the escape and observes failure.
- **B2** Code that never yields is stopped within a configured wall-clock limit; the instance ends in `error` with the limit named, and the client and its other instances keep working.
- **B3** Removing a hosted instance stops its code and reports done only once the host has released it; nothing the plugin started runs or calls a stub after removal completes.
- **B4** An exception thrown in the hosted plugin surfaces as the instance's error with the original message and a usable stack; it never crashes the client.
- **B5** The kernel's acceptance suite, run with each host in place of the in-process host, passes; where a criterion cannot apply to a hosted plugin, the host's design notes say why.

## C. `@tanstack/compose-worker`

- **C1** One implementation runs a hosted plugin in a Web Worker under Hardened JavaScript in Bun, Node and browsers; only the worker-spawning shim differs per runtime.
- **C2** Startup and per-call cost are measured in the test suite and held under a documented budget.

## D. `@tanstack/compose-cloudflare`

- **D1** A hosted plugin runs in a Dynamic Worker with outbound network disabled by default; stubs are passed as RPC handles; the same suite passes under `wrangler dev` and in CI.
- **D2** Each hosted instance is keyed by plugin identity and content hash, so re-adding an unchanged plugin does not create a new isolate and a changed plugin does.
- **D3** Calls into a hosted plugin carry a wall-clock timeout on the client side, independent of any limit the platform enforces.

## E. End-to-end

- **E1** One test assembles an agent whose model writes a plugin as source, adds it through the self-modification tools into a named host, uses a tool that plugin provides in the next step, then removes it; the test asserts the plugin never had access beyond its stubs and that the client holds no leaked resources afterwards.
