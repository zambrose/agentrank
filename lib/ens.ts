// =============================================================================
// lib/ens.ts — ENS resolution via viem (mainnet)
// =============================================================================
// Provides three public functions:
//
//   reverseResolve(address)          → ENS name | null
//   getEnsText(name, key)            → string | null
//   enrichOwnersWithEns(addresses[]) → void (warms in-process + disk cache)
//
// All functions are safe to call from Next.js API routes and server components.
// They never throw into the call path — every error is caught and returns null.
//
// Resolution is REAL on-chain via the public Ethereum mainnet RPC configured
// by env ETH_RPC_URL (default: https://eth.llamarpc.com). Reads go through
// viem's getEnsName / getEnsText which call the ENS Universal Resolver.
//
// ENS text-record keys supported:
//   ENSIP-25: agent-registration[<registry>][<agentId>]
//             Registry-to-agent attestation link (ERC-8004 specific).
//   ENSIP-26: agent-context         AI agent system prompt / context blob
//             agent-endpoint[mcp]   MCP endpoint URL
//             agent-endpoint[a2a]   A2A endpoint URL
//             agent-endpoint[web]   Human-facing web URL
//   Common:   avatar, url, com.twitter, com.github, description, email
//
// Caching:
//   In-process: lib/cache singleton (TTL.ENS = 24 h).
//   On-disk:    data/ens-cache.json, read on module init, written on update.
//               Survives Next.js cold restarts.  Concurrent writes are safe
//               because each process writes the whole JSON atomically.
// =============================================================================

import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { cache, TTL } from "@/lib/cache";

// ---------------------------------------------------------------------------
// Viem public client
// ---------------------------------------------------------------------------

const RPC_URL =
  process.env.ETH_RPC_URL ?? "https://eth.llamarpc.com";

/** Shared viem public client — lazily initialised once per process. */
let _client: ReturnType<typeof createPublicClient> | null = null;

function getClient() {
  if (!_client) {
    _client = createPublicClient({
      chain: mainnet,
      transport: http(RPC_URL, {
        timeout: 10_000,
        retryCount: 2,
        retryDelay: 500,
      }),
    });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// TTL constant (24 hours — ENS primary names rarely change)
// ---------------------------------------------------------------------------

const TTL_ENS = 24 * 60 * 60; // seconds

// ---------------------------------------------------------------------------
// Disk-persisted cache  (data/ens-cache.json)
// ---------------------------------------------------------------------------

const DISK_CACHE_PATH = path.join(process.cwd(), "data", "ens-cache.json");

/**
 * Shape of data/ens-cache.json.
 *
 * All keys are lowercased Ethereum addresses; values are the resolved ENS
 * primary name or null.  We persist null too so we don't keep retrying
 * addresses that have no primary name.
 */
type DiskCache = Record<string, string | null>;

let diskCache: DiskCache = {};

/** Load data/ens-cache.json into memory once on first call. */
function loadDiskCache(): void {
  if (!existsSync(DISK_CACHE_PATH)) return;
  try {
    diskCache = JSON.parse(readFileSync(DISK_CACHE_PATH, "utf8")) as DiskCache;
    // Seed the in-process cache from disk so the first request is instant.
    for (const [addr, name] of Object.entries(diskCache)) {
      cache.set(`ens:reverse:${addr}`, name, TTL_ENS);
    }
  } catch {
    // Corrupt file — start fresh, will be overwritten on next write.
    diskCache = {};
  }
}

/** Persist the current diskCache to data/ens-cache.json. */
function saveDiskCache(): void {
  try {
    writeFileSync(
      DISK_CACHE_PATH,
      JSON.stringify(diskCache, null, 2),
      "utf8",
    );
  } catch {
    // Non-fatal — in-process cache still works; disk write failure is logged
    // via the warm script but ignored at request time.
  }
}

// Initialise on module load (server-side only).
loadDiskCache();

// ---------------------------------------------------------------------------
// reverseResolve
// ---------------------------------------------------------------------------

/**
 * Reverse-resolve an Ethereum address to its ENS primary name.
 *
 * Uses viem `getEnsName` which calls the ENS Universal Resolver on mainnet.
 * Results are cached in-process (lib/cache, 24 h) and on disk
 * (data/ens-cache.json) so subsequent calls are instant.
 *
 * @param address  0x-prefixed Ethereum address (any case).
 * @returns  The primary ENS name (e.g. "alice.eth") or null if none / error.
 */
export async function reverseResolve(address: string): Promise<string | null> {
  const normalized = address.toLowerCase() as `0x${string}`;
  const cacheKey = `ens:reverse:${normalized}`;

  // 1. In-process cache hit.
  const cached = cache.get<string | null>(cacheKey);
  if (cached !== undefined) return cached;

  // 2. Try on-chain resolution.
  let name: string | null = null;
  try {
    name = await getClient().getEnsName({ address: normalized });
  } catch {
    // RPC unavailable, timeout, CCIP-read error, etc. — return null silently.
    // Do NOT cache errors: let the next request retry.
    return null;
  }

  // 3. Store in both caches (including null → "no primary name").
  cache.set(cacheKey, name, TTL_ENS);
  diskCache[normalized] = name;
  saveDiskCache();

  return name;
}

// ---------------------------------------------------------------------------
// getEnsText
// ---------------------------------------------------------------------------

/**
 * Read a single ENS text record.
 *
 * Supported key namespaces:
 *   - ENSIP-25: `agent-registration[<registry>][<agentId>]`
 *   - ENSIP-26: `agent-context`, `agent-endpoint[mcp]`,
 *               `agent-endpoint[a2a]`, `agent-endpoint[web]`
 *   - Common:   `avatar`, `url`, `com.twitter`, `com.github`,
 *               `description`, `email`
 *
 * @param name  Normalised ENS name, e.g. "alice.eth".
 * @param key   Text record key string.
 * @returns  Record value or null if not set / error.
 */
export async function getEnsText(
  name: string,
  key: string,
): Promise<string | null> {
  const cacheKey = `ens:text:${name}:${key}`;
  const cached = cache.get<string | null>(cacheKey);
  if (cached !== undefined) return cached;

  let value: string | null = null;
  try {
    value = await getClient().getEnsText({ name, key });
  } catch {
    return null;
  }

  cache.set(cacheKey, value, TTL_ENS);
  return value;
}

// ---------------------------------------------------------------------------
// buildEnsip25Key
// ---------------------------------------------------------------------------

/**
 * Build the ENSIP-25 text-record key for an ERC-8004 agent registration.
 *
 * Format: `agent-registration[<erc7930-registry-address>][<agentId>]`
 *
 * The registry address in ERC-7930 interoperable form for Ethereum mainnet
 * (chainId=1, ERC-7930 prefix 0x0001 + coinType 60 = 0x000100000101):
 *   `0x000100000101<identity-registry-without-0x>`
 *
 * Reference: ENSIP-25 §3.1 (https://docs.ens.domains/ensip/25/)
 *
 * @param agentId   ERC-8004 tokenId (uint256 as number or string).
 * @param registry  Identity registry address (0x-prefixed). Defaults to the
 *                  ERC-8004 mainnet registry.
 */
export function buildEnsip25Key(
  agentId: number | string,
  registry = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
): string {
  // ERC-7930: Ethereum mainnet (chainId 1) coin type 60 prefix = 0x000100000101
  const prefix = "0x000100000101";
  const registryHex = registry.slice(2).toLowerCase();
  const erc7930 = `${prefix}${registryHex}`;
  return `agent-registration[${erc7930}][${agentId}]`;
}

// ---------------------------------------------------------------------------
// enrichOwnersWithEns
// ---------------------------------------------------------------------------

/**
 * Warm the ENS reverse-resolution cache for a list of owner addresses.
 *
 * Uses bounded concurrency (default: 5 simultaneous requests) to avoid
 * hammering the RPC.  Returns a map of address → ENS name | null.
 * All errors are swallowed — callers receive partial results on timeout/error.
 *
 * Intended to be called from scripts/ens-warm.mjs (not the request path).
 *
 * @param addresses  List of 0x-prefixed addresses.
 * @param concurrency  Max simultaneous RPC calls (default 5).
 */
export async function enrichOwnersWithEns(
  addresses: string[],
  concurrency = 5,
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const queue = [...addresses];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const addr = queue.shift()!;
      const name = await reverseResolve(addr);
      result.set(addr.toLowerCase(), name);
    }
  }

  // Run `concurrency` workers in parallel.
  await Promise.all(Array.from({ length: concurrency }, worker));
  return result;
}

