export type JsonSchema = Record<string, unknown>;

export const keywords = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'enum',
  'const',
  'anyOf',
  'oneOf',
  'allOf',
  'description',
  'title',
  'default',
  '$schema',
]);

export const types = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
