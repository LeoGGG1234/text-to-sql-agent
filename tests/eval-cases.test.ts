import { describe, expect, it } from 'vitest';
import testCases from '../eval/test-cases.json';
import { parseEvalTestCases } from '../eval/run-eval';

describe('eval case contracts', () => {
  it('parses all 50 cases with exact, order-insensitive defaults', () => {
    const cases = parseEvalTestCases(testCases);
    expect(cases).toHaveLength(50);
    expect(cases.find((testCase) => testCase.id === 'simple_01')?.comparison)
      .toEqual({
        orderMatters: false,
        numericTolerance: 0,
        allowCandidateExtraColumns: false,
        textContainment: false,
      });
  });

  it('excludes unresolved ambiguous metrics from the primary score', () => {
    const cases = parseEvalTestCases(testCases);
    for (const id of ['multi_01', 'multi_03']) {
      const testCase = cases.find((candidate) => candidate.id === id);
      expect(testCase?.scored).toBe(false);
      expect(testCase?.reviewNote).toBeTruthy();
    }
    expect(cases.filter((testCase) => testCase.scored)).toHaveLength(48);
  });

  it('uses explicit calendar and tolerance contracts only where needed', () => {
    const cases = parseEvalTestCases(testCases);
    expect(cases.find((testCase) => testCase.id === 'time_02')?.comparison.period)
      .toEqual({
        columnIndex: 0,
        granularity: 'quarter',
        timeZone: 'Asia/Shanghai',
        year: 2026,
      });
    expect(cases.find((testCase) => testCase.id === 'multi_10')?.comparison.numericTolerance)
      .toBe(0.005);
  });

  it('marks questions with an explicit ordering requirement', () => {
    const cases = parseEvalTestCases(testCases);
    for (const id of ['time_01', 'simple_06', 'edge_03']) {
      expect(cases.find((testCase) => testCase.id === id)?.comparison.orderMatters)
        .toBe(true);
    }
  });
});
