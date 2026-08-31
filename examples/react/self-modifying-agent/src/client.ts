import { createClient } from '@tanstack/compose'
import {
  agentStubs,
  composerPlugin,
  loopPlugin,
  modelsPlugin,
  promptPlugin,
  scriptedModelPlugin,
  sessionPlugin,
  toolsPlugin,
} from '@tanstack/compose-agent'
import { openaiModelPlugin } from '@tanstack/compose-agent-openai'
import { slotsPlugin } from '@tanstack/react-compose'
import { actionLogPlugin } from './plugins/action-log'
import { inputBoxPlugin } from './plugins/input-box'
import { messageListPlugin } from './plugins/message-list'
import { modelPickerPlugin } from './plugins/model-picker'
import { pageFramePlugin } from './plugins/page-frame'
import { pluginPanelPlugin } from './plugins/plugin-panel'
import { stopButtonPlugin } from './plugins/stop-button'
import { uiToolCallsPlugin } from './plugins/ui-tool-calls'
import type { Client, PluginEntry } from '@tanstack/compose'
import type { ScriptedResponse } from '@tanstack/compose-agent'

/**
 * A canned conversation, so the app runs with no key and no network. Responses
 * are consumed one per **request**, so a **turn** with a tool call uses two.
 */
export const cannedConversation: Array<ScriptedResponse> = [
  {
    chunks: [
      'Hello. ',
      'Every element on this page is a plugin — ',
      'the panel on the right is the list I am made of.',
    ],
  },
  {
    chunks: ['Let me read my own plugin list.'],
    toolCalls: [{ name: 'list_plugins', args: {} }],
  },
  {
    chunks: [
      'Those are my entries. ',
      'Disable "stop-button" in the panel and watch the button beside Send go.',
    ],
  },
  {
    chunks: ['Putting the stop button back.'],
    toolCalls: [{ name: 'add_plugin', args: { name: 'stop-button' } }],
  },
  { chunks: ['It is back beside Send, and nothing else re-rendered.'] },
  {
    chunks: ['I have reached the end of my canned conversation. '],
  },
  {
    chunks: [
      'Set VITE_OPENAI_API_KEY and reload to talk to a real model instead.',
    ],
  },
]

/** What {@link createAppClient} lets a caller — a test, mostly — decide. */
export interface AppClientOptions {
  /** The scripted conversation. Defaults to {@link cannedConversation}. */
  script?: Array<ScriptedResponse>
  /** A **model provider** entry to use instead of the scripted one. */
  model?: PluginEntry
}

/** The model entry the environment asks for: a real endpoint, or the script. */
function modelEntry(script: Array<ScriptedResponse>): PluginEntry {
  const env = import.meta.env
  if (env.VITE_OPENAI_API_KEY || env.VITE_OPENAI_BASE_URL) {
    return {
      id: 'model',
      plugin: openaiModelPlugin,
      options: {
        model: env.VITE_OPENAI_MODEL ?? 'gpt-4o-mini',
        baseUrl: env.VITE_OPENAI_BASE_URL,
        apiKey: env.VITE_OPENAI_API_KEY,
      },
    }
  }
  return { id: 'model', plugin: scriptedModelPlugin, options: { script } }
}

/**
 * The whole application: one **client** and a **plugin list**. Six entries are
 * the agent, one is the composer, and the rest are the page. Nothing here
 * renders anything — `main.tsx` provides this client and renders the root
 * **slot**, and what appears is whatever the enabled plugins filled.
 */
export function createAppClient(options: AppClientOptions = {}): Client {
  const script = options.script ?? cannedConversation

  return createClient({
    plugins: [
      // The agent: six entries, exactly as `@tanstack/compose-agent` assembles
      // them outside a browser.
      { id: 'session', plugin: sessionPlugin },
      { id: 'tools', plugin: toolsPlugin },
      {
        id: 'prompt',
        plugin: promptPlugin,
        options: {
          sections: [
            {
              name: 'role',
              text: 'You are the agent this page is made of. Every element on the page is a plugin in your own plugin list, and you may edit that list with the tools you have.',
            },
          ],
        },
      },
      { id: 'models', plugin: modelsPlugin },
      options.model ?? modelEntry(script),
      { id: 'loop', plugin: loopPlugin },

      // Self-modification: a small **plugin catalog**, so the agent can put back
      // anything a person removes from the page.
      {
        id: 'composer',
        plugin: composerPlugin,
        options: {
          catalog: {
            'stop-button': stopButtonPlugin,
            'model-picker': modelPickerPlugin,
          },
          protected: [
            'session',
            'tools',
            'prompt',
            'models',
            'model',
            'loop',
            'slots',
            'ui-tools',
          ],
          stubs: agentStubs,
        },
      },

      // The **shell**: the slot registry, the one path a person's edit takes to
      // the agent's tools, and the page itself.
      { id: 'slots', plugin: slotsPlugin },
      { id: 'ui-tools', plugin: uiToolCallsPlugin },
      { id: 'page-frame', plugin: pageFramePlugin },
      { id: 'message-list', plugin: messageListPlugin },
      { id: 'input-box', plugin: inputBoxPlugin },
      { id: 'stop-button', plugin: stopButtonPlugin },
      { id: 'plugin-panel', plugin: pluginPanelPlugin },
      { id: 'model-picker', plugin: modelPickerPlugin },
      { id: 'action-log', plugin: actionLogPlugin },

      // Slice 5a part 2 lands here: `typescriptCheckerPlugin` from
      // `@tanstack/compose-typescript` provides `sourceCheckerKey`, and the view
      // stubs go into the composer's `stubs` above, so a plugin the agent writes
      // is type-checked and can fill these slots itself.
    ],
  })
}
