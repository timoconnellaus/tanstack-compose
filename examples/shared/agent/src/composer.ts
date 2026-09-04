import { createPlugin } from '@tanstack/compose'
import {
  composerPrompt,
  createComposerTools,
  jsonSchemaValidator,
  optionsSchema,
} from '@tanstack/compose-tools'
import { modelKey, promptKey, toolsKey } from './keys'
import { createTool } from './tools'
import type { AnyPlugin, AnyStubGrant } from '@tanstack/compose'
import type { ModelRegistry } from './types'

/** Policy captured by the example-local adapter around Compose's tool surface. */
export interface ComposerPluginOptions {
  catalog?: Readonly<Record<string, AnyPlugin>>
  protected?: ReadonlyArray<string>
  stubs?: ReadonlyArray<AnyStubGrant>
  host?: string
}

const selectModelTool = (models: ModelRegistry) =>
  createTool({
    name: 'select_model',
    description: 'Select the registered model provider used by the next turn.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
    },
    validator: jsonSchemaValidator<{ name?: string }>({
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    }),
    concurrency: 'exclusive',
    execute: ({ name }) => {
      const providers = models.list().map((provider) => provider.name)
      if (name !== undefined && !providers.includes(name)) {
        return {
          ok: false,
          error: `there is no model provider named "${name}"`,
          providers,
        }
      }
      models.select(name)
      return { ok: true, providers, selected: models.current()?.name }
    },
  })

/**
 * Mount `@tanstack/compose-tools` definitions in this example's tool and prompt
 * registries. The adapter is example code; the definitions remain independent
 * of this loop.
 */
export const createComposerPlugin = (policy: ComposerPluginOptions) =>
  createPlugin({
    name: 'composer',
    deps: [toolsKey, promptKey, modelKey],
    setup(instance) {
      const registry = instance.context.get(toolsKey)
      for (const tool of createComposerTools({
        client: instance.client,
        ...policy,
      })) {
        instance.cleanup(
          registry.register(
            createTool({
              name: tool.name,
              description: tool.description,
              validator: tool.validator,
              parameters: tool.parameters,
              concurrency: tool.concurrency,
              execute: tool.execute,
            }),
          ),
          `tool(${tool.name})`,
        )
      }
      const selection = selectModelTool(instance.context.get(modelKey))
      instance.cleanup(registry.register(selection), `tool(${selection.name})`)
      instance.cleanup(
        instance.context.get(promptKey).register({
          name: 'composer',
          order: 10,
          text: () => composerPrompt(policy),
        }),
        'prompt(composer)',
      )
    },
  })

const policyOptions = optionsSchema<
  ComposerPluginOptions | undefined,
  ComposerPluginOptions
>((value) => ({ ...value }))

/** Browser-demo compatibility wrapper; deployed code uses the factory. */
export const composerPlugin = createPlugin({
  name: 'composer',
  deps: [toolsKey, promptKey, modelKey],
  validator: policyOptions,
  setup(instance, policy) {
    const registry = instance.context.get(toolsKey)
    for (const tool of createComposerTools({
      client: instance.client,
      ...policy,
    })) {
      instance.cleanup(
        registry.register(
          createTool({
            name: tool.name,
            description: tool.description,
            validator: tool.validator,
            parameters: tool.parameters,
            concurrency: tool.concurrency,
            execute: tool.execute,
          }),
        ),
        `tool(${tool.name})`,
      )
    }
    const selection = selectModelTool(instance.context.get(modelKey))
    instance.cleanup(registry.register(selection), `tool(${selection.name})`)
    instance.cleanup(
      instance.context.get(promptKey).register({
        name: 'composer',
        order: 10,
        text: () => composerPrompt(policy),
      }),
      'prompt(composer)',
    )
  },
})
