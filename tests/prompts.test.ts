import { describe, expect, it } from 'vitest';
import { getSystemPrompt } from '../src/lib/prompts';

describe('system prompt recovery rules', () => {
  it('requires immediate retries and warns about reserved SQL aliases', () => {
    const prompt = getSystemPrompt('v2', 'example schema');

    expect(prompt).toContain('reserved aliases');
    expect(prompt).toContain('null_count');
    expect(prompt).toContain('make the corrected tool call in your next step');
    expect(prompt).toContain('Never end with prose');
    expect(prompt).toContain('COUNT(DISTINCT (col1, col2))');
    expect(prompt).toContain('Use SIMILAR TO');
  });

  it('defines a defensible response shape for vague dirty-data questions', () => {
    const prompt = getSystemPrompt('v2', 'example schema');

    expect(prompt).toContain('define the criteria');
    expect(prompt).toContain('per-issue counts');
    expect(prompt).toContain('deduplicated count of affected rows');
    expect(prompt).toContain('must not be added together');
    expect(prompt).toContain('duplicateRowCount as excess copies');
    expect(prompt).toContain('prefer one aggregate query');
    expect(prompt).toContain('use at most one');
    expect(prompt).toContain('follow-up detail query');
    expect(prompt).toContain('Do not run optional value');
    expect(prompt).toContain('dirty rows');
    expect(prompt).toContain('plus clean rows equals total rows');
  });

  it('keeps the current table total separate from filtered quality subsets', () => {
    const prompt = getSystemPrompt('v2', 'example schema');

    expect(prompt).toContain('COUNT(*) without a filter');
    expect(prompt).toContain('filtered count');
    expect(prompt).toContain('never');
    expect(prompt).toContain('relabel it as the table row count');
    expect(prompt).toContain('answer with the current');
    expect(prompt).toContain('Report valid/invalid/affected subsets separately');
  });

  it('does not infer cleaning mutations from read-only query results', () => {
    const prompt = getSystemPrompt('v2', 'example schema');

    expect(prompt).toContain('Read-only SELECT results describe the current data');
    expect(prompt).toContain('not its mutation history');
    expect(prompt).toContain('Never claim');
    expect(prompt).toContain('rows were removed, repaired, or changed');
    expect(prompt).toContain('Unresolved or invalid values may remain');
  });

  it('offers an eval variant that matches the requested result granularity', () => {
    const prompt = getSystemPrompt('v4', 'example schema');

    expect(prompt).toContain('Match the requested granularity exactly');
    expect(prompt).toContain('LIMIT 1');
    expect(prompt).toContain('Do not add a GROUP BY');
    expect(prompt).toContain('Do not add filters');
    expect(prompt).toContain('smallest result set');
  });

  it('uses the eval-improved result-shape rules by default', () => {
    expect(getSystemPrompt(undefined, 'example schema')).toContain(
      'Match the requested granularity exactly',
    );
  });
});
