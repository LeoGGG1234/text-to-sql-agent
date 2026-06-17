/**
 * Tests for the provider router's input validation.
 *
 * These guard the boundary where untrusted input (request bodies, persisted
 * client state) selects a model — an unknown id must fail loudly and early,
 * not crash deep inside getModel().
 */

import { describe, it, expect } from 'vitest';
import { isValidProvider, getModel } from '../src/lib/providers';

describe('isValidProvider', () => {
  it('accepts every known provider id', () => {
    for (const id of ['openai', 'anthropic', 'deepseek', 'gemini', 'openrouter']) {
      expect(isValidProvider(id)).toBe(true);
    }
  });

  it('rejects unknown ids and non-strings', () => {
    expect(isValidProvider('mistral')).toBe(false);
    expect(isValidProvider('')).toBe(false);
    expect(isValidProvider(undefined)).toBe(false);
    expect(isValidProvider(null)).toBe(false);
    expect(isValidProvider(42)).toBe(false);
    expect(isValidProvider({})).toBe(false);
  });
});

describe('getModel — unknown provider', () => {
  it('throws a clear error instead of a TypeError', () => {
    // Regression: PROVIDERS[unknown] is undefined, so reading .defaultModel
    // threw an opaque "Cannot read properties of undefined". Now it throws a
    // named error the caller can handle.
    // @ts-expect-error — deliberately passing an invalid id.
    expect(() => getModel('does-not-exist')).toThrow(/Unknown provider/);
  });
});
