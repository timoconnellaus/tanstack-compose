import type { StandardSchemaV1 } from '@tanstack/compose'

/**
 * A minimal Standard Schema for a plugin's options: the input type is already
 * checked by TypeScript at the call site, so all the runtime schema has to do is
 * apply defaults. Keeping it here means the package takes no validator
 * dependency, and tools keep using whichever Standard Schema their author likes.
 */
export const optionsSchema = <TInput, TOutput>(
  parse: (value: TInput) => TOutput,
): StandardSchemaV1<TInput, TOutput> => ({
  '~standard': {
    version: 1,
    vendor: 'compose-agent',
    validate: (value: unknown) => ({ value: parse(value as TInput) }),
  },
})
