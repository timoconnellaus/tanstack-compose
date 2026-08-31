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
  loopPlugin,
  modelsPlugin,
  promptPlugin,
  sessionPlugin,
  toolsPlugin,
} from '@tanstack/compose-agent'
import { openaiModelPlugin } from '@tanstack/compose-agent-openai'

const client = createClient({
  plugins: [
    { id: 'session', plugin: sessionPlugin },
    { id: 'tools', plugin: toolsPlugin, options: { tools: [search] } },
    { id: 'prompt', plugin: promptPlugin },
    { id: 'models', plugin: modelsPlugin },
    {
      id: 'model',
      plugin: openaiModelPlugin,
      options: { model: 'gpt-4o-mini' }, // key read from OPENAI_API_KEY
    },
    { id: 'loop', plugin: loopPlugin },
  ],
})
await client.settled()

const agent = client.getContext(agentKey)!
agent.send('what is on the shelf?')
await agent.idle()
```

## Options

| Option         | Default                     | What it does                                                   |
| -------------- | --------------------------- | -------------------------------------------------------------- |
| `model`        | required                    | The model name the endpoint knows                              |
| `baseUrl`      | `https://api.openai.com/v1` | The API root; a trailing slash is fine                         |
| `apiKey`       | read from the environment   | The key; when there is none, no `authorization` header is sent |
| `apiKeyEnvVar` | `OPENAI_API_KEY`            | Which environment variable holds the key                       |
| `headers`      | `{}`                        | Extra request headers, merged over the ones the provider sets  |
| `name`         | the model name              | The provider's name, as it appears in inspection               |

Anything in the loop's `modelOptions` — `temperature`, `top_p`, and so on — is
merged into the request body, so provider-specific settings need no API here.

### Another endpoint

```ts
{
  id: 'model',
  plugin: openaiModelPlugin,
  options: {
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
  },
}
```

```ts
// A local server, which needs no key at all.
{ id: 'model', plugin: openaiModelPlugin, options: { model: 'llama3', baseUrl: 'http://localhost:11434/v1' } }
```

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
  options: { model: 'llama3', baseUrl: 'http://localhost:11434/v1' },
})

const models = client.getContext(modelKey)!
models.list().map((provider) => provider.name) // ['gpt-4o-mini', 'llama3']
models.select('gpt-4o-mini') // used from the next turn on

// Or drop it again; the `model` key and everything downstream stay put.
await client.removePlugin('local')
```

## Tests

The suite runs with a mocked `fetch` replaying recorded server-sent-event
bodies, so it needs no key and no network. One smoke test talks to a real
endpoint and skips itself unless a key is present:

```sh
OPENAI_API_KEY=sk-… pnpm --filter @tanstack/compose-agent-openai test:lib

# Or point it somewhere else.
COMPOSE_AGENT_MODEL_KEY_VAR=DEEPSEEK_API_KEY \
COMPOSE_AGENT_BASE_URL=https://api.deepseek.com/v1 \
COMPOSE_AGENT_MODEL=deepseek-chat \
  pnpm --filter @tanstack/compose-agent-openai test:lib
```
