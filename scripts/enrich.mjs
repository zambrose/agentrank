#!/usr/bin/env node
// =============================================================================
// scripts/enrich.mjs  —  Populate x402 flags in data/agent_summary.json
// =============================================================================
// Fetches tokenURI metadata for the top ~200 ranked agents, detects x402
// payment support, and writes the results back into both:
//   • data/agent_summary.json  (in-place x402 field update)
//   • data/metadata-cache.json (persistent metadata cache for API)
//
// Usage:
//   node scripts/enrich.mjs [--top N] [--concurrency N]
//   node scripts/enrich.mjs --top 200 --concurrency 5
//
// Defaults: top 200 agents, concurrency 5, 10-second per-request timeout.
// Skips agents with no tokenURI. Treats errors as non-fatal (x402 stays false).
// Be polite: small concurrency, no retry storms.
// =============================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SNAPSHOT_FILE     = path.join(ROOT, 'data', 'agent_summary.json');
const DISK_CACHE_FILE   = path.join(ROOT, 'data', 'metadata-cache.json');
const IPFS_GATEWAY      = 'https://ipfs.io/ipfs/';
const FETCH_TIMEOUT_MS  = 10_000;

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
let TOP         = 200;
let CONCURRENCY = 5;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--top'         && argv[i + 1]) TOP         = parseInt(argv[++i], 10);
  if (argv[i] === '--concurrency' && argv[i + 1]) CONCURRENCY = parseInt(argv[++i], 10);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function resolveURI(tokenURI) {
  if (tokenURI.startsWith('ipfs://')) {
    return IPFS_GATEWAY + tokenURI.slice(7);
  }
  return tokenURI;
}

/**
 * Parse an inline data: URI (RFC 2397) → JSON object or null.
 * Supports data:...;base64,<b64> and data:...,<url-encoded>.
 */
