import type { StandardSchemaIssue, StandardSchemaV1 } from '@tanstack/compose'

/**
 * The subset of JSON Schema a **tool** declares its arguments with. It is plain
 * data, so it crosses a host boundary unchanged: a written plugin declares its
 * tool's arguments in exactly this shape, and the same object is both what the
 * model is shown and what its arguments are validated against.
 */
export interface JsonSchema {
  type?: JsonSchemaType | ReadonlyArray<JsonSchemaType>
  description?: string
  enum?: ReadonlyArray<unknown>
  properties?: Record<string, JsonSchema>
  required?: ReadonlyArray<string>
  items?: JsonSchema
  /** `false` rejects any property `properties` does not name. */
  additionalProperties?: boolean
}

/** The types {@link JsonSchema} understands. */
export type JsonSchemaType =
  'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'

/** What a value is, in JSON Schema's vocabulary. */
const kindOf = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const isType = (value: unknown, type: JsonSchemaType): boolean => {
  if (type === 'integer') {
    return typeof value === 'number' && Number.isInteger(value)
  }
  if (type === 'number') return typeof value === 'number'
  return kindOf(value) === type
}

interface Problem {
  message: string
  path: Array<string | number>
}

/** Walk one value against one schema, collecting every problem it has. */
function check(
  value: unknown,
  schema: JsonSchema,
  path: Array<string | number>,
  problems: Array<Problem>,
): void {
  const types =
    schema.type === undefined
      ? []
      : Array.isArray(schema.type)
        ? [...schema.type]
        : [schema.type as JsonSchemaType]
  if (types.length > 0 && !types.some((type) => isType(value, type))) {
    problems.push({
      message: `expected ${types.join(' or ')}, got ${kindOf(value)}`,
      path,
    })
    return
  }
  if (schema.enum && !schema.enum.some((one) => Object.is(one, value))) {
    problems.push({
      message: `expected one of ${schema.enum
        .map((one) => JSON.stringify(one))
        .join(', ')}`,
      path,
    })
    return
  }
  if (kindOf(value) === 'object') {
    const object = value as Record<string, unknown>
    for (const name of schema.required ?? []) {
      if (!(name in object)) {
        problems.push({ message: 'is required', path: [...path, name] })
      }
    }
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      if (name in object) {
        check(object[name], property, [...path, name], problems)
      }
    }
    if (schema.additionalProperties === false) {
      const known = schema.properties ?? {}
      for (const name of Object.keys(object)) {
        if (!(name in known)) {
          problems.push({
            message: 'is not a known argument',
            path: [...path, name],
          })
        }
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) =>
      check(item, schema.items!, [...path, index], problems),
    )
  }
}

/**
 * A Standard Schema that validates against a {@link JsonSchema}, so one piece of
 * plain data is both the `parameters` the model is shown and the `validator` a
 * tool's arguments are checked with. This is how a **written plugin** declares
 * its tool's arguments: it cannot ship a validator across a host boundary, but
 * it can ship a schema.
 *
 * `TArgs` states what the schema means; the runtime check is the schema itself.
 *
 * @example
 * ```ts
 * const validator = jsonSchemaValidator<{ query: string }>({
 *   type: 'object',
 *   properties: { query: { type: 'string' } },
 *   required: ['query'],
 * })
 * ```
 */
export function jsonSchemaValidator<TArgs>(
  schema: JsonSchema,
): StandardSchemaV1<unknown, TArgs> {
  return {
    '~standard': {
      version: 1,
      vendor: 'compose-agent',
      validate: (value: unknown) => {
        const subject = value ?? {}
        const problems: Array<Problem> = []
        check(subject, schema, [], problems)
        if (problems.length === 0) return { value: subject as TArgs }
        const issues: Array<StandardSchemaIssue> = problems.map((problem) => ({
          message:
            problem.path.length === 0
              ? problem.message
              : `${problem.path.join('.')} ${problem.message}`,
          path: problem.path,
        }))
        return { issues }
      },
    },
  }
}
