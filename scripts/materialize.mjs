#!/usr/bin/env node
// =============================================================================
// scripts/materialize.mjs  —  Refresh the BigQuery agent_summary table and
//                              write local JSON snapshots.
// =============================================================================
// Usage: npm run materialize
//        (or: node scripts/materialize.mjs)
//
// Steps:
//   1. Runs sql/05_materialize.sql against BigQuery (CREATE OR REPLACE TABLE),
//      bounded to a 400 GB billedBytes hard ceiling.
//   2. SELECT * FROM the resulting table, maps snake_case → camelCase, and
//      writes data/agent_summary.json (full list, rank-sorted).
//   3. Writes shared/fixtures/agents.json (top 50 by rank, pretty-printed).
//
// Idempotent: safe to re-run. Each run replaces both JSON files atomically
// via a temp-write + rename pattern.
//
// Env vars:
//   GOOGLE_APPLICATION_CREDENTIALS — path to service account JSON (required)
//   GOOGLE_CLOUD_PROJECT            — defaults to agentrank-499305
// =============================================================================
import { BigQuery } from '@google-cloud/bigquery';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PROJECT       = process.env.GOOGLE_CLOUD_PROJECT || 'agentrank-499305';
const LOCATION      = 'US';
const MAX_BYTES     = 400_000_000_000; // 400 GB hard cap
const TABLE         = `${PROJECT}.agentrank.agent_summary`;
const SQL_FILE      = path.join(ROOT, 'sql', '05_materialize.sql');
const SNAPSHOT_FILE = path.join(ROOT, 'data', 'agent_summary.json');
const FIXTURES_FILE = path.join(ROOT, 'shared', 'fixtures', 'agents.json');

// ---------------------------------------------------------------------------
// BigQuery client
// ---------------------------------------------------------------------------
const bq = new BigQuery({
  projectId: PROJECT,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  location: LOCATION,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtBytes(n) {
  n = Number(n || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(2)} ${units[i]}`;
}

/**
 * Unwrap BigQuery timestamp objects (which come as {value: "ISO string"})
 * or return string/null values as-is.
 */
function unwrapTimestamp(v) {
  if (v == null) return null;
  if (typeof v === 'object' && 'value' in v) return v.value;
  return String(v);
}

/**
 * Map a raw BigQuery snake_case row to the AgentSummary camelCase contract
 * defined in shared/schema.ts.
 */
function mapRow(row) {
  return {
    agentId:           Number(row.agent_id),
    ownerAddress:      String(row.owner_address ?? '').toLowerCase(),
    tokenURI:          row.token_uri ?? null,
    registeredAt:      unwrapTimestamp(row.registered_at),
    registeredTx:      String(row.registered_tx ?? ''),
    feedbackCount:     Number(row.feedback_count ?? 0),
    uniqueClients:     Number(row.unique_clients ?? 0),
    scoreBreakdown: {
      positive: Number(row.positive_count ?? 0),
      neutral:  Number(row.neutral_count  ?? 0),
      negative: Number(row.negative_count ?? 0),
    },
    avgRawScore:       row.avg_raw_score != null ? Number(row.avg_raw_score) : null,
    reputationScore:   Number(row.reputation_score ?? 50),
    effectiveFeedback: Number(row.effective_feedback ?? 0),
    lastFeedbackAt:    unwrapTimestamp(row.last_feedback_at),
    lastActivityAt:    unwrapTimestamp(row.last_activity_at),
    rank:              Number(row.rank ?? 0),
    x402:              Boolean(row.x402 ?? false),
    computedAt:        unwrapTimestamp(row.computed_at),
  };
}

/**
 * Atomic write: write to a .tmp sibling, then rename into place.
 * Prevents partial reads if the process is killed mid-write.
 */
function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, data, 'utf8');
  renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('[materialize] FATAL: GOOGLE_APPLICATION_CREDENTIALS not set.');
    process.exit(1);
  }

  // ── Step 1: Run the materialisation SQL ───────────────────────────────────
  const sql = readFileSync(SQL_FILE, 'utf8');
  console.log(`[materialize] Running ${SQL_FILE} …`);

  // Dry-run first to check billing estimate.
  const [dryJob] = await bq.createQueryJob({
    query: sql,
    location: LOCATION,
    dryRun: true,
    maximumBytesBilled: String(MAX_BYTES),
  });
  const estimatedBytes = Number(dryJob.metadata.statistics.totalBytesProcessed ?? 0);
  console.log(`[materialize] Estimated scan: ${fmtBytes(estimatedBytes)}`);

  if (estimatedBytes > MAX_BYTES) {
    console.error(
      `[materialize] ABORT: estimate ${fmtBytes(estimatedBytes)} exceeds ${fmtBytes(MAX_BYTES)} cap.`,
    );
    process.exit(2);
  }

  const [job] = await bq.createQueryJob({
    query: sql,
    location: LOCATION,
    maximumBytesBilled: String(MAX_BYTES),
  });
  await job.promise();
  const [jobMeta] = await job.getMetadata();
  const processedBytes = Number(jobMeta.statistics?.query?.totalBytesProcessed ?? 0);
  const billedBytes    = Number(jobMeta.statistics?.query?.totalBytesBilled    ?? 0);
  console.log(
    `[materialize] Materialisation complete. ` +
    `Processed: ${fmtBytes(processedBytes)}, Billed: ${fmtBytes(billedBytes)}`,
  );

  // ── Step 2: SELECT * from the materialized table ──────────────────────────
  const selectSQL = `SELECT * FROM \`${TABLE}\` ORDER BY rank ASC`;
  console.log(`[materialize] Fetching all rows from ${TABLE} …`);

  const [selectJob] = await bq.createQueryJob({
    query: selectSQL,
    location: LOCATION,
    maximumBytesBilled: String(MAX_BYTES),
  });
  const [rawRows] = await selectJob.getQueryResults({ autoPaginate: true });

  const [selectMeta] = await selectJob.getMetadata();
  const selectBilled = Number(selectMeta.statistics?.query?.totalBytesBilled ?? 0);
  console.log(
    `[materialize] Fetched ${rawRows.length} rows (billed: ${fmtBytes(selectBilled)})`,
  );

  // ── Step 3: Map and sort ──────────────────────────────────────────────────
  const agents = rawRows.map(mapRow).sort((a, b) => a.rank - b.rank);

  // ── Step 4: Write data/agent_summary.json ────────────────────────────────
  atomicWrite(SNAPSHOT_FILE, JSON.stringify(agents));
  console.log(`[materialize] Wrote ${agents.length} agents to ${SNAPSHOT_FILE}`);

  // ── Step 5: Write shared/fixtures/agents.json (top 50, pretty) ───────────
  const top50 = agents.slice(0, 50);
  atomicWrite(FIXTURES_FILE, JSON.stringify(top50, null, 2));
  console.log(`[materialize] Wrote top ${top50.length} agents to ${FIXTURES_FILE}`);

  console.log('[materialize] Done.');
}

main().catch((err) => {
  console.error('[materialize] ERROR:', err.message ?? err);
  process.exit(1);
});