function parseDataURI(tokenURI) {
  if (!tokenURI.startsWith('data:')) return null;
  try {
    const commaIdx = tokenURI.indexOf(',');
    if (commaIdx === -1) return null;
    const header = tokenURI.slice(5, commaIdx);
    const body   = tokenURI.slice(commaIdx + 1);
    const isBase64 = header.endsWith(';base64');
    const text = isBase64
      ? Buffer.from(body, 'base64').toString('utf8')
      : decodeURIComponent(body);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Boolean keys: check the VALUE (truthy = x402 support).
const X402_BOOLEAN_KEYS = new Set([
  'x402', 'x402support', 'paymentrequired', 'payable',
]);
// Presence keys: non-empty value is sufficient signal.
const X402_PRESENCE_KEYS = new Set([
  'payment', 'accepts', 'paymentchannels', 'paymentschemes',
  'paymentmethods', 'paymentendpoint', 'payto', 'lightning', 'invoice',
  'monetization',
]);

function detectX402(value, depth = 0) {
  if (depth > 4) return false;
  if (typeof value === 'string') return value.toLowerCase().includes('x402');
  if (Array.isArray(value)) return value.some((v) => detectX402(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const kl = k.toLowerCase();
      if (X402_BOOLEAN_KEYS.has(kl)) {
        if (v === true || v === 1 || v === 'true') return true;
        continue; // explicit false — skip
      }
      if (X402_PRESENCE_KEYS.has(kl)) {
        if (v !== null && v !== undefined && v !== '' &&
            !(Array.isArray(v) && v.length === 0)) return true;
        continue;
      }
      if (detectX402(v, depth + 1)) return true;
    }
  }
  return false;
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMetadata(tokenURI) {
  // Handle data: URIs inline — no network call.
  if (tokenURI.startsWith('data:')) {
    const raw = parseDataURI(tokenURI);
    return { resolvedURI: tokenURI, raw, x402: raw ? detectX402(raw) : false, error: raw ? null : 'Failed to parse data: URI' };
  }

  const resolvedURI = resolveURI(tokenURI);
  try {
    const res = await fetchWithTimeout(resolvedURI, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const ct = res.headers.get('content-type') ?? '';
    let raw = null;
    if (ct.includes('json') || resolvedURI.endsWith('.json')) {
      raw = await res.json();
    } else {
      const text = await res.text();
      try { raw = JSON.parse(text); } catch { /* not JSON */ }
    }

    return { resolvedURI, raw, x402: raw ? detectX402(raw) : false, error: null };
  } catch (err) {
    return { resolvedURI, raw: null, x402: false, error: err.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Load existing snapshot.
  if (!existsSync(SNAPSHOT_FILE)) {
    console.error(`[enrich] ERROR: ${SNAPSHOT_FILE} not found. Run npm run materialize first.`);
    process.exit(1);
  }
  const agents = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'));
  console.log(`[enrich] Loaded ${agents.length} agents.`);

  // Load existing metadata cache.
  let diskCache = {};
  if (existsSync(DISK_CACHE_FILE)) {
    try { diskCache = JSON.parse(readFileSync(DISK_CACHE_FILE, 'utf8')); } catch { /* ignore */ }
  }

  // Select top N with tokenURI.
  const targets = agents
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .slice(0, TOP)
    .filter((a) => a.tokenURI);

  console.log(`[enrich] Fetching metadata for ${targets.length} of top ${TOP} agents (concurrency=${CONCURRENCY}) …`);

  let done = 0, x402Found = 0, errors = 0;
  const start = Date.now();

  // Work queue with bounded concurrency.
  const queue = [...targets];
  const results = new Map(); // agentId → { x402, error }

  async function worker() {
    while (queue.length > 0) {
      const agent = queue.shift();
      if (!agent) break;

      // Check disk cache first.
      if (diskCache[agent.tokenURI]) {
        const cached = diskCache[agent.tokenURI];
        results.set(agent.agentId, { x402: cached.x402, error: cached.error });
        if (cached.x402) x402Found++;
        done++;
        if (done % 20 === 0) {
          console.log(`[enrich] ${done}/${targets.length} (${Math.round(done/targets.length*100)}%) — ${fmtDuration(Date.now()-start)} elapsed`);
        }
        continue;
      }

      const meta = await fetchMetadata(agent.tokenURI);
      const fetchedAt = new Date().toISOString();

      // Persist to disk cache.
      diskCache[agent.tokenURI] = {
        resolvedURI: meta.resolvedURI,
        raw: meta.raw,
        x402: meta.x402,
        name: meta.raw ? (meta.raw.name ?? meta.raw.agentName ?? null) : null,
        description: meta.raw ? (meta.raw.description ?? meta.raw.summary ?? null) : null,
        fetchedAt,
        error: meta.error,
      };

      results.set(agent.agentId, { x402: meta.x402, error: meta.error });
      if (meta.x402) x402Found++;
      if (meta.error) errors++;
      done++;

      if (done % 20 === 0 || meta.x402) {
        const status = meta.x402 ? ' [x402!]' : meta.error ? ` [err: ${meta.error.slice(0,40)}]` : '';
        console.log(`[enrich] ${done}/${targets.length} agent=${agent.agentId}${status}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Update x402 flags in the agents array.
  let updated = 0;
  for (const agent of agents) {
    const r = results.get(agent.agentId);
    if (r != null && r.x402 !== agent.x402) {
      agent.x402 = r.x402;
      updated++;
    }
  }

  // Write updated snapshot.
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(agents), 'utf8');
  console.log(`[enrich] Updated ${updated} x402 flags in ${SNAPSHOT_FILE}`);

  // Write updated metadata cache.
  writeFileSync(DISK_CACHE_FILE, JSON.stringify(diskCache, null, 2), 'utf8');
  console.log(`[enrich] Wrote ${Object.keys(diskCache).length} entries to ${DISK_CACHE_FILE}`);

  const elapsed = Date.now() - start;
  console.log(`[enrich] Done in ${fmtDuration(elapsed)}. x402 found: ${x402Found}, errors: ${errors}.`);
}

main().catch((err) => {
  console.error('[enrich] FATAL:', err.message ?? err);
  process.exit(1);
});
