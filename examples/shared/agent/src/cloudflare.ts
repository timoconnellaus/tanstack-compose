import { createPlugin } from '@tanstack/compose'
import { createWorkersAiModel } from '@tanstack/compose-cloudflare'
import { modelKey } from './keys'
import type { WorkersAiOptions } from '@tanstack/compose-cloudflare'

/** Register a Workers AI provider in the example-local model registry. */
export const createWorkersAiModelPlugin = (options: WorkersAiOptions) =>
  createPlugin({
    name: 'workers-ai-model',
    deps: [modelKey],
    setup(instance) {
      const provider = createWorkersAiModel(options)
      instance.cleanup(
        instance.context.get(modelKey).register(provider),
        `provider(${provider.name})`,
      )
    },
  })
