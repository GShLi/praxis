import type { jsonSchemaValidator } from '@modelcontextprotocol/client';
import { compileSchema } from '@praxis/schema';

export const validator: jsonSchemaValidator = {
  getValidator<T>(schema: Record<string, unknown>) {
    const compiled = compileSchema(schema);
    return (input: unknown) => {
      try {
        compiled.validate(input);
        return { valid: true as const, data: input as T, errorMessage: undefined };
      } catch {
        return {
          valid: false as const,
          data: undefined,
          errorMessage: 'MCP output schema validation failed',
        };
      }
    };
  },
};
