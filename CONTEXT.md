# TanStack Compose

A composable plugin runtime: an application is assembled from plugins that can be added, removed, replaced, and reconfigured while it runs, with full type inference and framework-agnostic core.

## Language

### Assembly

**Client**:
The root object that owns a running application: its plugin list, context, and lifecycle. One client per application (or per request on a server).
_Avoid_: runtime, container, app, root context

**Plugin**:
A unit of contribution authored once and started by a client. It may provide context, register middleware and listeners, hold resources, and start other plugins.
_Avoid_: module, extension, service, feature

**Plugin instance**:
One started occurrence of a plugin within a client, with its own status, options, and held resources. The same plugin may have several instances.
_Avoid_: fiber, scope, runtime

**Plugin entry**:
One row of the plugin list: a stable `id`, the plugin, its options, and whether it is enabled.
_Avoid_: config row, mount, registration

**Plugin list**:
The ordered set of plugin entries that describes what a client runs. Editing it while running is how the application changes shape.
_Avoid_: config, manifest, plugin tree, composition

**Reconcile**:
Bring the running instances into line with the plugin list, changing only what differs by entry `id`.
_Avoid_: reload, sync, apply

### Dependencies

**Context**:
The typed set of values plugins share through the client. A plugin provides into it and reads from it.
_Avoid_: services, registry, DI container, injection

**Context key**:
A typed identifier for one value in context. Keys are created with a builder so the value's type travels with the key.
_Avoid_: token, service name, symbol

**Deps**:
The context keys a plugin declares it needs before it can start.
_Avoid_: inject, requires, dependencies list

**Provide**:
Put a value into context under a key, for the lifetime of the providing instance.
_Avoid_: register, bind, expose

### Behaviour

**Action**:
A named operation a plugin exposes so other plugins can wrap it with middleware.
_Avoid_: hook, waterfall, pipeline, tap

**Middleware**:
A function wrapped around an action that can change its input, change its result, or stop it by not calling `next`.
_Avoid_: interceptor, hook, waterfall listener, around-advice

**Event**:
A typed, named notification a plugin emits; listeners observe it and cannot alter it.
_Avoid_: signal, hook, message

**Listener**:
A function subscribed to an event for the lifetime of the subscribing instance.
_Avoid_: handler, observer, subscriber

### Lifecycle

**Status**:
Where a plugin instance is in its life: `pending` (waiting on deps), `active`, `error`, or `removed`.
_Avoid_: state, phase, lifecycle stage

**Cleanup**:
A function returned by a registration or resource acquisition that undoes it; the client runs every cleanup of an instance when the instance is removed.
_Avoid_: disposer, dispose, effect, teardown handle

**Options**:
The validated, defaulted settings a plugin instance runs with.
_Avoid_: config, settings, props

**Validator**:
A Standard Schema used to validate and default options before an instance starts.
_Avoid_: schema (when meaning the runtime check), config class

### Execution

**Host**:
The environment a plugin's code executes in. The in-process host is the default; a remote host runs a plugin in isolation and represents it to the client as an ordinary instance.
_Avoid_: sandbox, runtime, isolate, executor, loader

### Tooling

**Adapter**:
A thin framework package (e.g. `react-compose`) that exposes a client to a UI framework through its idioms.
_Avoid_: binding, integration, bridge

**Devtools**:
The inspection surface: instances with status and unmet deps, held resources, and event/middleware traces.
_Avoid_: inspector, debugger
