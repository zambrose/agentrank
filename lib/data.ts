// =============================================================================
// lib/data.ts — single source of truth for ranked agent rows (server-side).
// =============================================================================
// Returns AgentSummary rows from the materialized snapshot if present
// (data/agent_summary.json, written by scripts/materialize.mjs from BigQuery),
// otherwise falls back to the committed real fixtures. This lets the whole app
// build/run before billing is enabled, then flip to live data with zero code
// changes — the snapshot file simply appears.
// =============================================================================
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { AgentSummary } from "@/shared/schema";

const SNAPSHOT = path.join(process.cwd(), "data", "agent_summary.json");
const FIXTURES = path.join(process.cwd(), "shared", "fixtures", "agents.json");

export interface DataSource {
  rows: AgentSummary[];
  /** "live" = materialized BigQuery snapshot, "fixtures" = committed sample. */
  source: "live" | "fixtures";
  /** ISO time the underlying data was computed (computedAt of row 0), if any. */
  computedAt: string | null;
}

let cache: DataSource | null = null;

export function loadAgents(): DataSource {
  if (cache) return cache;
  const useLive = existsSync(SNAPSHOT);
  const file = useLive ? SNAPSHOT : FIXTURES;
  const rows = JSON.parse(readFileSync(file, "utf8")) as AgentSummary[];
  cache = {
    rows,
    source: useLive ? "live" : "fixtures",
    computedAt: rows[0]?.computedAt ?? null,
  };
  return cache;
}

/** Test/refresh hook — clears the in-process cache so the next load re-reads. */
export function _resetDataCache(): void {
  cache = null;
}
