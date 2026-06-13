#!/usr/bin/env node
// =============================================================================
// scripts/ens-warm.mjs — warm ENS reverse-resolution cache for top-ranked agents
// =============================================================================
// Reads data/agent_summary.json (or shared/fixtures/agents.json), takes the
// top N unique owner addresses sorted by rank, resolves each to an ENS primary
// name via viem on Ethereum mainnet, and persists the results to
// data/ens-cache.json so the Next.js API serves instant responses without
// waiting on RPC calls at request time.
//
// Usage:
//   node scripts/ens-warm.mjs                # top 200 addresses, concurrency 5
//   node scripts/ens-warm.mjs --top 500      # top 500
//   node scripts/ens-warm.mjs --concurrency 3
//   ETH_RPC_URL=https://... node scripts/ens-warm.mjs
//
// The script prints each resolved name (or "-" for no primary name) and a
// summary at the end.  Exits 0 even if some requests fail — partial results
// are still written.  It is safe to re-run; already-resolved addresses are
// served from the on-disk cache and not re-fetched.
// =============================================================================

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function flag(name, def) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : def;
}
const TOP = Number(flag('--top', '200'));
const CONCURRENCY = Number(flag('--concurrency', '5'));
const RPC_URL = process.env.ETH_RPC_URL ?? 'https://eth.llamarpc.com';
const TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Load agent summary
// ---------------------------------------------------------------------------
const SNAPSHOT = path.join(ROOT, 'data', 'agent_summary.json');
const FIXTURES = path.join(ROOT, 'shared', 'fixtures', 'agents.json');
const dataFile = existsSync(SNAPSHOT) ? SNAPSHOT : FIXTURES;

console.log(`[ens-warm] Loading agents from ${path.relative(ROOT, dataFile)} …`);
const agents = JSON.parse(readFileSync(dataFile, 'utf8'));
console.log(`[ens-warm] ${agents.length} total agents`);

// Deduplicate addresses, preserving rank order (agents are sorted by rank asc).
const seen = new Set();
const addresses = [];
for (const a of agents) {
  const addr = (a.ownerAddress ?? '').toLowerCase();
  if (addr && !seen.has(addr)) {
    seen.add(addr);
    addresses.push(addr);
    if (addresses.length >= TOP) break;
  }
}
console.log(`[ens-warm] Warming ENS cache for ${addresses.length} unique owner addresses`);
console.log(`[ens-warm] RPC: ${RPC_URL}  concurrency: ${CONCURRENCY}  timeout: ${TIMEOUT_MS}ms`);

// ---------------------------------------------------------------------------
// Load existing disk cache
// ---------------------------------------------------------------------------
const CACHE_FILE = path.join(ROOT, 'data', 'ens-cache.json');
let diskCache = {};
if (existsSync(CACHE_FILE)) {
  try {
    diskCache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    const hits = addresses.filter(a => Object.prototype.hasOwnProperty.call(diskCache, a)).length;
    console.log(`[ens-warm] Disk cache loaded: ${Object.keys(diskCache).length} entries, ${hits} already cached for this run`);
  } catch {
    console.warn('[ens-warm] Could not parse existing cache — starting fresh');
  }
}

// ---------------------------------------------------------------------------
// Viem client
// ---------------------------------------------------------------------------
const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL, {
    timeout: TIMEOUT_MS,
    retryCount: 2,
    retryDelay: 600,
  }),
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------
let resolved = 0;
let cached = 0;
let errors = 0;
let hasName = 0;

const queue = addresses.filter(addr => !Object.prototype.hasOwnProperty.call(diskCache, addr));
console.log(`[ens-warm] ${addresses.length - queue.length} addresses served from cache, ${queue.length} to fetch`);

/** Resolves one address, updates diskCache in place. */
async function resolveOne(address) {
  const start = Date.now();
  try {
    const name = await client.getEnsName({ address });
    diskCache[address] = name;
    resolved++;
    if (name) hasName++;
    const elapsed = Date.now() - start;
    console.log(`  [${resolved}/${queue.length}] ${address}  →  ${name ?? '-'}  (${elapsed}ms)`);
  } catch (err) {
    errors++;
    diskCache[address] = null; // cache null to skip on next run
    console.warn(`  [err] ${address}: ${err.message?.slice(0, 80)}`);
  }
}

/** Run at most `concurrency` workers over queue. */
async function runPool(items, fn, concurrency) {
  const it = items[Symbol.iterator]();
  async function worker() {
    for (;;) {
      const { value, done } = it.next();
      if (done) return;
      await fn(value);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

// Count pre-cached addresses with names
for (const addr of addresses) {
  if (Object.prototype.hasOwnProperty.call(diskCache, addr) && diskCache[addr]) {
    hasName++;
    cached++;
  }
}

if (queue.length > 0) {
  console.log('[ens-warm] Starting resolution …');
  await runPool(queue, resolveOne, CONCURRENCY);
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------
writeFileSync(CACHE_FILE, JSON.stringify(diskCache, null, 2), 'utf8');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const total = addresses.length;
console.log('');
console.log('=== ens-warm summary ===');
console.log(`  Addresses processed : ${total}`);
console.log(`  Served from cache   : ${cached}`);
console.log(`  Newly fetched       : ${resolved}`);
console.log(`  Errors              : ${errors}`);
console.log(`  Have ENS name       : ${hasName} / ${total} (${((hasName / total) * 100).toFixed(1)}%)`);
console.log(`  Cache written to    : ${path.relative(ROOT, CACHE_FILE)}`);
console.log('');

// Print a sample of resolved names
const sample = Object.entries(diskCache)
  .filter(([, v]) => v !== null && v !== undefined)
  .slice(0, 15);

if (sample.length > 0) {
  console.log('Sample resolved names:');
  for (const [addr, name] of sample) {
    console.log(`  ${addr}  →  ${name}`);
  }
}
