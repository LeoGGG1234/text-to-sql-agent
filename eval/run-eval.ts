#!/usr/bin/env npx tsx
/**
 * Eval Runner — measures Text-to-SQL agent accuracy.
 *
 * Usage:
 *   npx tsx eval/run-eval.ts [--provider deepseek] [--model ...] [--limit 5]
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
import { neon } from '@neondatabase/serverless';
import { resultSetsMatch, aggregate, type CaseScore } from './metrics';

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

interface TestCase {
  id: string;
  category: string;
  question: string;
  expectedSql: string;
  language: string;
}

interface CaseResult extends CaseScore {
  id: string;
  category: string;
  question: string;
  generatedSql: string | null;
  refRowCount: number;
  genRowCount: number;
  latencyMs: number;
  error?: string;
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const provider = getArg(args, '--provider', 'deepseek');
  const model = getArg(args, '--model', '');
  const limit = parseInt(getArg(args, '--limit', '0'), 10);
  const baseUrl = process.env.EVAL_API_URL ?? 'http://localhost:3000';

  const retailUrl = process.env.RETAIL_DATABASE_URL;
  if (!retailUrl) {
    console.error('❌ RETAIL_DATABASE_URL is required to score execution accuracy.');
    process.exit(1);
  }
  const sql = neon(retailUrl);

  const cases: TestCase[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'test-cases.json'), 'utf-8'),
  );
  const selected = limit > 0 ? cases.slice(0, limit) : cases;

  console.log(`\n🧪 Text-to-SQL Agent Eval\n`);
  console.log(`   Provider: ${provider}   Model: ${model || 'default'}`);
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
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);

      const text = await res.text();
      const latencyMs = Date.now() - start;
      const generatedSql = extractLastRunSql(text);

      // Reference result set.
      const refRows = (await sql.query(tc.expectedSql)) as Record<string, unknown>[];

      let validity = 0;
      let execAccuracy = 0;
      let schemaAdherence = 0;
      let genRows: Record<string, unknown>[] = [];

      if (generatedSql) {
        try {
          genRows = (await sql.query(generatedSql)) as Record<string, unknown>[];
          validity = 1;
          schemaAdherence = 1; // ran without unknown-column error
          execAccuracy = resultSetsMatch(genRows, refRows) ? 1 : 0;
        } catch (e) {
          const msg = e instanceof Error ? e.message.toLowerCase() : '';
          // It produced SQL but it failed to execute.
          if (!(msg.includes('column') && msg.includes('does not exist'))) {
            schemaAdherence = 1;
          }
        }
      }

      results.push({
        id: tc.id,
        category: tc.category,
        question: tc.question,
        generatedSql,
        refRowCount: refRows.length,
        genRowCount: genRows.length,
        validity,
        execAccuracy,
        schemaAdherence,
        latencyMs,
      });

      const mark = execAccuracy ? '✅' : validity ? '⚠️ ' : '❌';
      console.log(`${mark} (valid=${validity}, exact=${execAccuracy}, ${latencyMs}ms)`);
    } catch (err) {
      results.push({
        id: tc.id,
        category: tc.category,
        question: tc.question,
        generatedSql: null,
        refRowCount: 0,
        genRowCount: 0,
        validity: 0,
        execAccuracy: 0,
        schemaAdherence: 0,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      console.log(`❌ ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  writeReports(results, provider, model);
}

// ─── Stream parsing ──────────────────────────────────────────────

/**
 * Extract the SQL string from the LAST runSql tool call in the AI SDK data
 * stream. Tool calls arrive as `9:{...}` lines with toolName + args.
 */
function extractLastRunSql(stream: string): string | null {
  let last: string | null = null;
  for (const line of stream.split('\n')) {
    const t = line.trim();
    const colon = t.indexOf(':');
    if (colon <= 0) continue;
    const code = t.slice(0, colon);
    if (code !== '9') continue;
    try {
      const data = JSON.parse(t.slice(colon + 1));
      if (data?.toolName === 'runSql' && data?.args?.sql) {
        last = String(data.args.sql);
      }
    } catch {
      /* ignore malformed line */
    }
  }
  return last;
}

// ─── Reporting ───────────────────────────────────────────────────

function writeReports(results: CaseResult[], provider: string, model: string) {
  const agg = aggregate(results);
  const byCat: Record<string, CaseResult[]> = {};
  for (const r of results) (byCat[r.category] ??= []).push(r);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = provider.replace(/[^a-z0-9]/g, '-');

  fs.writeFileSync(
    path.join(__dirname, `results-${slug}-${ts}.json`),
    JSON.stringify(results, null, 2),
  );

  const lines: string[] = [
    `# Text-to-SQL Agent Eval Report`,
    ``,
    `**Provider**: ${provider}　**Model**: ${model || 'default'}　**Date**: ${new Date().toISOString()}`,
    ``,
    `## Overall`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Tests | ${results.length} |`,
    `| Validity rate | ${(agg.validityRate * 100).toFixed(1)}% |`,
    `| Execution accuracy | ${(agg.execAccuracy * 100).toFixed(1)}% |`,
    `| Schema adherence | ${(agg.schemaAdherence * 100).toFixed(1)}% |`,
    ``,
    `## By category`,
    ``,
    `| Category | Tests | Exec accuracy |`,
    `|----------|-------|---------------|`,
  ];
  for (const [cat, rs] of Object.entries(byCat)) {
    const acc = rs.reduce((s, r) => s + r.execAccuracy, 0) / rs.length;
    lines.push(`| ${cat} | ${rs.length} | ${(acc * 100).toFixed(0)}% |`);
  }

  lines.push('', '## Failed / inexact cases', '');
  for (const r of results.filter((r) => r.execAccuracy < 1)) {
    lines.push(`### ${r.id} — ${r.category}`);
    lines.push(`- **Q**: ${r.question}`);
    lines.push(`- **Generated SQL**: \`${r.generatedSql ?? 'none'}\``);
    lines.push(`- **rows**: gen=${r.genRowCount} ref=${r.refRowCount}`);
    if (r.error) lines.push(`- **Error**: ${r.error}`);
    lines.push('');
  }

  const reportPath = path.join(__dirname, `report-${slug}-${ts}.md`);
  fs.writeFileSync(reportPath, lines.join('\n'));

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`📊 ${provider}/${model || 'default'}`);
  console.log(`   Validity:    ${(agg.validityRate * 100).toFixed(1)}%`);
  console.log(`   Exec acc:    ${(agg.execAccuracy * 100).toFixed(1)}%`);
  console.log(`   Schema adh:  ${(agg.schemaAdherence * 100).toFixed(1)}%`);
  console.log(`   Report: ${reportPath}\n`);
}

function getArg(args: string[], flag: string, fallback: string): string {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

main().catch((err) => {
  console.error('Eval failed:', err);
  process.exit(1);
});
