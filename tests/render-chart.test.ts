import { describe, expect, it } from 'vitest';
import { makeRenderChart } from '../src/tools/render-chart';
import { createQueryResultStore } from '../src/tools/query-result-store';

interface ChartInput {
  resultId: string;
  chartType: 'bar' | 'line' | 'pie';
  title: string;
  labelColumn: string;
  valueColumn: string;
  xAxis: string;
  yAxis: string;
}

async function executeChart(
  chart: ReturnType<typeof makeRenderChart>,
  input: ChartInput,
) {
  const execute = chart.execute as (args: ChartInput) => Promise<unknown>;
  return execute(input);
}

function baseInput(overrides: Partial<ChartInput> = {}): ChartInput {
  return {
    resultId: 'query_1',
    chartType: 'bar',
    title: 'Revenue by region',
    labelColumn: 'region',
    valueColumn: 'revenue',
    xAxis: 'Region',
    yAxis: 'Revenue',
    ...overrides,
  };
}

describe('renderChart result provenance', () => {
  it('does not accept model-authored chart points in the tool contract', () => {
    const chart = makeRenderChart(createQueryResultStore());
    const parsed = chart.parameters.safeParse({
      ...baseInput(),
      data: [{ label: 'invented', value: 999 }],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('data');
    }
  });

  it('builds chart data from a registered SQL result', async () => {
    const store = createQueryResultStore();
    store.save({
      rowCount: 2,
      columns: ['region', 'revenue'],
      rows: [
        { region: 'East', revenue: '12.50' },
        { region: 'West', revenue: 9.25 },
      ],
      truncated: false,
    });

    await expect(executeChart(makeRenderChart(store), baseInput())).resolves.toEqual({
      success: true,
      sourceResultId: 'query_1',
      sourceRowCount: 2,
      labelColumn: 'region',
      valueColumn: 'revenue',
      chartSpec: {
        chartType: 'bar',
        title: 'Revenue by region',
        xAxis: 'Region',
        yAxis: 'Revenue',
        data: [
          { label: 'East', value: 12.5 },
          { label: 'West', value: 9.25 },
        ],
      },
    });
  });

  it('rejects an unknown or previous-request result id', async () => {
    const store = createQueryResultStore();

    await expect(executeChart(makeRenderChart(store), baseInput())).resolves.toEqual(
      expect.objectContaining({ success: false, code: 'UNKNOWN_RESULT' }),
    );
  });

  it('rejects missing columns instead of letting the model provide replacements', async () => {
    const store = createQueryResultStore();
    store.save({
      rowCount: 1,
      columns: ['region', 'revenue'],
      rows: [{ region: 'East', revenue: '12.50' }],
      truncated: false,
    });

    await expect(
      executeChart(makeRenderChart(store), baseInput({ valueColumn: 'invented_total' })),
    ).resolves.toEqual(
      expect.objectContaining({ success: false, code: 'UNKNOWN_VALUE_COLUMN' }),
    );
  });

  it('rejects incomplete result sets so a partial chart cannot look complete', async () => {
    const store = createQueryResultStore();
    store.save({
      rowCount: 101,
      columns: ['region', 'revenue'],
      rows: [{ region: 'East', revenue: '12.50' }],
      truncated: false,
    });

    await expect(executeChart(makeRenderChart(store), baseInput())).resolves.toEqual(
      expect.objectContaining({ success: false, code: 'RESULT_TOO_LARGE' }),
    );
  });

  it('rejects non-numeric and unsafe values without silently dropping them', async () => {
    const store = createQueryResultStore();
    store.save({
      rowCount: 2,
      columns: ['region', 'revenue'],
      rows: [
        { region: 'East', revenue: '12.50' },
        { region: 'West', revenue: '9007199254740993' },
      ],
      truncated: false,
    });

    await expect(executeChart(makeRenderChart(store), baseInput())).resolves.toEqual(
      expect.objectContaining({ success: false, code: 'NON_NUMERIC_VALUE' }),
    );
  });
});
