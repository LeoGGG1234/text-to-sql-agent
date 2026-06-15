/**
 * Tool: renderChart
 *
 * Visualize the result of a runSql query. The model picks the chart type and
 * maps result columns to {label, value} pairs; this tool just validates the
 * shape and passes a chart spec back. The actual chart is drawn on the
 * frontend (src/components/chat/chart-card.tsx) from this spec.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const CHART_TYPES = ['bar', 'line', 'pie'] as const;

export const renderChart = tool({
  description:
    'Render a chart from the rows returned by runSql. Call this after you have ' +
    'data worth visualizing. Choose the chart type that fits: ' +
    'bar = compare values across categories; line = a trend over time; ' +
    'pie = share/composition of a whole. Map each row to a {label, value} pair.',

  parameters: z.object({
    chartType: z
      .enum(CHART_TYPES)
      .describe('bar | line | pie — pick the one that best fits the data.'),
    title: z.string().describe("Chart title, in the user's language."),
    xAxis: z
      .string()
      .describe('Label for the x-axis / category axis (e.g. "Product", "Month").'),
    yAxis: z
      .string()
      .describe('Label for the y-axis / value axis (e.g. "Revenue").'),
    data: z
      .array(
        z.object({
          label: z.string().describe('Category / x value, e.g. a product name or month.'),
          value: z.number().describe('Numeric y value.'),
        }),
      )
      .min(1)
      .describe('The points to plot, already aggregated from the query result.'),
  }),

  execute: async (args) => {
    // Pass-through: the spec is rendered client-side. Returning it as the tool
    // result lets the UI pick it up via the toolName === 'renderChart' branch.
    return {
      chartSpec: {
        chartType: args.chartType,
        title: args.title,
        xAxis: args.xAxis,
        yAxis: args.yAxis,
        data: args.data,
      },
    };
  },
});
