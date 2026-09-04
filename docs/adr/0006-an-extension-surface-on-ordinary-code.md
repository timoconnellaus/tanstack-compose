---
status: accepted
---

# Compose is an extension surface on ordinary code, not a way to build the whole application

A deployed product is written as ordinary application code. Its author places **slots**, declares **actions**, provides **context keys** and defines **grants** at exactly the points they want to be changeable at runtime, and nowhere else. Plugins fill, wrap and add at those points. The product is never built _out of_ plugins, and the kernel carries nothing whose purpose is for the base to compose itself (there are no child instances, no `start()`).

We rejected the stance Cordis and DeepSeek Harness take, where everything including the shell is a plugin, because it taxes the code the product team writes and deploys themselves (indirection, two ways to do everything, a type projection to maintain) in exchange for a property they do not need there. The plugin is justified only where the author is untrusted, the time is runtime, and the blast radius must be bounded: code written by an agent on a user's behalf, or a feature a tenant turns on. A plugin is the unit of code that can be written by someone you do not trust, at a time you are not present, and taken back in one step.

## Consequences

- The three authors are distinct and the docs say so: the product developer writes the base at build time in TypeScript; an operator edits the plugin list at runtime with options validated by each plugin's validator; an agent writes plugin **source** at runtime, hosted, and reaches only its **grants**.
- The base-author rule: anything the agent should be able to change is an action (wrap it), a slot (fill it) or a grant (reach it). Behaviour not exposed this way is not changeable, by design.
- One **client** per tenant. Scoped child clients are not needed for this stance and are deferred until a Router or Start integration asks for them.
- An agent loop, session log and model registry are not part of compose. What compose offers an agent is the tool surface over a client (list, enable, configure, add from catalog, read, write, rewrite, remove) as plain tool definitions any agent runtime can mount.
