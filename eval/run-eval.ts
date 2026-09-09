#!/usr/bin/env npx tsx
/**
 * Eval Runner — measures Text-to-SQL agent accuracy.
 *
 * Usage:
 *   npx tsx eval/run-eval.ts [--provider deepseek] [--model ...]
 *     [--prompt-variant v4] [--limit 5] [--validate-only]
 *     [--rescore eval/results-....json]
 *
 * Requires:
 *   - The dev server running (default http://localhost:3000)
 *   - RETAIL_DATABASE_URL set (used to execute reference + generated SQL)
 *   - Provider API keys in .env.local
 *
 * For each case it: sends the question to /api/chat, extracts the SQL the
 * agent actually ran (from the runSql tool call in the stream), executes both
 * that SQL and the reference SQL against the retail DB, and compares result
 * sets. Outputs a JSON + Markdown report (same convention as balatro-agent).
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { parseDataStreamPart } from 'ai';
import { z } from 'zod';
import {
  resultSetsMatch,
  aggregate,
  type CaseScore,
  type ResultSetComparisonOptions,
} from './metrics';
import { validateSql } from '../src/lib/sql-validator';
import { DEFAULT_PROMPT_VARIANT } from '../src/lib/prompts';
import { PROVIDERS, type ProviderId } from '../src/lib/providers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(rootDir, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) {
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const testCaseSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  question: z.string().min(1),
  expectedSql: z.string().min(1),
  language: z.string().min(1),
  scored: z.boolean().default(true),
  reviewNote: z.string().min(1).optional(),
  comparison: z.object({
    orderMatters: z.boolean().default(false),
    numericTolerance: z.number().finite().nonnegative().default(0),
    allowCandidateExtraColumns: z.boolean().default(false),
    textContainment: z.boolean().default(false),
    period: z.object({
      columnIndex: z.number().int().nonnegative(),
      granularity: z.enum(['month', 'quarter']),
      timeZone: z.string().min(1).optional(),
      year: z.number().int().optional(),
    }).optional(),
  }).default({}),
});

export function parseEvalTestCases(input: unknown) {
  return z.array(testCaseSchema).parse(input);
}

interface CaseResult extends CaseScore {
  id: string;
  category: string;
  question: string;
  scored: boolean;
  reviewNote?: string;
  generatedSql: string | null;
  refRowCount: number;
  genRowCount: number;
  latencyMs: number;
  toolStepCount: number;
  retryCount: number;
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedCostUsd: number | null;
  comparison: ResultSetComparisonOptions;
  finishReason: string | null;
  streamErrorCount: number;
  malformedStreamPartCount: number;
  finalAnswerChars: number;
  failureCategory?: string;
  error?: string;
}

interface EvalMetadata {
  generatedAt: string;
  commitSha: string;
  workingTreeDirty: boolean;
  sourceSnapshotSha256: string;
  provider: string;
  model: string;
  promptVariant: string;
  datasetVersion: string;
  datasetSha256: string;
  apiUrl: string;
  comparisonPolicy: string;
  runMode: 'live' | 'offline-rescore';
  sourceResultFile?: string;
  adjudicationTiming?: 'post-run';
}

export interface EvalStreamInspection {
  generatedSql: string | null;
  toolStepCount: number;
  runSqlCount: number;
  runSqlResultCount: number;
  retryCount: number;
  lastRunSqlSucceeded: boolean | null;
  finalAnswerText: string;
  finishReason: string | null;
  streamFinished: boolean;
  errors: string[];
  malformedPartCount: number;
  promptTokens: number | null;
  completionTokens: number | null;
}

export function scoreApplicationOutcome(
  stream: EvalStreamInspection,
  sqlResultAccuracy: number,
): Pick<CaseScore, 'applicationExecutionSuccess' | 'answerCompleteness' | 'taskSuccess'> {
  const applicationExecutionSuccess = stream.lastRunSqlSucceeded === true ? 1 : 0;
  const answerCompleteness =
    stream.streamFinished &&
    stream.finishReason === 'stop' &&
    stream.errors.length === 0 &&
    stream.malformedPartCount === 0 &&
    stream.finalAnswerText.trim().length > 0
      ? 1
      : 0;
  const taskSuccess =
    sqlResultAccuracy && applicationExecutionSuccess && answerCompleteness ? 1 : 0;
  return { applicationExecutionSuccess, answerCompleteness, taskSuccess };
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const provider = getArg(args, '--provider', 'deepseek');
  const model = getArg(args, '--model', '');
  const promptVariant = getArg(args, '--prompt-variant', DEFAULT_PROMPT_VARIANT);
  const limit = parseInt(getArg(args, '--limit', '0'), 10);
  const validateOnly = args.includes('--validate-only');
  const rescorePath = getArg(args, '--rescore', '');
  const baseUrl = process.env.EVAL_API_URL ?? 'http://localhost:3000';

  const cases = parseEvalTestCases(JSON.parse(
    fs.readFileSync(path.join(__dirname, 'test-cases.json'), 'utf-8'),
  ));
  const selected = limit > 0 ? cases.slice(0, limit) : cases;
  if (validateOnly) {
    console.log(`PASS eval contract: ${cases.length} cases are valid; ${selected.length} selected.`);
    return;
  }

  const retailUrl = process.env.RETAIL_DATABASE_URL;
  if (!retailUrl) {
    console.error('❌ RETAIL_DATABASE_URL is required to score execution accuracy.');
    process.exit(1);
  }
  const sql = neon(retailUrl);
  const resolvedModel = model || PROVIDERS[provider as ProviderId]?.defaultModel || 'unknown';
  const datasetText = fs.readFileSync(path.join(__dirname, 'test-cases.json'), 'utf-8');

  if (rescorePath) {
    await rescoreStoredRun({
      sourcePath: path.resolve(rootDir, rescorePath),
      cases: selected,
      sql,
      datasetText,
    });
    return;
  }

  const metadata: EvalMetadata = {
    generatedAt: new Date().toISOString(),
    commitSha: currentCommitSha(),
    workingTreeDirty: currentWorkingTreeDirty(),
    sourceSnapshotSha256: currentSourceSnapshotSha256(),
    provider,
    model: resolvedModel,
    promptVariant,
    datasetVersion: 'retail-v1',
    datasetSha256: createHash('sha256').update(datasetText).digest('hex'),
    apiUrl: baseUrl,
    comparisonPolicy: 'exact-by-default-contract-aware-v2',
    runMode: 'live',
  };

  console.log(`\n🧪 Text-to-SQL Agent Eval\n`);
  console.log(`   Provider: ${provider}   Model: ${model || 'default'}`);
  console.log(`   Prompt: ${promptVariant || 'default'}`);
  console.log(`   API: ${baseUrl}   Tests: ${selected.length}\n`);

  const results: CaseResult[] = [];

  for (let i = 0; i < selected.length; i++) {
    const tc = selected[i];
    process.stdout.write(`[${i + 1}/${selected.length}] ${tc.id} ... `);
    const start = Date.now();

    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: tc.question }],
          provider,
          model: model || undefined,
          promptVariant: promptVariant || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);

      const text = await res.text();
      const latencyMs = Date.now() - start;
      const stream = inspectStream(text);
      const generatedSql = stream.generatedSql;

      // Reference result set.
      const refRows = (await sql.query(tc.expectedSql)) as Record<string, unknown>[];

      let validity = 0;
      let replayExecutionSuccess = 0;
      let execAccuracy = 0;
      let schemaAdherence = 0;
      let genRows: Record<string, unknown>[] = [];
      let replayError: string | undefined;

      if (generatedSql) {
        const validation = validateSql(generatedSql);
        if (validation.valid) {
          validity = 1;
          try {
            genRows = (await sql.query(validation.sql)) as Record<string, unknown>[];
            replayExecutionSuccess = 1;
            schemaAdherence = 1;
            execAccuracy = resultSetsMatch(genRows, refRows, tc.comparison) ? 1 : 0;
          } catch (error) {
            replayError = error instanceof Error ? error.message : String(error);
          }
        } else {
          replayError = validation.error;
        }
      }

      const {
        applicationExecutionSuccess,
        answerCompleteness,
        taskSuccess,
      } = scoreApplicationOutcome(stream, execAccuracy);

      const failureCategory = !tc.scored
        ? 'DIAGNOSTIC_EXCLUDED'
        : taskSuccess
          ? undefined
          : !generatedSql
            ? 'NO_SQL'
            : !validity
              ? 'INVALID_SQL'
              : !replayExecutionSuccess
                ? 'REPLAY_EXECUTION_ERROR'
                : !execAccuracy
                  ? genRows.length !== refRows.length
                    ? 'ROW_COUNT_MISMATCH'
                    : 'RESULT_VALUE_OR_SHAPE_MISMATCH'
                  : stream.lastRunSqlSucceeded == null
                    ? 'MISSING_APPLICATION_TOOL_RESULT'
                    : !applicationExecutionSuccess
                      ? 'APPLICATION_SQL_FAILED'
                      : stream.errors.length > 0
                        ? 'STREAM_ERROR'
                        : stream.malformedPartCount > 0
                          ? 'MALFORMED_STREAM'
                          : !stream.streamFinished
                            ? 'INCOMPLETE_STREAM'
                            : stream.finishReason !== 'stop'
                              ? 'INCOMPLETE_FINISH_REASON'
                              : 'MISSING_FINAL_ANSWER';

      results.push({
        id: tc.id,
        category: tc.category,
        question: tc.question,
        scored: tc.scored,
        reviewNote: tc.reviewNote,
        generatedSql,
        refRowCount: refRows.length,
        genRowCount: genRows.length,
        validity,
        replayExecutionSuccess,
        execAccuracy,
        schemaAdherence,
        applicationExecutionSuccess,
        answerCompleteness,
        taskSuccess,
        latencyMs,
        toolStepCount: stream.toolStepCount,
        retryCount: stream.retryCount,
        promptTokens: stream.promptTokens,
        completionTokens: stream.completionTokens,
        estimatedCostUsd: null,
        comparison: tc.comparison,
        finishReason: stream.finishReason,
        streamErrorCount: stream.errors.length,
        malformedStreamPartCount: stream.malformedPartCount,
        finalAnswerChars: stream.finalAnswerText.length,
        failureCategory,
        error: replayError,
      });

      const mark = !tc.scored ? '🧭' : taskSuccess ? '✅' : execAccuracy ? '⚠️ ' : '❌';
      console.log(`${mark} (sql=${execAccuracy}, task=${taskSuccess}, ${latencyMs}ms)`);
    } catch (err) {
      results.push({
        id: tc.id,
        category: tc.category,
        question: tc.question,
        scored: tc.scored,
        reviewNote: tc.reviewNote,
        generatedSql: null,
        refRowCount: 0,
        genRowCount: 0,
        validity: 0,
        replayExecutionSuccess: 0,
        execAccuracy: 0,
        schemaAdherence: 0,
        applicationExecutionSuccess: 0,
        answerCompleteness: 0,
        taskSuccess: 0,
        latencyMs: Date.now() - start,
        toolStepCount: 0,
        retryCount: 0,
        promptTokens: null,
        completionTokens: null,
        estimatedCostUsd: null,
        comparison: tc.comparison,
        finishReason: null,
        streamErrorCount: 0,
        malformedStreamPartCount: 0,
        finalAnswerChars: 0,
        failureCategory: 'HARNESS_ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
      console.log(`❌ ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  writeReports(results, metadata);
}

const storedRunSchema = z.object({
  metadata: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    promptVariant: z.string(),
    apiUrl: z.string().optional(),
  }).passthrough(),
  results: z.array(z.object({
    id: z.string().min(1),
    question: z.string().min(1),
    generatedSql: z.string().nullable(),
    applicationExecutionSuccess: z.number(),
    answerCompleteness: z.number(),
    latencyMs: z.number(),
    toolStepCount: z.number(),
    retryCount: z.number(),
    promptTokens: z.number().nullable(),
    completionTokens: z.number().nullable(),
    estimatedCostUsd: z.number().nullable(),
    finishReason: z.string().nullable(),
    streamErrorCount: z.number(),
    malformedStreamPartCount: z.number(),
    finalAnswerChars: z.number(),
  }).passthrough()),
});

async function rescoreStoredRun({
  sourcePath,
  cases,
  sql,
  datasetText,
}: {
  sourcePath: string;
  cases: ReturnType<typeof parseEvalTestCases>;
  sql: NeonQueryFunction<false, false>;
  datasetText: string;
}) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Stored eval result not found: ${sourcePath}`);
  }
  const stored = storedRunSchema.parse(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
  const previousById = new Map(stored.results.map((result) => [result.id, result]));
  const duplicateIds = stored.results
    .filter((result, index, all) => all.findIndex((item) => item.id === result.id) !== index)
    .map((result) => result.id);
  if (duplicateIds.length > 0) {
    throw new Error(`Stored eval contains duplicate case IDs: ${[...new Set(duplicateIds)].join(', ')}`);
  }

  const results: CaseResult[] = [];
  console.log(`\n🧮 Offline eval rescore\n`);
  console.log(`   Source: ${path.relative(rootDir, sourcePath)}`);
  console.log(`   Contract: exact-by-default-contract-aware-v2`);
  console.log(`   Cases: ${cases.length} (${cases.filter((testCase) => testCase.scored).length} scored)\n`);

  for (let index = 0; index < cases.length; index++) {
    const tc = cases[index];
    const previous = previousById.get(tc.id);
    if (!previous) throw new Error(`Stored eval is missing case ${tc.id}`);
    if (previous.question !== tc.question) {
      throw new Error(
        `Stored eval question does not match the current contract for ${tc.id}`,
      );
    }
    process.stdout.write(`[${index + 1}/${cases.length}] ${tc.id} ... `);

    const refRows = (await sql.query(tc.expectedSql)) as Record<string, unknown>[];
    let validity = 0;
    let replayExecutionSuccess = 0;
    let execAccuracy = 0;
    let schemaAdherence = 0;
    let genRows: Record<string, unknown>[] = [];
    let replayError: string | undefined;

    if (previous.generatedSql) {
      const validation = validateSql(previous.generatedSql);
      if (validation.valid) {
        validity = 1;
        try {
          genRows = (await sql.query(validation.sql)) as Record<string, unknown>[];
          replayExecutionSuccess = 1;
          schemaAdherence = 1;
          execAccuracy = resultSetsMatch(genRows, refRows, tc.comparison) ? 1 : 0;
        } catch (error) {
          replayError = error instanceof Error ? error.message : String(error);
        }
      } else {
        replayError = validation.error;
      }
    }

    const taskSuccess = execAccuracy &&
      previous.applicationExecutionSuccess &&
      previous.answerCompleteness ? 1 : 0;
    const failureCategory = !tc.scored
      ? 'DIAGNOSTIC_EXCLUDED'
      : taskSuccess
        ? undefined
        : !previous.generatedSql
          ? 'NO_SQL'
          : !validity
            ? 'INVALID_SQL'
            : !replayExecutionSuccess
              ? 'REPLAY_EXECUTION_ERROR'
              : !execAccuracy
                ? genRows.length !== refRows.length
                  ? 'ROW_COUNT_MISMATCH'
                  : 'RESULT_VALUE_OR_SHAPE_MISMATCH'
                : !previous.applicationExecutionSuccess
                  ? 'APPLICATION_SQL_FAILED'
                  : 'MISSING_FINAL_ANSWER';

    results.push({
      id: tc.id,
      category: tc.category,
      question: tc.question,
      scored: tc.scored,
      reviewNote: tc.reviewNote,
      generatedSql: previous.generatedSql,
      refRowCount: refRows.length,
      genRowCount: genRows.length,
      validity,
      replayExecutionSuccess,
      execAccuracy,
      schemaAdherence,
      applicationExecutionSuccess: previous.applicationExecutionSuccess,
      answerCompleteness: previous.answerCompleteness,
      taskSuccess,
      latencyMs: previous.latencyMs,
      toolStepCount: previous.toolStepCount,
      retryCount: previous.retryCount,
      promptTokens: previous.promptTokens,
      completionTokens: previous.completionTokens,
      estimatedCostUsd: previous.estimatedCostUsd,
      comparison: tc.comparison,
      finishReason: previous.finishReason,
      streamErrorCount: previous.streamErrorCount,
      malformedStreamPartCount: previous.malformedStreamPartCount,
      finalAnswerChars: previous.finalAnswerChars,
      failureCategory,
      error: replayError,
    });
    const mark = !tc.scored ? '🧭' : taskSuccess ? '✅' : '❌';
    console.log(`${mark} (sql=${execAccuracy}, task=${taskSuccess})`);
  }

  const metadata: EvalMetadata = {
    generatedAt: new Date().toISOString(),
    commitSha: currentCommitSha(),
    workingTreeDirty: currentWorkingTreeDirty(),
    sourceSnapshotSha256: currentSourceSnapshotSha256(),
    provider: stored.metadata.provider,
    model: stored.metadata.model,
    promptVariant: stored.metadata.promptVariant,
    datasetVersion: 'retail-v1',
    datasetSha256: createHash('sha256').update(datasetText).digest('hex'),
    apiUrl: stored.metadata.apiUrl ?? 'unknown',
    comparisonPolicy: 'exact-by-default-contract-aware-v2',
    runMode: 'offline-rescore',
    sourceResultFile: path.relative(rootDir, sourcePath),
    adjudicationTiming: 'post-run',
  };
  writeReports(results, metadata);
}

// ─── Stream parsing ──────────────────────────────────────────────

/**
 * Extract the SQL string from the LAST runSql tool call in the AI SDK data
 * stream. Tool calls arrive as `9:{...}` lines with toolName + args.
 */
