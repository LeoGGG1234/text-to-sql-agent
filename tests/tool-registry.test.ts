import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateAndExecute: vi.fn(),
}));

vi.mock('@/lib/sql-executor', () => ({
  validateAndExecute: mocks.validateAndExecute,
}));

import { buildTools } from '../src/tools';

interface SqlInput {
  sql: string;
}

interface ChartInput {
  resultId: string;
  chartType: 'bar' | 'line' | 'pie';
  title: string;
  labelColumn: string;
  valueColumn: string;
  xAxis: string;
  yAxis: string;
}

describe('request-local tool result registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateAndExecute.mockResolvedValue({
      success: true,
      rowCount: 2,
      columns: ['region', 'revenue'],
      truncated: false,
      durationMs: 1,
      rows: [
        { region: 'East', revenue: '12.50' },
        { region: 'West', revenue: '9.25' },
      ],
    });
  });

  it('lets renderChart resolve the exact result returned by sibling runSql', async () => {
    const tools = buildTools();
    const runSql = tools.runSql.execute as (input: SqlInput) => Promise<unknown>;
    const renderChart = tools.renderChart.execute as (
      input: ChartInput,
    ) => Promise<unknown>;

    const sqlResult = await runSql({ sql: 'SELECT region, revenue FROM example' });
    expect(sqlResult).toEqual(expect.objectContaining({ resultId: 'query_1' }));

    await expect(
      renderChart({
        resultId: 'query_1',
        chartType: 'bar',
        title: 'Revenue by region',
        labelColumn: 'region',
        valueColumn: 'revenue',
        xAxis: 'Region',
        yAxis: 'Revenue',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        sourceResultId: 'query_1',
        chartSpec: expect.objectContaining({
          data: [
            { label: 'East', value: 12.5 },
            { label: 'West', value: 9.25 },
          ],
        }),
      }),
    );
  });

  it('does not expose one request registry to another request', async () => {
    const firstRequest = buildTools();
    const secondRequest = buildTools();
    const firstRunSql = firstRequest.runSql.execute as (
      input: SqlInput,
    ) => Promise<unknown>;
    const secondRenderChart = secondRequest.renderChart.execute as (
      input: ChartInput,
    ) => Promise<unknown>;

    await firstRunSql({ sql: 'SELECT region, revenue FROM example' });

    await expect(
      secondRenderChart({
        resultId: 'query_1',
        chartType: 'bar',
        title: 'Revenue by region',
        labelColumn: 'region',
        valueColumn: 'revenue',
        xAxis: 'Region',
        yAxis: 'Revenue',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ success: false, code: 'UNKNOWN_RESULT' }),
    );
  });
});
