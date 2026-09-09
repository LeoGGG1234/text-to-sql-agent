import { z } from 'zod';

const columns = z.array(z.string().min(1)).min(1);

export const cleaningStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('trim_whitespace'), columns }),
  z.object({ type: z.literal('normalize_whitespace'), columns }),
  z.object({ type: z.literal('fullwidth_to_halfwidth'), columns }),
  z.object({
    type: z.literal('normalize_null'),
    columns,
    markers: z.array(z.string()).min(1).max(50),
  }),
  z.object({
    type: z.literal('normalize_numeric'),
    columns,
    percentageMode: z.enum(['keep_number', 'decimal']).default('keep_number'),
    onError: z.enum(['keep_original', 'set_null']).default('keep_original'),
  }),
  z.object({
    type: z.literal('normalize_boolean'),
    columns,
    trueValues: z.array(z.string().min(1)).min(1).max(20),
    falseValues: z.array(z.string().min(1)).min(1).max(20),
    onError: z.enum(['keep_original', 'set_null']).default('keep_original'),
  }),
  z.object({
    type: z.literal('normalize_date'),
    columns,
    onAmbiguous: z.literal('keep_original').default('keep_original'),
  }),
  z.object({
    type: z.literal('fill_missing'),
    column: z.string().min(1),
    strategy: z.enum(['fixed', 'mean', 'median']),
    value: z.string().optional(),
  }),
  z.object({ type: z.literal('remove_missing_rows'), columns }),
  z.object({ type: z.literal('drop_duplicates'), keys: z.array(z.string().min(1)).optional() }),
]);

export const cleaningRecipeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  steps: z.array(cleaningStepSchema).min(1).max(30),
});

export type CleaningStep = z.infer<typeof cleaningStepSchema>;
export type CleaningRecipe = z.infer<typeof cleaningRecipeSchema>;

export interface CleaningRow {
  _row_id: number;
  [column: string]: string | number | null;
}

export interface CleaningDiffSample {
  rowId: number;
  column: string;
  before: string | null;
  after: string | null;
}

export interface CleaningParseFailureSample {
  rowId: number;
  column: string;
  value: string;
  reason: 'invalid_numeric' | 'invalid_or_ambiguous_date' | 'invalid_boolean';
}

export type CleaningRemovedRowSample =
  | {
      rowId: number;
      reason: 'duplicate';
      keptRowId: number;
      columns: string[];
      match: 'all_columns' | 'selected_columns';
    }
  | {
      rowId: number;
      reason: 'missing_value';
      columns: string[];
    };

export interface CleaningSummary {
  inputRows: number;
  outputRows: number;
  affectedRows: number;
  affectedCells: number;
  removedRows: number;
  generatedNulls: number;
  parseFailures: number;
  parseFailureSamples: CleaningParseFailureSample[];
  samples: CleaningDiffSample[];
  /** Optional because cleaning runs created before this field remain readable. */
  removedRowSamples?: CleaningRemovedRowSample[];
}
