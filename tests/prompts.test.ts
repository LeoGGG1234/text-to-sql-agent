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
    expect(prompt).toContain('dirty rows');
    expect(prompt).toContain('plus clean rows equals total rows');
  });
});
