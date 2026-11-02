import { canonical } from '@praxis/config';
import { assert } from '@praxis/contracts';
import type { JsonSchema } from './schema-keywords.ts';
import { keywords, types } from './schema-keywords.ts';

/** Conservative supported subset: unsupported constraints are rejected, never silently removed. */
export function compileSchema(raw: unknown): {
  schema: JsonSchema;
  validate(value: unknown): void;
} {
  assert(
    Buffer.byteLength(JSON.stringify(raw) ?? '') <= 65536,
    'SCHEMA_UNSUPPORTED',
    'Schema 超过 64 KiB。',
  );
  let nodes = 0;
  const check = (value: unknown, depth: number): JsonSchema => {
    assert(
      depth <= 12 && ++nodes <= 1000 && value && typeof value === 'object' && !Array.isArray(value),
      'SCHEMA_UNSUPPORTED',
      'Schema 深度或结构不支持。',
    );
    const schema = value as JsonSchema;
    assert(
      Object.keys(schema).every((key) => keywords.has(key)),
      'SCHEMA_UNSUPPORTED',
      'Schema 含尚不支持的约束；不会删除约束后执行。',
    );
    if (schema.type !== undefined)
      assert(
        typeof schema.type === 'string' && types.includes(schema.type),
        'SCHEMA_UNSUPPORTED',
        '类型约束不支持。',
      );
    for (const key of ['minItems', 'maxItems', 'minLength', 'maxLength'])
      if (schema[key] !== undefined)
        assert(
          Number.isSafeInteger(schema[key]) && Number(schema[key]) >= 0,
          'SCHEMA_UNSUPPORTED',
          '长度约束无效。',
        );
    for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'])
      if (schema[key] !== undefined)
        assert(
          typeof schema[key] === 'number' && Number.isFinite(schema[key]),
          'SCHEMA_UNSUPPORTED',
          '数字约束无效。',
        );
    if (schema.properties !== undefined) {
      assert(
        schema.properties &&
          typeof schema.properties === 'object' &&
          !Array.isArray(schema.properties),
        'SCHEMA_UNSUPPORTED',
        '属性定义无效。',
      );
      for (const child of Object.values(schema.properties)) check(child, depth + 1);
    }
    if (schema.required !== undefined)
      assert(
        Array.isArray(schema.required) && schema.required.every((v) => typeof v === 'string'),
        'SCHEMA_UNSUPPORTED',
        'required 无效。',
      );
    if (
      schema.additionalProperties !== undefined &&
      typeof schema.additionalProperties !== 'boolean'
    )
      check(schema.additionalProperties, depth + 1);
    if (schema.items !== undefined) check(schema.items, depth + 1);
    if (schema.enum !== undefined)
      assert(
        Array.isArray(schema.enum) && schema.enum.length > 0,
        'SCHEMA_UNSUPPORTED',
        'enum 无效。',
      );
    for (const key of ['anyOf', 'oneOf', 'allOf'])
      if (schema[key] !== undefined) {
        assert(
          Array.isArray(schema[key]) && schema[key].length > 0 && schema[key].length <= 32,
          'SCHEMA_UNSUPPORTED',
          '组合约束无效。',
        );
        for (const child of schema[key]) check(child, depth + 1);
      }
    return schema;
  };
  const schema = structuredClone(check(raw, 0));
  let remaining = 0;
  const matches = (s: JsonSchema, value: unknown, depth: number): boolean => {
    if (depth > 16 || --remaining < 0) return false;
    const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (
      s.type &&
      s.type !== type &&
      !(s.type === 'integer' && type === 'number' && Number.isSafeInteger(value))
    )
      return false;
    if ('const' in s && canonical(value) !== canonical(s.const)) return false;
    if (s.enum && !(s.enum as unknown[]).some((entry) => canonical(entry) === canonical(value)))
      return false;
    for (const [key, mode] of [
      ['anyOf', 'any'],
      ['oneOf', 'one'],
      ['allOf', 'all'],
    ] as const) {
      if (!s[key]) continue;
      const items = s[key] as JsonSchema[];
      const count = items.filter((entry) => matches(entry, value, depth + 1)).length;
      if (
        (mode === 'any' && count === 0) ||
        (mode === 'one' && count !== 1) ||
        (mode === 'all' && count !== items.length)
      )
        return false;
    }
    if (typeof value === 'string') {
      const length = [...value].length;
      if (length < Number(s.minLength ?? 0) || length > Number(s.maxLength ?? Infinity))
        return false;
    }
    if (typeof value === 'number') {
      if (
        !Number.isFinite(value) ||
        value < Number(s.minimum ?? -Infinity) ||
        value > Number(s.maximum ?? Infinity) ||
        value <= Number(s.exclusiveMinimum ?? -Infinity) ||
        value >= Number(s.exclusiveMaximum ?? Infinity)
      )
        return false;
    }
    if (Array.isArray(value)) {
      if (value.length < Number(s.minItems ?? 0) || value.length > Number(s.maxItems ?? Infinity))
        return false;
      if (s.items && !value.every((item) => matches(s.items as JsonSchema, item, depth + 1)))
        return false;
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>,
        properties = (s.properties ?? {}) as Record<string, JsonSchema>;
      if ((s.required as string[] | undefined)?.some((key) => !Object.hasOwn(record, key)))
        return false;
      for (const [key, item] of Object.entries(record)) {
        if (Object.hasOwn(properties, key)) {
          if (!matches(properties[key]!, item, depth + 1)) return false;
        } else if (
          s.additionalProperties === false ||
          (typeof s.additionalProperties === 'object' &&
            !matches(s.additionalProperties as JsonSchema, item, depth + 1))
        )
          return false;
      }
    }
    return true;
  };
  return {
    schema,
    validate(value) {
      remaining = 50000;
      assert(
        Buffer.byteLength(JSON.stringify(value) ?? '') <= 2 * 1024 * 1024 &&
          matches(schema, value, 0),
        'INVALID_ARGUMENT',
        '参数不符合已固定的工具 Schema。',
      );
    },
  };
}
