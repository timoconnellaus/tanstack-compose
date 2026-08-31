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

### Agent

**Agent**:
A client whose plugins together run a conversation loop: it takes input, requests a model, runs the tools the model calls, and repeats until nothing is owed.
_Avoid_: assistant, bot, harness, driver

**Session**:
The append-only log of everything that happened in one conversation. It is the source of truth: what the model sees is derived from it, and a session can be replayed from it.
_Avoid_: history, transcript, thread, conversation state

**Turn**:
One drain of input: opens when the agent takes up new input and closes when the model has stopped calling tools and nothing more is queued.
_Avoid_: run, round, exchange

**Step**:
One model request plus the tool calls its response made. A turn is one or more steps.
_Avoid_: iteration, tick, cycle

**Model**:
The context key under which a model provider is offered: it turns messages and tool definitions into a streamed response.
_Avoid_: LLM, adapter, backend, driver

**Model provider**:
A plugin that provides the model key for one vendor or endpoint.
_Avoid_: adapter, connector, integration

**Tool**:
A named, typed capability the model may call; registered by a plugin and executed through an action so middleware can approve, rewrite or refuse the call.
_Avoid_: function, skill, command, capability

**Prompt section**:
A piece of system prompt a plugin contributes; sections are assembled in order for every step.
_Avoid_: system message fragment, instruction block, persona

**Request**:
The action that sends one step's messages and tools to the model; middleware around it can rewrite or veto what the model sees.
_Avoid_: completion, call, inference

**Plugin catalog**:
The set of plugins an agent is allowed to add to its own client, offered by name; an agent cannot add a plugin that is not in the catalog.
_Avoid_: registry, marketplace, library, palette

**Protected entry**:
A plugin entry the agent cannot disable, remove or reconfigure; the plugins that give the agent its self-editing tools, and any policy the operator relies on, are protected.
_Avoid_: locked, pinned, system plugin, core plugin

### Execution

**Host**:
The environment a plugin's code executes in. The in-process host is the default; a remote host runs a plugin in isolation and represents it to the client as an ordinary instance.
_Avoid_: sandbox, runtime, isolate, executor, loader

**Hosted plugin**:
A plugin whose code runs in a host other than the in-process one; the client sees an ordinary instance backed by a proxy.
_Avoid_: remote plugin, sandboxed plugin, isolate plugin

**Stub**:
The async callable handle through which a hosted plugin reaches something on the client side (a tool registry, a context value); the only way authority crosses a host boundary.
_Avoid_: capability, endowment, proxy object, bridge

### Tooling

**Adapter**:
A thin framework package (e.g. `react-compose`) that exposes a client to a UI framework through its idioms.
_Avoid_: binding, integration, bridge

**Devtools**:
The inspection surface: instances with status and unmet deps, held resources, and event/middleware traces.
_Avoid_: inspector, debugger
