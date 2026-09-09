export const DEFAULT_UPLOAD_MAX_FILE_MB = 80;
export const MAX_INTERACTIVE_DATA_ROWS = 50_000;
export const DEFAULT_UPLOAD_MAX_ROWS = MAX_INTERACTIVE_DATA_ROWS;
export const DEFAULT_UPLOAD_BATCH_SIZE = 2_000;

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getUploadLimits(env: NodeJS.ProcessEnv = process.env) {
  const maxFileMb = positiveInteger(env.UPLOAD_MAX_FILE_MB, DEFAULT_UPLOAD_MAX_FILE_MB);
  return {
    maxFileMb,
    maxFileBytes: maxFileMb * 1024 * 1024,
    maxRows: Math.min(
      positiveInteger(env.UPLOAD_MAX_ROWS, DEFAULT_UPLOAD_MAX_ROWS),
      MAX_INTERACTIVE_DATA_ROWS,
    ),
    batchSize: positiveInteger(env.UPLOAD_BATCH_SIZE, DEFAULT_UPLOAD_BATCH_SIZE),
  };
}
