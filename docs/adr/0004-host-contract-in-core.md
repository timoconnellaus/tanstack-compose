---
status: accepted
---

# The host contract lives in core; isolation libraries live in host packages

`@tanstack/compose` defines the host contract and ships the in-process host; each way of running a plugin in isolation is its own package (`@tanstack/compose-worker` for Web Worker + Hardened JavaScript, `@tanstack/compose-cloudflare` for Dynamic Workers). Core stays dependency-free and can run a plugin from a source string, which the self-modification story requires; the isolation packages carry their own dependencies (`ses`, Cloudflare types) so consumers pay only for the host they use. We use the `ses` shim for Hardened JavaScript rather than writing our own lockdown: a capability-safe JavaScript environment is security infrastructure with a decade of hardening behind it, and the contract is written against the shape of the TC39 Compartment proposal so the shim can be swapped for a native implementation if one ships.

## Consequences

- A host package never changes how a plugin is written; authority crosses the boundary only as stubs, and the in-process host is the oracle every other host must match.
- `lockdown()` is a process-global choice made by whoever installs `compose-worker`, never by core.
- A new runtime means a new small package, not a change to core.
