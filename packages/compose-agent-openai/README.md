# `@tanstack/compose-agent-openai`

A **model provider** for [`@tanstack/compose-agent`](../compose-agent) that
speaks the OpenAI-compatible chat-completions streaming protocol over the global
`fetch`, with no vendor SDK. It works against OpenAI, DeepSeek, or any local
server that implements the same shape — point `baseUrl` at it.

## Installation

```sh
npm install @tanstack/compose @tanstack/compose-agent @tanstack/compose-agent-openai
```

## Usage

It is one entry in the plugin list. It registers itself into the agent layer's
model registry — `modelsPlugin` owns the `model` key — so nothing else in the
agent knows or cares which provider is running.

```ts
import { createClient } from '@tanstack/compose'
import {
  agentKey,
  credentialsPlugin,
  loopPlugin,
  modelsPlugin,
  promptPlugin,
  sessionPlugin,
  toolsPlugin,
} from '@tanstack/compose-agent'
import { openaiModelPlugin } from '@tanstack/compose-agent-openai'

const client = createClient({
  plugins: [
    // Where this runtime's secrets come from. The default is the environment.
    { id: 'credentials', plugin: credentialsPlugin },
    { id: 'session', plugin: sessionPlugin },
    { id: 'tools', plugin: toolsPlugin, options: { tools: [search] } },
    { id: 'prompt', plugin: promptPlugin },
    { id: 'models', plugin: modelsPlugin },
    {
      id: 'model',
      plugin: openaiModelPlugin,
      options: { model: 'gpt-4o-mini' }, // credential: 'OPENAI_API_KEY'
    },
    { id: 'loop', plugin: loopPlugin },
  ],
})
await client.settled()

const agent = client.getContext(agentKey)!
agent.send('what is on the shelf?')
await agent.idle()
```

The options are `model`, `baseUrl`, `credential`, `headers`, `name` and `stallMs`.
`stallMs` (default 30 000) is how long the endpoint may go quiet, before its
headers or between chunks, before the step ends in error; `0` waits forever. A
proxy that loses its upstream otherwise leaves a turn spinning with no way out
but Stop.

## Options

| Option       | Default                     | What it does                                                  |
| ------------ | --------------------------- | ------------------------------------------------------------- |
| `model`      | required                    | The model name the endpoint knows                             |
| `baseUrl`    | `https://api.openai.com/v1` | The API root; a trailing slash is fine                        |
| `credential` | `'OPENAI_API_KEY'`          | The _name_ of the credential to send; `null` sends no header  |
| `headers`    | `{}`                        | Extra request headers, merged over the ones the provider sets |
| `name`       | the model name              | The provider's name, as it appears in inspection              |

Anything in the loop's `modelOptions` — `temperature`, `top_p`, and so on — is
merged into the request body, so provider-specific settings need no API here.

### The credential

`credential` is a **name**, never a value. The plugin declares
`deps: [modelKey, credentialsKey]` and reads the value through the `credentials`
key when it starts, so the key itself is in no store, no session entry, no tool
result and nothing devtools renders — the entry holds `'OPENAI_API_KEY'` and
that is all anyone can see.

Which runtime the value comes from is the operator's `credentialsPlugin` entry:
the process environment by default, a Worker's bindings under
`@tanstack/compose-cloudflare`, or a value typed into a page.

A credential with no value leaves the entry in `error`, naming the credential:

```
the credential "OPENAI_API_KEY" has no value; provide it through the
credentials plugin, name another one, or set credential: null for an endpoint
that needs none
```

Nothing is registered into the model registry when that happens, so no request
goes out unauthenticated.

### Another endpoint

```ts
{
  id: 'model',
  plugin: openaiModelPlugin,
  options: {
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    credential: 'DEEPSEEK_API_KEY',
  },
}
```

```ts
// An OpenAI-compatible server running locally with no auth. `null` says to send
// no authorization header — it has to be said, so a credential that is simply
// missing is never mistaken for a deliberately keyless endpoint.
{
  id: 'model',
  plugin: openaiModelPlugin,
  options: {
    model: 'llama3',
    baseUrl: 'http://localhost:11434/v1',
    credential: null,
  },
}
```

### Letting an agent edit itself

If the client also runs the **composer**, put this entry in its `protected`
list. The credential value is not in the entry, but `baseUrl` is: reconfiguring
the endpoint would send the credential somewhere the operator did not choose.
`select_model` still switches between the providers the operator registered.

## Swapping providers

Providers register into the model registry, and the registry hands the loop a
provider when a turn opens. So several can be registered at once and switched
between by name, and adding or removing one restarts nothing — it takes effect
at the next turn.

```ts
// Register a second provider alongside this one.
await client.addPlugin({
  id: 'local',
  plugin: openaiModelPlugin,
  options: {
    model: 'llama3',
    baseUrl: 'http://localhost:11434/v1',
    credential: null,
  },
})

const models = client.getContext(modelKey)!
models.list().map((provider) => provider.name) // ['gpt-4o-mini', 'llama3']
models.select('gpt-4o-mini') // used from the next turn on

// Or drop it again; the `model` key and everything downstream stay put.
await client.removePlugin('local')
```

## Tests

The suite runs with a mocked `fetch` replaying recorded server-sent-event
bodies and `staticCredentials`, so it needs no key and no network. One smoke
test reads the environment and talks to a real endpoint, and skips itself unless
a credential has a value:

```sh
OPENAI_API_KEY=sk-… pnpm --filter @tanstack/compose-agent-openai test:lib

# Or point it somewhere else.
COMPOSE_AGENT_CREDENTIAL=DEEPSEEK_API_KEY \
COMPOSE_AGENT_BASE_URL=https://api.deepseek.com/v1 \
COMPOSE_AGENT_MODEL=deepseek-chat \
  pnpm --filter @tanstack/compose-agent-openai test:lib
```
