import { describe, expect, it } from 'vitest';
import { getUploadLimits } from '../src/lib/data-sources/upload-limits';

describe('upload limits', () => {
  it('uses one parsed configuration for server validation and UI disclosure', () => {
    expect(getUploadLimits({
      UPLOAD_MAX_FILE_MB: '12', UPLOAD_MAX_ROWS: '345', UPLOAD_BATCH_SIZE: '67',
    } as NodeJS.ProcessEnv)).toEqual({
      maxFileMb: 12, maxFileBytes: 12 * 1024 * 1024, maxRows: 345, batchSize: 67,
    });
  });

  it('falls back safely for invalid non-positive values', () => {
    expect(getUploadLimits({ UPLOAD_MAX_FILE_MB: '0', UPLOAD_MAX_ROWS: 'oops' } as NodeJS.ProcessEnv)).toMatchObject({
      maxFileMb: 80, maxRows: 50_000,
    });
  });

  it('does not advertise uploads larger than cleaning and export can process', () => {
    expect(getUploadLimits({ UPLOAD_MAX_ROWS: '200000' } as NodeJS.ProcessEnv).maxRows).toBe(50_000);
  });
});