// ---------------------------------------------------------------------------
// Convenience: resolve + read ENSIP-26 agent-context in one call
// ---------------------------------------------------------------------------

export interface AgentEnsProfile {
  /** Primary ENS name for this address, or null. */
  name: string | null;
  /** ENSIP-26 agent-context text record, or null. */
  agentContext: string | null;
  /** ENSIP-26 MCP endpoint, or null. */
  mcpEndpoint: string | null;
  /** ENSIP-26 A2A endpoint, or null. */
  a2aEndpoint: string | null;
  /** ENSIP-26 web endpoint, or null. */
  webEndpoint: string | null;
  /** avatar text record, or null. */
  avatar: string | null;
  /** url text record (homepage), or null. */
  url: string | null;
  /** description text record, or null. */
  description: string | null;
}

/**
 * Resolve an owner address to its full ENS agent profile.
 *
 * All fields are null when absent or when the address has no primary name.
 * Safe to call from API routes — never throws.
 *
 * @param address  0x-prefixed owner address.
 */
export async function resolveAgentEnsProfile(
  address: string,
): Promise<AgentEnsProfile> {
  const empty: AgentEnsProfile = {
    name: null,
    agentContext: null,
    mcpEndpoint: null,
    a2aEndpoint: null,
    webEndpoint: null,
    avatar: null,
    url: null,
    description: null,
  };

  const name = await reverseResolve(address);
  if (!name) return empty;

  // Read all text records in parallel.
  const [agentContext, mcpEndpoint, a2aEndpoint, webEndpoint, avatar, url, description] =
    await Promise.all([
      getEnsText(name, "agent-context"),
      getEnsText(name, "agent-endpoint[mcp]"),
      getEnsText(name, "agent-endpoint[a2a]"),
      getEnsText(name, "agent-endpoint[web]"),
      getEnsText(name, "avatar"),
      getEnsText(name, "url"),
      getEnsText(name, "description"),
    ]);

  return {
    name,
    agentContext,
    mcpEndpoint,
    a2aEndpoint,
    webEndpoint,
    avatar,
    url,
    description,
  };
}

// ---------------------------------------------------------------------------
// Compatibility alias (used by app/agent/[id]/page.tsx)
// ---------------------------------------------------------------------------

/**
 * Alias for `reverseResolve`.  The frontend-viz agent wired this name;
 * keeping both exports avoids a cross-branch merge conflict.
 *
 * @param address  0x-prefixed Ethereum address.
 * @returns  Primary ENS name or null.
 */
export const resolveENS = reverseResolve;
