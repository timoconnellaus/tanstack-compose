/**
 * `@tanstack/compose-agent` — the agent vocabulary, built entirely on the kernel.
 *
 * Scaffold only. See `ROADMAP.md` (slice 4) for when it gets built and
 * `CONTEXT.md` for the terms it has to use. This package exists to show that a whole agent
 * product is "just plugins", with no privileged core to patch. It will hold the
 * capability *seams* — a definition that owns the key and its vocabulary types,
 * shipped alongside a default provider, with every consumer naming only the key:
 *
 * - **model** — a model-adapter registry. Swapping the provider swaps the backend
 *   for everything downstream, with no forks.
 * - **tools** — a tool registry whose `register()` returns an undo owned by the
 *   *calling* instance, so unloading a tool plugin unregisters its tools.
 * - **prompt** — a prompt-section registry, ordered and scoped, assembled per turn.
 * - **session** — the session/transcript log, plus the turn loop itself as a plugin.
 *
 * The loop is intercepted, never imported: pre-request rewriting, tool pre/execute/post
 * wrapping, turn-stop decisions and approval policy are all waterfall or serial events,
 * so a policy plugin vetoes by declining to delegate.
 *
 * Per-agent worlds come from scoped runtime views: each live agent gets its own view,
 * and tools, prompt sections and listeners registered through it are visible only to
 * that agent and die with it.
 */

export const AGENT_VOCABULARY = ['model', 'tools', 'prompt', 'session'] as const

export type AgentCapability = (typeof AGENT_VOCABULARY)[number]
