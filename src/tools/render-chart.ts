/**
 * Tool: renderChart
 *
 * Visualize a successful runSql result without accepting model-authored data.
 * The model selects a result id and two columns; this tool resolves the rows
 * from the request-local registry and constructs the chart spec server-side.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { QueryResultStore } from './query-result-store';

export const CHART_TYPES = ['bar', 'line', 'pie'] as const;
export const MAX_CHART_ROWS = 100;

function chartError(code: string, error: string) {
  return { success: false as const, code, error };
}

function toChartLabel(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }
  return String(value);
}

function toChartNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
      ? value
      : null;
  }

  if (typeof value === 'bigint') {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    return null;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER
    ? parsed
    : null;
}

export function makeRenderChart(resultStore: QueryResultStore) {
  return tool({
    description:
      'Render a chart from one successful runSql result. Pass the exact resultId ' +
      'returned by runSql and select its label/value columns. Chart values are ' +
      'resolved server-side from the SQL result; do not copy rows into this call. ' +
      'Use bar for category comparisons, line for time trends, and pie for composition.',

    parameters: z.object({
      resultId: z
        .string()
        .describe('The exact resultId returned by the runSql result to visualize.'),
      chartType: z
        .enum(CHART_TYPES)
        .describe('bar | line | pie — pick the one that best fits the data.'),
      title: z.string().describe("Chart title, in the user's language."),
      labelColumn: z
        .string()
        .describe('Exact result column to use for category or x-axis labels.'),
      valueColumn: z
        .string()
        .describe('Exact numeric result column to use for chart values.'),
      xAxis: z.string().describe('Display label for the category or x axis.'),
      yAxis: z.string().describe('Display label for the numeric value axis.'),
    }),

    execute: async (args) => {
      const source = resultStore.get(args.resultId);
      if (!source) {
        return chartError(
          'UNKNOWN_RESULT',
          'The requested SQL result is unavailable in this request. Run the query again, then use its returned resultId.',
        );
      }

      if (source.truncated || source.rowCount > MAX_CHART_ROWS) {
        return chartError(
          'RESULT_TOO_LARGE',
          `Charts require a complete result of at most ${MAX_CHART_ROWS} rows. Run an aggregated query first.`,
        );
      }

      if (source.rows.length === 0) {
        return chartError('EMPTY_RESULT', 'The selected SQL result has no rows to chart.');
      }

      if (!source.columns.includes(args.labelColumn)) {
        return chartError(
          'UNKNOWN_LABEL_COLUMN',
          `Column "${args.labelColumn}" is not present in result ${args.resultId}. Available columns: ${source.columns.join(', ')}.`,
        );
      }

      if (!source.columns.includes(args.valueColumn)) {
        return chartError(
          'UNKNOWN_VALUE_COLUMN',
          `Column "${args.valueColumn}" is not present in result ${args.resultId}. Available columns: ${source.columns.join(', ')}.`,
        );
      }

      const data: { label: string; value: number }[] = [];
      for (const [index, row] of source.rows.entries()) {
        const value = toChartNumber(row[args.valueColumn]);
        if (value === null) {
          return chartError(
            'NON_NUMERIC_VALUE',
            `Row ${index + 1} column "${args.valueColumn}" is not a finite chart-safe number. Filter or cast it in runSql, then chart the new result.`,
          );
        }
        data.push({
          label: toChartLabel(row[args.labelColumn]),
          value,
        });
      }

      return {
        success: true as const,
        sourceResultId: source.resultId,
        sourceRowCount: source.rowCount,
        labelColumn: args.labelColumn,
        valueColumn: args.valueColumn,
        chartSpec: {
          chartType: args.chartType,
          title: args.title,
          xAxis: args.xAxis,
          yAxis: args.yAxis,
          data,
        },
      };
    },
  });
}
