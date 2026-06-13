// =============================================================================
// lib/ens.ts — ENS reverse resolution stub
// =============================================================================
// This stub is replaced by the ens-docs agent with real viem-based resolution.
// Exports resolveENS(address) -> Promise<string | null>.
// =============================================================================

/**
 * Resolves an Ethereum address to its ENS primary name.
 * Returns null if no name is registered or resolution fails.
 * This stub always returns null; the ens-docs agent provides real resolution.
 */
export async function resolveENS(_address: string): Promise<string | null> {
  return null;
}

/**
 * Fetches ENS text records for a name (ENSIP-25/26 agent records).
 * Returns an empty object in the stub; ens-docs agent populates this.
 */
export async function getENSTextRecords(
  _name: string
): Promise<Record<string, string>> {
  return {};
}
