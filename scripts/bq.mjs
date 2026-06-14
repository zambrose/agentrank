#!/usr/bin/env node
// AgentDex BigQuery runner. Reusable by the api-caching agent.
//
// Usage:
//   node scripts/bq.mjs dry  <file.sql | -e "SELECT ...">   # dry-run, prints bytes
//   node scripts/bq.mjs run  <file.sql | -e "SELECT ...">   # run, prints rows + bytes
//   node scripts/bq.mjs run  file.sql --param key=value     # (params not yet wired; placeholder)
//
// Always prints totalBytesProcessed so we stay inside the billing cap.
// Location is pinned to 'US' (where the public crypto_ethereum dataset lives).
import { BigQuery } from '@google-cloud/bigquery';
import { readFileSync } from 'node:fs';

const LOCATION = 'US';
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'agentrank-499305';

const bq = new BigQuery({
  projectId: PROJECT,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

function fmtBytes(n) {
  n = Number(n || 0);
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(2)} ${u[i]}`;
}

function readQuery(arg, rest) {
  if (arg === '-e') return rest.join(' ');
  return readFileSync(arg, 'utf8');
}

async function dry(query) {
  const [job] = await bq.createQueryJob({ query, location: LOCATION, dryRun: true });
  const bytes = job.metadata.statistics.totalBytesProcessed;
  console.error(`[dryRun] would process ${fmtBytes(bytes)} (${bytes} bytes)`);
  return bytes;
}

async function run(query) {
  const bytes = await dry(query);
  // Guardrail: refuse anything estimated above ~25 GB unless FORCE=1.
  const CAP = 25 * 1024 ** 3;
  if (Number(bytes) > CAP && process.env.FORCE !== '1') {
    console.error(`[abort] estimate ${fmtBytes(bytes)} exceeds 25GB cap. Set FORCE=1 to override.`);
    process.exit(2);
  }
  const [job] = await bq.createQueryJob({ query, location: LOCATION });
  const [rows] = await job.getQueryResults();
  const used = job.metadata.statistics.query.totalBytesProcessed;
  const billed = job.metadata.statistics.query.totalBytesBilled;
  console.error(`[run] processed ${fmtBytes(used)} / billed ${fmtBytes(billed)} | ${rows.length} rows`);
  console.log(JSON.stringify(rows, null, 2));
  return rows;
}

const [mode, arg, ...rest] = process.argv.slice(2);
if (!mode || !arg) {
  console.error('usage: node scripts/bq.mjs <dry|run> <file.sql | -e "QUERY">');
  process.exit(1);
}
const query = readQuery(arg, rest);
const fn = mode === 'dry' ? dry : run;
fn(query).catch((e) => { console.error('BQ ERROR:', e.message); process.exit(1); });
