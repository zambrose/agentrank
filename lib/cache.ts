// =============================================================================
// lib/cache.ts — server-side in-memory cache with TTL.
// =============================================================================
// Thin wrapper so every API route and the metadata fetcher share one eviction
// mechanism. No external dependencies; pure Node.js Map + Date. Entries are
// keyed by an arbitrary string; values are typed via generics.
//
// A separate optional persist-to-disk path (data/metadata-cache.json) is
// offered for metadata entries so they survive a cold Next.js restart.
// =============================================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // epoch ms
}

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  /** Store a value with a TTL in seconds. */
  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  /** Return the value if present and not expired; otherwise undefined. */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  /** True if key exists and hasn't expired. */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Remove a single entry. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Remove all expired entries (call periodically to avoid leaks). */
  evictExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (now > v.expiresAt) this.store.delete(k);
    }
  }

  /** Number of live (non-expired) entries. */
  size(): number {
    this.evictExpired();
    return this.store.size;
  }
}

// Singleton shared across all imports in the same Node.js process.
export const cache = new MemoryCache();

// TTL constants (seconds)
export const TTL = {
  /** Ranked agent list — refreshed when materializer runs; 5-minute headroom. */
  AGENT_LIST: 5 * 60,
  /** Individual agent detail. */
  AGENT_DETAIL: 5 * 60,
  /** Aggregate stats. */
  STATS: 5 * 60,
  /** Metadata fetched from IPFS/tokenURI — long-lived, URIs are content-addressed. */
  METADATA: 60 * 60, // 1 hour
  /** Metadata fetch that failed — retry sooner. */
  METADATA_ERROR: 5 * 60,
} as const;
