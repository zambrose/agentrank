// =============================================================================
// lib/metadata.ts  —  tokenURI metadata fetcher + x402 detection.
// =============================================================================
// Resolves a tokenURI to the ERC-8004 registration JSON, extracts agent
// metadata, and detects x402 payment support. Results are cached in two
// layers:
//   1. In-memory via lib/cache (fast, process-scoped, TTL.METADATA / METADATA_ERROR)
//   2. Persisted to data/metadata-cache.json (survives Next.js restarts)
//
// IPFS URIs are rewritten to use the public ipfs.io gateway. HTTP(S) URIs are
// fetched directly. All fetches have a 10-second timeout. Failures are cached
// at the shorter METADATA_ERROR TTL and return null.
//
// x402 detection: inspects the parsed JSON for any field that suggests
// HTTP 402 / x402 payment support — the ERC-8004 spec allows flexible shapes.
// We look for:
//   • top-level keys: "x402", "payment", "accepts", "paymentChannels",
//     "paymentSchemes", "paymentMethods", "paymentEndpoint"
//   • nested: capabilities.x402, services.payment, monetization.*
//   • Any string value containing "x402" (case-insensitive)
// =============================================================================
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cache, TTL } from '@/lib/cache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentMetadata {
  /** Resolved tokenURI (after IPFS gateway rewrite). */
  resolvedURI: string;
  /** Raw parsed JSON from the registration file, if fetch succeeded. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: Record<string, unknown> | null;
  /** Whether the registration file indicates x402 payment support. */
  x402: boolean;
  /** Human-readable agent name, if present in the registration file. */
  name: string | null;
  /** Short description, if present. */
  description: string | null;
  /** When this metadata was fetched (ISO-8601). */
  fetchedAt: string;
  /** Error message if fetch failed. */
  error: string | null;
}

// Persisted disk cache shape: { [tokenURI]: AgentMetadata }
type DiskCache = Record<string, AgentMetadata>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const IPFS_GATEWAY   = 'https://ipfs.io/ipfs/';
const FETCH_TIMEOUT  = 10_000; // ms
const DISK_CACHE_PATH = path.join(process.cwd(), 'data', 'metadata-cache.json');

// Cache key prefix for in-memory cache
const MEM_PREFIX = 'meta:';

// ---------------------------------------------------------------------------
// Disk cache helpers
// ---------------------------------------------------------------------------

let _diskCache: DiskCache | null = null;

function loadDiskCache(): DiskCache {
  if (_diskCache !== null) return _diskCache;
  try {
    if (existsSync(DISK_CACHE_PATH)) {
      _diskCache = JSON.parse(readFileSync(DISK_CACHE_PATH, 'utf8')) as DiskCache;
    } else {
      _diskCache = {};
    }
  } catch {
    _diskCache = {};
  }
  return _diskCache;
}

function saveDiskCache(): void {
  try {
    if (_diskCache) {
      writeFileSync(DISK_CACHE_PATH, JSON.stringify(_diskCache), 'utf8');
    }
  } catch {
    // Non-fatal: disk cache is best-effort.
  }
}

function getDiskEntry(tokenURI: string): AgentMetadata | null {
  const dc = loadDiskCache();
  return dc[tokenURI] ?? null;
}

function setDiskEntry(tokenURI: string, meta: AgentMetadata): void {
  const dc = loadDiskCache();
  dc[tokenURI] = meta;
  saveDiskCache();
}

// ---------------------------------------------------------------------------
// URI resolution
// ---------------------------------------------------------------------------

function resolveURI(tokenURI: string): string {
  if (tokenURI.startsWith('ipfs://')) {
    const cid = tokenURI.slice(7);
    return `${IPFS_GATEWAY}${cid}`;
  }
  return tokenURI;
}

// ---------------------------------------------------------------------------
// x402 detection
// ---------------------------------------------------------------------------

const X402_TOP_KEYS = new Set([
  'x402', 'payment', 'accepts', 'paymentchannels', 'paymentschemes',
  'paymentmethods', 'paymentendpoint', 'paymentrequired', 'monetization',
  'payto', 'lightning', 'invoice',
]);