export function inspectStream(stream: string): EvalStreamInspection {
  let last: string | null = null;
  let toolStepCount = 0;
  let runSqlCount = 0;
  let runSqlResultCount = 0;
  let retryCount = 0;
  let previousRunSqlFailed = false;
  let lastRunSqlCallId: string | null = null;
  let lastRunSqlSucceeded: boolean | null = null;
  let finalAnswerText = '';
  let finishReason: string | null = null;
  let streamFinished = false;
  const errors: string[] = [];
  let malformedPartCount = 0;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  const toolNames = new Map<string, string>();
  for (const line of stream.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const part = parseDataStreamPart(t);
      if (part.type === 'tool_call') {
        const data = part.value;
        toolStepCount++;
        toolNames.set(data.toolCallId, data.toolName);
        if (data.toolName === 'runSql') {
          if (previousRunSqlFailed) retryCount++;
          runSqlCount++;
          lastRunSqlCallId = data.toolCallId;
          lastRunSqlSucceeded = null;
          finalAnswerText = '';
          if (data.args?.sql) last = String(data.args.sql);
        }
      } else if (part.type === 'tool_result') {
        if (toolNames.get(part.value.toolCallId) === 'runSql') {
          runSqlResultCount++;
          if (part.value.toolCallId === lastRunSqlCallId) {
            const result = part.value.result;
            lastRunSqlSucceeded =
              result != null &&
              typeof result === 'object' &&
              'success' in result &&
              typeof result.success === 'boolean'
                ? result.success
                : null;
            previousRunSqlFailed = lastRunSqlSucceeded === false;
            finalAnswerText = '';
          }
        }
      } else if (part.type === 'text') {
        if (lastRunSqlSucceeded !== null) finalAnswerText += part.value;
      } else if (part.type === 'error') {
        errors.push(part.value);
      } else if (part.type === 'finish_message') {
        streamFinished = true;
        finishReason = part.value.finishReason;
        const usage = part.value.usage;
        if (usage) {
          if (Number.isFinite(usage.promptTokens)) promptTokens = usage.promptTokens;
          if (Number.isFinite(usage.completionTokens)) completionTokens = usage.completionTokens;
        }
      }
    } catch {
      malformedPartCount++;
    }
  }
  return {
    generatedSql: last,
    toolStepCount,
    runSqlCount,
    runSqlResultCount,
    retryCount,
    lastRunSqlSucceeded,
    finalAnswerText,
    finishReason,
    streamFinished,
    errors,
    malformedPartCount,
    promptTokens,
    completionTokens,
  };
}

