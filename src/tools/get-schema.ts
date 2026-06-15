/**
 * Tool: getSchema
 *
 * Returns the full retail database schema (tables, columns, types,
 * relationships). The schema is also embedded in the system prompt, but this
 * tool lets the model re-check exact names mid-conversation — the main use is
 * self-correction after an UNKNOWN_COLUMN error from runSql.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { SCHEMA_TABLES, RELATIONSHIPS } from '@/lib/schema-description';

export const getSchema = tool({
  description:
    'Return the retail database schema: all tables, their columns and types, ' +
    'and the foreign-key relationships between them. Call this when you are ' +
    'unsure of an exact table or column name, or after a column-not-found error.',

  parameters: z.object({}),

  execute: async () => {
    return {
      tables: SCHEMA_TABLES.map((t) => ({
        name: t.name,
        description: t.description,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
          description: c.description,
        })),
        foreignKeys: t.foreignKeys,
      })),
      relationships: RELATIONSHIPS,
    };
  },
});