/**
 * Walk a parsed JSON value recursively (up to depth 4) looking for any signal
 * of x402 / payment support. Returns true as soon as one signal is found.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectX402(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;

  if (typeof value === 'string') {
    return value.toLowerCase().includes('x402');
  }

  if (Array.isArray(value)) {
    return value.some((item) => detectX402(item, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const kl = k.toLowerCase();
      if (X402_TOP_KEYS.has(kl)) return true;
      if (kl.includes('x402') || kl.includes('payment')) return true;
      if (detectX402(v, depth + 1)) return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Fetch with timeout
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Core fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch and parse agent metadata for the given tokenURI.
 *
 * Cache hierarchy (in order of check):
 *   1. In-memory (lib/cache) — fastest
 *   2. Disk cache (data/metadata-cache.json) — survives restarts
 *   3. Network fetch — populates both caches
 *
 * On error: returns a stub with error set and x402: false.
 */
export async function fetchMetadata(tokenURI: string | null): Promise<AgentMetadata | null> {
  if (!tokenURI) return null;

  const memKey = MEM_PREFIX + tokenURI;

  // 1. In-memory cache
  const memHit = cache.get<AgentMetadata>(memKey);
  if (memHit) return memHit;

  // 2. Disk cache (warm memory from it)
  const diskHit = getDiskEntry(tokenURI);
  if (diskHit) {
    // Re-populate memory cache. We use TTL.METADATA for successful fetches,
    // METADATA_ERROR for error entries so they retry sooner.
    const ttl = diskHit.error ? TTL.METADATA_ERROR : TTL.METADATA;
    cache.set(memKey, diskHit, ttl);
    return diskHit;
  }

  // 3. Network fetch
  const resolvedURI = resolveURI(tokenURI);
  const fetchedAt = new Date().toISOString();

  let meta: AgentMetadata;
  try {
    const res = await fetchWithTimeout(resolvedURI, FETCH_TIMEOUT);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    let raw: Record<string, unknown> | null = null;

    if (contentType.includes('json') || resolvedURI.endsWith('.json')) {
      raw = (await res.json()) as Record<string, unknown>;
    } else {
      // Try to parse anyway — many IPFS nodes return text/plain.
      const text = await res.text();
      try { raw = JSON.parse(text); } catch { /* not JSON */ }
    }

    meta = {
      resolvedURI,
      raw,
      x402: raw ? detectX402(raw) : false,
      name:        extractString(raw, ['name', 'agentName', 'agent_name', 'title']),
      description: extractString(raw, ['description', 'summary', 'about']),
      fetchedAt,
      error: null,
    };

    cache.set(memKey, meta, TTL.METADATA);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    meta = {
      resolvedURI,
      raw: null,
      x402: false,
      name: null,
      description: null,
      fetchedAt,
      error: errorMsg,
    };
    cache.set(memKey, meta, TTL.METADATA_ERROR);
  }

  // Persist to disk regardless of success/failure.
  setDiskEntry(tokenURI, meta);

  return meta;
}

// ---------------------------------------------------------------------------
// Helper: extract a string value from a parsed object by candidate keys.
// ---------------------------------------------------------------------------

function extractString(
  obj: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!obj) return null;
  for (const k of keys) {
    if (typeof obj[k] === 'string' && (obj[k] as string).trim()) {
      return (obj[k] as string).trim();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Batch helper (used by scripts/enrich.mjs and the scheduled refresh).
// ---------------------------------------------------------------------------

export interface EnrichResult {
  agentId: number;
  tokenURI: string;
  x402: boolean;
  error: string | null;
}

/**
 * Fetch metadata for multiple tokenURIs with bounded concurrency.
 * Returns one EnrichResult per input, even if the fetch failed.
 */
export async function batchFetchMetadata(
  items: Array<{ agentId: number; tokenURI: string | null }>,
  concurrency = 5,
): Promise<EnrichResult[]> {
  const results: EnrichResult[] = [];
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const item = items[idx++];
      if (!item.tokenURI) {
        results.push({ agentId: item.agentId, tokenURI: '', x402: false, error: 'no tokenURI' });
        continue;
      }
      const meta = await fetchMetadata(item.tokenURI);
      results.push({
        agentId: item.agentId,
        tokenURI: item.tokenURI,
        x402: meta?.x402 ?? false,
        error: meta?.error ?? null,
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
