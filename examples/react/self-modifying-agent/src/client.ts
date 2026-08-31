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
  credentialsPlugin,
  staticCredentials,
  viewStubs,
} from '@tanstack/compose-agent'
import { openaiModelPlugin } from '@tanstack/compose-agent-openai'
import { typescriptCheckerPlugin } from '@tanstack/compose-typescript'
import { slotsPlugin } from '@tanstack/react-compose'
import { actionLogPlugin } from './plugins/action-log'
import { inputBoxPlugin } from './plugins/input-box'
import { messageListPlugin } from './plugins/message-list'
import { modelPickerPlugin } from './plugins/model-picker'
import { pageFramePlugin } from './plugins/page-frame'
import { pluginPanelPlugin } from './plugins/plugin-panel'
import { stopButtonPlugin } from './plugins/stop-button'
import { viewsPlugin } from './plugins/views'
import { summariserSource, summariserView } from './written'
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
    chunks: [
      'Now something the page could not do before. ',
      'I will write myself a plugin: a tool that summarises a piece of text, ',
      'and a view that puts a button beside Stop to call it.',
    ],
    toolCalls: [
      {
        name: 'write_plugin',
        args: {
          id: 'summariser',
          source: summariserSource,
          view: summariserView,
        },
      },
    ],
  },
  {
    chunks: [
      'There is a Summarise button beside Stop now. ',
      'Press it: the view reads the end of the session and calls my handler ',
      'through its server stub. Remove "summariser" in the panel and both ',
      'halves go, and the button with them.',
    ],
  },
  {
    chunks: ['I have reached the end of my canned conversation. '],
  },
  {
    chunks: [
      "Set VITE_OPENAI_BASE_URL to the app's /ai route and reload to talk to a real model instead.",
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

/**
 * The model entry the environment asks for: a real endpoint, or the script.
 * The page never holds a credential: a real endpoint is one that needs none
 * from the browser — the app's own `/ai` route, which speaks the
 * OpenAI-compatible protocol over a Worker binding.
 */
function modelEntry(script: Array<ScriptedResponse>): PluginEntry {
  const env = import.meta.env
  if (env.VITE_OPENAI_BASE_URL) {
    return {
      id: 'model',
      plugin: openaiModelPlugin,
      options: {
        model: env.VITE_OPENAI_MODEL ?? 'gpt-4o-mini',
        baseUrl: env.VITE_OPENAI_BASE_URL,
        credential: null,
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
      // The **source checker**: every plugin the agent writes, and every view,
      // is type-checked against the declarations of exactly the stubs its entry
      // was granted, before anything starts.
      { id: 'checker', plugin: typescriptCheckerPlugin },
      // Providers read credentials by name; the page holds none, so the
      // source is empty and a provider that needs one ends in `error`.
      {
        id: 'credentials',
        plugin: credentialsPlugin,
        options: { source: staticCredentials({}) },
      },
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
            'credentials',
            'model',
            'loop',
            'checker',
            'slots',
            'views',
          ],
          stubs: agentStubs,
          // The stubs a written **view** is granted, and the **slots** it may
          // fill. `root` is not among them: the page frame is the operator's,
          // and a view that could replace it could replace the whole page.
          viewStubs,
          viewSlots: ['chat.input.actions', 'chat.side', 'chat.main'],
        },
      },

      // The **shell**: the slot registry, the glue that publishes it and the
      // React renderer to written **views**, and the page itself.
      { id: 'slots', plugin: slotsPlugin },
      { id: 'views', plugin: viewsPlugin },
      { id: 'page-frame', plugin: pageFramePlugin },
      { id: 'message-list', plugin: messageListPlugin },
      { id: 'input-box', plugin: inputBoxPlugin },
      { id: 'stop-button', plugin: stopButtonPlugin },
      { id: 'plugin-panel', plugin: pluginPanelPlugin },
      { id: 'model-picker', plugin: modelPickerPlugin },
      { id: 'action-log', plugin: actionLogPlugin },
    ],
  })
}
