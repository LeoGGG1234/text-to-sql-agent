#!/usr/bin/env npx tsx

import { neon } from '@neondatabase/serverless';
import { checkDeploymentReadiness } from '../src/lib/deployment-readiness';

const databaseUrl = process.env.CHECK_DATABASE_URL;
if (!databaseUrl) {
  console.error(
    'CHECK_DATABASE_URL is required. Pass an explicit staging/deployment target; DATABASE_URL is intentionally ignored.',
  );
  process.exit(1);
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const visited = new Set<object>();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function isTransientNetworkError(error: unknown): boolean {
  const transientCodes = new Set([
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENETUNREACH',
    'ECONNREFUSED',
  ]);
  return errorChain(error).some((entry) => {
    const code = (entry as { code?: unknown }).code;
    const message =
      entry instanceof Error ? entry.message.toLowerCase() : String(entry);
    return (
      (typeof code === 'string' && transientCodes.has(code)) ||
      message.includes('fetch failed') ||
      message.includes('network socket disconnected')
    );
  });
}

function conciseError(error: unknown): string {
  const chain = errorChain(error);
  const deepest = chain.at(-1);
  if (deepest instanceof Error) {
    const code = (deepest as Error & { code?: unknown }).code;
    return `${typeof code === 'string' ? `${code}: ` : ''}${deepest.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function runChecks() {
  const delaysMs = [500, 1_500];
  for (let attempt = 1; ; attempt++) {
    try {
      return await checkDeploymentReadiness(neon(databaseUrl), {
        checkUserdataSecurity: process.env.CHECK_USERDATA_SECURITY !== 'false',
      });
    } catch (error) {
      const delay = delaysMs[attempt - 1];
      if (delay === undefined || !isTransientNetworkError(error)) throw error;
      console.warn(
        `Transient database network error (attempt ${attempt}/3); retrying in ${delay}ms.`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

let results;
try {
  results = await runChecks();
} catch (error) {
  console.error(`Database readiness check failed: ${conciseError(error)}`);
  process.exit(1);
}

for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}: ${result.detail}`);
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