// ─── Reporting ───────────────────────────────────────────────────

function writeReports(
  results: CaseResult[],
  metadata: EvalMetadata,
) {
  const scoredResults = results.filter((result) => result.scored);
  const diagnosticResults = results.filter((result) => !result.scored);
  const agg = aggregate(scoredResults);
  const operationalAgg = aggregate(results);
  const byCat: Record<string, CaseResult[]> = {};
  for (const r of scoredResults) (byCat[r.category] ??= []).push(r);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = [
    metadata.provider,
    metadata.promptVariant,
    metadata.runMode === 'offline-rescore' ? 'rescore' : '',
  ]
    .filter(Boolean)
    .join('-')
    .replace(/[^a-z0-9]/g, '-');

  fs.writeFileSync(
    path.join(__dirname, `results-${slug}-${ts}.json`),
    JSON.stringify({
      metadata,
      aggregate: agg,
      operationalAggregate: operationalAgg,
      scoredCaseCount: scoredResults.length,
      diagnosticCaseCount: diagnosticResults.length,
      results,
    }, null, 2),
  );

  const lines: string[] = [
    `# Text-to-SQL Agent Eval Report`,
    ``,
    `**Provider**: ${metadata.provider}　**Model**: ${metadata.model}　**Prompt**: ${metadata.promptVariant}　**Date**: ${metadata.generatedAt}`,
    `**Commit**: ${metadata.commitSha}　**Dataset**: ${metadata.datasetVersion} (${metadata.datasetSha256.slice(0, 12)})`,
    `**Source snapshot**: ${metadata.sourceSnapshotSha256.slice(0, 12)}　**Working tree dirty**: ${metadata.workingTreeDirty ? 'yes' : 'no'}`,
    `**Run mode**: ${metadata.runMode}${metadata.sourceResultFile ? `　**Source result**: ${metadata.sourceResultFile}` : ''}`,
    ...(metadata.adjudicationTiming === 'post-run'
      ? [`**Evidence status**: post-run adjudication; this is not a prospective frozen-contract baseline.`]
      : []),
    ``,
    `## Overall`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Tests | ${results.length} |`,
    `| Scored tests | ${scoredResults.length} |`,
    `| Diagnostic / excluded tests | ${diagnosticResults.length} |`,
    `| SQL validity (all tests) | ${(operationalAgg.validityRate * 100).toFixed(1)}% |`,
    `| Replay execution success (all tests) | ${(operationalAgg.replayExecutionSuccess * 100).toFixed(1)}% |`,
    `| SQL result accuracy | ${(agg.execAccuracy * 100).toFixed(1)}% |`,
    `| Schema adherence (all tests) | ${(operationalAgg.schemaAdherence * 100).toFixed(1)}% |`,
    `| Application tool success (all tests) | ${(operationalAgg.applicationExecutionSuccess * 100).toFixed(1)}% |`,
    `| Answer completeness (all tests) | ${(operationalAgg.answerCompleteness * 100).toFixed(1)}% |`,
    `| End-to-end task success | ${(agg.taskSuccess * 100).toFixed(1)}% |`,
    ``,
    `## By category`,
    ``,
    `| Category | Scored tests | SQL result accuracy | Task success |`,
    `|----------|-------|---------------------|--------------|`,
  ];
  for (const [cat, rs] of Object.entries(byCat)) {
    const acc = rs.reduce((s, r) => s + r.execAccuracy, 0) / rs.length;
    const task = rs.reduce((s, r) => s + r.taskSuccess, 0) / rs.length;
    lines.push(`| ${cat} | ${rs.length} | ${(acc * 100).toFixed(0)}% | ${(task * 100).toFixed(0)}% |`);
  }

  if (diagnosticResults.length > 0) {
    lines.push('', '## Diagnostic / excluded cases', '');
    for (const r of diagnosticResults) {
      lines.push(`- **${r.id}**: ${r.reviewNote ?? 'Excluded from the primary score.'}`);
    }
  }

  lines.push('', '## Failed / incomplete scored cases', '');
  for (const r of scoredResults.filter((r) => r.taskSuccess < 1)) {
    lines.push(`### ${r.id} — ${r.category}`);
    lines.push(`- **Q**: ${r.question}`);
    lines.push(`- **Failure category**: ${r.failureCategory ?? 'unknown'}`);
    lines.push(`- **Generated SQL**: \`${r.generatedSql ?? 'none'}\``);
    lines.push(`- **rows**: gen=${r.genRowCount} ref=${r.refRowCount}`);
    lines.push(`- **application tool / answer / finish**: ${r.applicationExecutionSuccess} / ${r.answerCompleteness} / ${r.finishReason ?? 'missing'}`);
    if (r.error) lines.push(`- **Error**: ${r.error}`);
    lines.push('');
  }

  const reportPath = path.join(__dirname, `report-${slug}-${ts}.md`);
  fs.writeFileSync(reportPath, lines.join('\n'));

  console.log(`\n${'═'.repeat(56)}`);
  console.log(
    `📊 ${metadata.provider}/${metadata.model} (prompt=${metadata.promptVariant})`,
  );
  console.log(`   Scored:      ${scoredResults.length}/${results.length}`);
  console.log(`   Validity:    ${(operationalAgg.validityRate * 100).toFixed(1)}%`);
  console.log(`   SQL result:  ${(agg.execAccuracy * 100).toFixed(1)}%`);
  console.log(`   Task success:${(agg.taskSuccess * 100).toFixed(1)}%`);
  console.log(`   Schema adh:  ${(agg.schemaAdherence * 100).toFixed(1)}%`);
  console.log(`   Report: ${reportPath}\n`);
}

function currentCommitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function currentWorkingTreeDirty(): boolean {
  try {
    return execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=normal'],
      { cwd: rootDir, encoding: 'utf8' },
    ).trim().length > 0;
  } catch {
    return true;
  }
}

function currentSourceSnapshotSha256(): string {
  try {
    const tracked = execFileSync('git', ['ls-files', '-z'], {
      cwd: rootDir,
      encoding: 'utf8',
    }).split('\0');
    const untracked = execFileSync(
      'git',
      ['ls-files', '--others', '--exclude-standard', '-z'],
      { cwd: rootDir, encoding: 'utf8' },
    ).split('\0');
    const sourceFiles = [...new Set([...tracked, ...untracked])]
      .filter(isEvalSourceFile)
      .sort();
    const hash = createHash('sha256');
    for (const file of sourceFiles) {
      const absolutePath = path.join(rootDir, file);
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
      hash.update(file);
      hash.update('\0');
      hash.update(fs.readFileSync(absolutePath));
      hash.update('\0');
    }
    return hash.digest('hex');
  } catch {
    return 'unknown';
  }
}

function isEvalSourceFile(file: string): boolean {
  return file.startsWith('src/') ||
    file.startsWith('drizzle/') ||
    file === 'eval/test-cases.json' ||
    /^eval\/.*\.ts$/.test(file) ||
    file === 'package.json' ||
    file === 'package-lock.json' ||
    file === 'tsconfig.json' ||
    /^next\.config\./.test(file);
}

function getArg(args: string[], flag: string, fallback: string): string {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Eval failed:', err);
    process.exit(1);
  });
}
