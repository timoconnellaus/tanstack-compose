import { createAction, createPlugin } from '@tanstack/compose'
import { defineBase, defineGrant } from '@tanstack/compose/base'
import { scheduleStub, storageStub } from '@tanstack/compose/grants'
import { optionsSchema } from '@tanstack/compose-tools'
import { agentKey, sessionKey } from '@tanstack/compose-example-agent-runtime'
import {
  createSlot,
  slotRegistryKey,
  viewRendererKey,
} from '@tanstack/react-compose'
import type { ActionDefinition } from '@tanstack/compose'
import type { GrantContext } from '@tanstack/compose/base'
import type {
  AgentStatus,
  SessionEntry,
} from '@tanstack/compose-example-agent-runtime'
import type { ViewCallback, ViewNode } from '@tanstack/react-compose'

/** Slots deliberately exposed by the deployed chat base. */
export const chatMainSlot = createSlot('chat.main')
export const chatSideSlot = createSlot('chat.side')
export const chatInputActionsSlot = createSlot<{ draft: string }>(
  'chat.input.actions',
)

/** Queue a user message and resolve after its turn closes. */
export const sendAction: ActionDefinition<{ text: string }, void> =
  createAction<{ text: string }, void>('send')

/** Cancel the tenant's open turn. */
export const cancelAction: ActionDefinition<void, void> = createAction<
  void,
  void
>('cancel')

/** Plain view data accepted from an isolated facet. */
export type AgentViewNode =
  | {
      type: 'text' | 'pre'
      text: string
      tone?: 'default' | 'muted' | 'success' | 'danger'
      testId?: string
    }
  | {
      type: 'button'
      label: string
      onPress?: string
      disabled?: boolean
      testId?: string
    }
  | {
      type: 'input'
      value?: string
      placeholder?: string
      onChange?: string
      onSubmit?: string
      testId?: string
    }
  | { type: 'row' | 'stack'; children: Array<AgentViewNode>; testId?: string }

/** What a facet supplies to `slots.fill`. */
export interface AgentFill {
  slot: 'chat.main' | 'chat.side' | 'chat.input.actions'
  order?: number
  view: AgentViewNode
}

const slotByName = {
  'chat.main': chatMainSlot,
  'chat.side': chatSideSlot,
  'chat.input.actions': chatInputActionsSlot,
}

const handlersOf = (node: AgentViewNode): Array<string> => {
  if (node.type === 'row' || node.type === 'stack') {
    return [...new Set(node.children.flatMap(handlersOf))]
  }
  if (node.type === 'button') return node.onPress ? [node.onPress] : []
  if (node.type === 'input') {
    return [node.onChange, node.onSubmit].filter(
      (name): name is string => name !== undefined,
    )
  }
  return []
}

/** Fill one of the base's three slots with serializable view data. */
export const slotsGrant = defineGrant({
  name: 'slots',
  deps: [slotRegistryKey, viewRendererKey],
  methods: {
    fill(fill: AgentFill, { instance, instanceId, call }: GrantContext): void {
      const slot = (
        slotByName as Partial<
          Record<string, (typeof slotByName)[keyof typeof slotByName]>
        >
      )[fill.slot]
      if (!slot)
        throw new Error(`agent example: slot "${fill.slot}" is not granted`)
      const callbacks: Record<string, ViewCallback> = {}
      for (const handler of handlersOf(fill.view)) {
        callbacks[handler] = (input) => call(handler, input)
      }
      const view = fill.view as ViewNode
      const render = instance.context.get(viewRendererKey)(view, callbacks)
      instance.cleanup(
        instance.context.get(slotRegistryKey).fill(slot, {
          order: fill.order ?? 0,
          render,
          serialized: { instanceId, view },
        }),
        `fill(${fill.slot})`,
      )
    },
  },
})

/** Call another export of the same written facet. */
export const serverGrant = defineGrant({
  name: 'server',
  methods: {
    call(
      handler: string,
      input: unknown,
      { call }: GrantContext,
    ): Promise<unknown> {
      return call(handler, input)
    },
  },
})

/** The flattened session shape a written facet may read. */
export interface SessionReadEntry {
  id: string
  kind: string
  text?: string
}

/** Read the end of the tenant session without granting mutation. */
export const sessionGrant = defineGrant({
  name: 'session',
  deps: [sessionKey],
  methods: {
    read(
      last: number | undefined,
      { instance }: GrantContext,
    ): Array<SessionReadEntry> {
      const entries = instance.context.get(sessionKey).snapshot()
      return entries
        .slice(Math.max(0, entries.length - (last ?? 20)))
        .map((entry: SessionEntry) => {
          const text = 'text' in entry ? entry.text : undefined
          return {
            id: entry.id,
            kind: entry.kind,
            ...(typeof text === 'string' ? { text } : {}),
          }
        })
    },
  },
})

/** Read only whether the tenant loop is running. */
export const agentGrant = defineGrant({
  name: 'agent',
  deps: [agentKey],
  methods: {
    status({ instance }: GrantContext): AgentStatus {
      return instance.context.get(agentKey).status.state
    },
  },
})

/** Trusted action handlers connecting the base to the example-local loop. */
export const controllerPlugin = createPlugin({
  name: 'controller',
  deps: [agentKey],
  provides: [sendAction, cancelAction],
  setup(instance) {
    const agent = instance.context.get(agentKey)
    instance.defineAction(sendAction, async ({ text }) => {
      agent.send(text)
      await agent.idle()
    })
    instance.defineAction(cancelAction, () => agent.cancel())
  },
})

const marker = (name: string) => createPlugin({ name, setup() {} })

/** Browser-rendered chat entries represented in the authoritative list. */
export const pageTitlePlugin = marker('page-title')
export const markdownPlugin = marker('markdown')
export const sendOnEnterPlugin = marker('send-on-enter')
export const sendOnCtrlEnterPlugin = marker('send-on-ctrl-enter')
export const workingIndicatorPlugin = createPlugin({
  name: 'working-indicator',
  validator: optionsSchema<{ text?: string } | undefined, { text: string }>(
    (value) => ({ text: value?.text ?? 'Agent is working' }),
    {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text shown while the agent is working.',
        },
      },
    },
  ),
  setup() {},
})

/** The five UI plugins offered to the composer by catalog name. */
export const uiCatalog = {
  'page-title': pageTitlePlugin,
  markdown: markdownPlugin,
  'working-indicator': workingIndicatorPlugin,
  'send-on-enter': sendOnEnterPlugin,
  'send-on-ctrl-enter': sendOnCtrlEnterPlugin,
}

/** The extension surface generated once for written plugin checks. */
export const base = defineBase({
  keys: { agent: agentKey, session: sessionKey },
  actions: { send: sendAction, cancel: cancelAction },
  slots: {
    chatMain: chatMainSlot,
    chatSide: chatSideSlot,
    chatInputActions: chatInputActionsSlot,
  },
  grants: {
    slots: slotsGrant,
    server: serverGrant,
    session: sessionGrant,
    agent: agentGrant,
    storage: storageStub,
    schedule: scheduleStub,
  },
  plugins: { controller: controllerPlugin, ...uiCatalog },
})
