import type { StandardSchemaV1 } from '@tanstack/compose'
import type { JsonSchema } from './json-schema'

/**
 * A minimal Standard Schema for a plugin's options: the input type is already
 * checked by TypeScript at the call site, so all the runtime schema has to do is
 * apply defaults. Keeping it here means the package takes no validator
 * dependency, and tools keep using whichever Standard Schema their author likes.
 *
 * Pass a {@link JsonSchema} as well and the validator carries it, so the
 * composer can show the model what the options are.
 */
export const optionsSchema = <TInput, TOutput>(
  parse: (value: TInput) => TOutput,
  schema?: JsonSchema,
): StandardSchemaV1<TInput, TOutput> & { schema?: JsonSchema } => ({
  ...(schema === undefined ? {} : { schema }),
  '~standard': {
    version: 1,
    vendor: 'compose-agent',
    validate: (value: unknown) => ({ value: parse(value as TInput) }),
  },
})
