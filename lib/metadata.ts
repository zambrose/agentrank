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

/**
 * Parse an inline data: URI (RFC 2397) and return the decoded JSON object.
 * Returns null if the URI is not a data: URI or cannot be parsed.
 *
 * Supported forms:
 *   data:application/json;base64,<b64>
 *   data:application/json,<url-encoded-json>
 *   data:text/plain;base64,<b64>
 *   data:text/plain,<json-text>
 */
function parseDataURI(tokenURI: string): Record<string, unknown> | null {
  if (!tokenURI.startsWith('data:')) return null;
  try {
    const [header, ...rest] = tokenURI.slice(5).split(',');
    const body = rest.join(',');
    if (!body) return null;
    const isBase64 = header.endsWith(';base64');

    let text: string;
    if (isBase64) {
      text = Buffer.from(body, 'base64').toString('utf8');
    } else {
      text = decodeURIComponent(body);
    }
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// x402 detection
// ---------------------------------------------------------------------------

/**
 * Detect x402 payment support in a parsed ERC-8004 registration JSON.
 *
 * Strategy:
 *   1. Exact boolean fields: x402, x402support, paymentRequired → true only
 *      when the value is explicitly truthy (boolean true or "true" string).
 *   2. Presence-only fields: payment, paymentchannels, paymentschemes,
 *      paymentmethods, paymentendpoint, accepts, payto — if they exist and
 *      are non-empty, that signals payment support.
 *   3. String scan: any string value that contains "x402" → true (catches
 *      endpoint URLs like "https://example.com/x402/pay").
 *   4. Recursive up to depth 4 for nested objects and arrays.
 *
 * We deliberately check the VALUE for boolean fields to avoid false positives
 * from registrations that include "x402support: false".
 */
// Keys whose VALUE must be checked (truthy = support, falsy = no support).
const X402_BOOLEAN_KEYS = new Set([
  'x402', 'x402support', 'paymentrequired', 'payable',
]);
// Keys whose PRESENCE (non-null/non-empty value) signals payment support.
const X402_PRESENCE_KEYS = new Set([
  'payment', 'accepts', 'paymentchannels', 'paymentschemes',
  'paymentmethods', 'paymentendpoint', 'payto', 'lightning', 'invoice',
  'monetization',
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectX402(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;

  // String: look for "x402" in endpoints/URLs/descriptions.
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

      // Boolean gates: only true when the value itself is truthy.
      if (X402_BOOLEAN_KEYS.has(kl)) {
        if (v === true || v === 1 || v === 'true') return true;
        continue; // Explicit false — don't recurse into the value.
      }

      // Presence gates: any non-null, non-empty value is a signal.
      if (X402_PRESENCE_KEYS.has(kl)) {
        if (v !== null && v !== undefined && v !== '' &&
            !(Array.isArray(v) && v.length === 0)) return true;
        continue;
      }

      // Otherwise recurse.
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

  // 3a. data: URI — decode inline, no network call.
  if (tokenURI.startsWith('data:')) {
    const fetchedAt = new Date().toISOString();
    const raw = parseDataURI(tokenURI);
    const meta: AgentMetadata = {
      resolvedURI: tokenURI,
      raw,
      x402: raw ? detectX402(raw) : false,
      name:        extractString(raw, ['name', 'agentName', 'agent_name', 'title']),
      description: extractString(raw, ['description', 'summary', 'about']),
      fetchedAt,
      error: raw ? null : 'Failed to parse data: URI',
    };
    cache.set(memKey, meta, raw ? TTL.METADATA : TTL.METADATA_ERROR);
    setDiskEntry(tokenURI, meta);
    return meta;
  }

  // 3b. Network fetch (http/https/ipfs)
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
