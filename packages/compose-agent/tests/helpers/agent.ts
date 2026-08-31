import { createClient } from '@tanstack/compose'
import {
  agentKey,
  loopPlugin,
  promptPlugin,
  scriptedModelPlugin,
  sessionKey,
  sessionPlugin,
  toolsKey,
  toolsPlugin,
} from '../../src/index'
import type { Client } from '@tanstack/compose'
import type {
  Agent,
  AnyTool,
  PromptSection,
  ScriptedResponse,
  SessionEntry,
  SessionLog,
  ToolRegistry,
} from '../../src/index'

/** A promise a test resolves by hand, to hold a turn open at a known point. */
export const deferred = <TValue = void>() => {
  let resolve!: (value: TValue) => void
  const promise = new Promise<TValue>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/**
 * The whole agent: a session, a tool registry, a prompt registry, a scripted
 * model and the loop — five plugin entries and nothing else (A3).
 */
export const buildAgent = async (setup?: {
  script?: Array<ScriptedResponse>
  tools?: Array<AnyTool>
  sections?: Array<PromptSection>
  entries?: Array<SessionEntry>
  maxSteps?: number
}): Promise<{
  client: Client
  agent: Agent
  session: SessionLog
  tools: ToolRegistry
}> => {
  const client = createClient({
    plugins: [
      {
        id: 'session',
        plugin: sessionPlugin,
        options: { entries: setup?.entries },
      },
      { id: 'tools', plugin: toolsPlugin, options: { tools: setup?.tools } },
      {
        id: 'prompt',
        plugin: promptPlugin,
        options: { sections: setup?.sections },
      },
      {
        id: 'model',
        plugin: scriptedModelPlugin,
        options: { script: setup?.script ?? [] },
      },
      {
        id: 'loop',
        plugin: loopPlugin,
        options: { maxSteps: setup?.maxSteps },
      },
    ],
  })
  await client.settled()
  return {
    client,
    agent: client.getContext(agentKey)!,
    session: client.getContext(sessionKey)!,
    tools: client.getContext(toolsKey)!,
  }
}

/** The kinds of every entry in a log, for asserting the shape of a turn. */
export const kindsOf = (entries: ReadonlyArray<SessionEntry>): Array<string> =>
  entries.map((entry) => entry.kind)
