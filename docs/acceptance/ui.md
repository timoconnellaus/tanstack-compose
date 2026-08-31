# UI acceptance criteria

The UI is assembled from plugins exactly as the agent is. Slice 5a is done when
§A–§D hold in a single browser client; slice 5b is done when §E–§F hold with a
server client on Cloudflare. Terms are as defined in [CONTEXT.md](../../CONTEXT.md);
earlier slices' criteria continue to hold.

## A. Slots

- **A1** A slot is created like a context key, typed by the props it passes to its fills, and declares how many fills it takes: a list rendered in order, a single fill where the latest wins, or fills keyed by a value the slot's props carry. A plugin fills a slot with an order and a renderer, and the fill is gone when the plugin's cleanup runs.
- **A2** The slot registry is a context key provided by one plugin for the life of the client; its state is observable, so a renderer re-renders when a fill is added or removed without anything restarting.
- **A3** A slot's fills render in order; the plugin that renders the slot decides layout; a fill may itself render a slot.
- **A4** Rendering a slot no plugin fills renders nothing and is not an error.

## B. The adapter (`@tanstack/react-compose`)

- **B1** The adapter exposes a client to React through a provider, a hook per client store, a hook to read a context key, and a `Slot` component; it knows nothing about agents or chat.
- **B2** Reading a context key that is not provided suspends or returns `undefined` per the caller's choice, and re-renders when the key is provided or withdrawn.
- **B3** The adapter's types are inferred from the slot and key definitions; a fill's renderer sees the slot's props type with no casts.

## C. Everything on the page is a plugin

- **C1** The example app is `createClient({ plugins })` and a provider rendering one root slot. The page frame, message list, input box, send action, stop button, plugin panel and model picker are each a plugin; disabling any one of them through the plugin list removes it from the page while the rest keep working.
- **C2** The stop button is a plugin that depends on the agent and the slot registry, fills the input box's actions slot, is enabled only while a turn is running, and cancels the turn when pressed; nothing else on the page knows it exists.
- **C3** The plugin panel edits the plugin list through the same composer tools the model uses, so a human's edit and the agent's edit take one path and both appear in the session.
- **C4** UI actions that change agent state (send, cancel, edit the plugin list) are actions, so middleware applies to a human's click as to the model's tool call.

## D. Views

- **D1** A plugin may have a view: a module with the written-plugin shape whose stubs are UI-facing — `slots` to fill slots, `server` to call its own plugin's named exports, and reads of the session and agent state. A view runs in the browser client's in-process host. Which slots a view may fill is part of its grant, so a written view cannot fill a slot it was not given.
- **D1a** A view that throws while rendering leaves its instance in `error` with the message, and the rest of the page keeps rendering; a fill that fails is removed from its slot, not left blank in place.
- **D2** A written plugin may include view source; it is type-checked against view declarations derived from its granted UI stubs and from the plugin's own named exports, so a view calling a handler the plugin does not export is a diagnostic, not a runtime error.
- **D3** Adding a plugin with a view fills its slots in the same page without reload; removing or rewriting it empties or replaces them; nothing the old view registered survives.
- **D4** In-page views have the trust of the in-process host: the operator's own code, or an agent the operator trusts. Isolating written views is a host concern and is not claimed here.
- **D5** One test runs the whole app in a browser environment with the scripted provider: the model writes a plugin with a tool and a view that adds a button beside Stop; the button appears, pressing it calls the plugin's handler through the server stub, the result reaches the session; the model removes the plugin and the button is gone with no leaked resources.

## E. Following a server (5b)

- **E1** A browser client follows a server client: for every active server entry with a view it holds one entry with that view's source, keyed by content hash; entries without views and browser-only shell entries are unaffected. Changes to the server's plugin list arrive as a plugin-list edit in the browser and reconcile with the kernel's semantics.
- **E2** The follow is resilient: the browser reconnects and reconverges after a dropped connection, and never runs a view whose content hash the server does not currently list.
- **E3** A view calls its plugin's server handlers through a stub that crosses the connection; the calling instance id is attached by the shell, not by the view, and middleware on the server sees it.
- **E4** The follow reports back: the browser client's status for each followed entry (including a view that failed to load or render) is visible on the server, so the composer's results and `list_plugins` show the agent whether the UI it added is actually on the page.

## F. Served on Cloudflare (5b)

- **F1** The loader Worker serves the shell page and views by content hash with immutable caching; the same plugin list yields byte-identical assets.
- **F2** A written plugin's server half runs in the Dynamic Worker host and its view runs in the browser; both are versioned by the same content hash, so the page never shows a view whose server half is not the one running.
- **F3** One test drives the served app end to end: a human message, the agent writing a plugin with a view, the button appearing in the followed browser client, its handler running in the Dynamic Worker, removal, no leaked resources on either client.
