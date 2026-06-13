// =============================================================================
// app/api/stats/route.ts  —  GET /api/stats
// =============================================================================
// Returns network-wide aggregate statistics over the full agent dataset.
// Used by the frontend viz for its network-activity display and headline KPIs.
//
// Response:
//   {
//     source,           — "live" | "fixtures"
//     computedAt,       — ISO-8601 timestamp from the snapshot
//     totalAgents,      — total registered agents in the dataset
//     ratedAgents,      — agents with at least one feedback event
//     withTokenURI,     — agents that have a non-null tokenURI
//     x402Count,        — agents flagged x402 (populated by enrich.mjs)
//     totalFeedback,    — sum of feedbackCount across all agents
//     topScore,         — highest reputationScore in the dataset
//     avgScore,         — mean reputationScore (all agents)
//     scoreDistribution — histogram: { "0-10": N, "10-20": N, ... "90-100": N }
//     activitySeries    — daily registration counts as [{date, count}] for viz
//   }
//
// Caching: keyed "stats"; TTL.STATS (5 min).
// =============================================================================
import { NextResponse } from 'next/server';
import { loadAgents } from '@/lib/data';
import { cache, TTL } from '@/lib/cache';
import type { AgentSummary } from '@/shared/schema';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a 10-bucket reputation score histogram (0-9, 10-19, ..., 90-100). */
function buildScoreDistribution(rows: AgentSummary[]): Record<string, number> {
  const buckets: Record<string, number> = {};
  for (let lo = 0; lo < 100; lo += 10) {
    const hi = lo + 10;
    const label = lo === 90 ? '90-100' : `${lo}-${lo + 10}`;
    buckets[label] = rows.filter(
      (a) => a.reputationScore >= lo && a.reputationScore < hi,
    ).length;
  }
  // Include exactly 100
  if (buckets['90-100'] !== undefined) {
    buckets['90-100'] += rows.filter((a) => a.reputationScore === 100).length;
    buckets['90-100'] -= rows.filter((a) => a.reputationScore >= 90 && a.reputationScore < 100 && a.reputationScore === 100).length;
  }
  return buckets;
}

/**
 * Build a daily registration time-series for the last 90 days.
 * Returns an array of { date: "YYYY-MM-DD", count: N } sorted ascending.
 */
function buildActivitySeries(rows: AgentSummary[]): Array<{ date: string; count: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffMs = cutoff.getTime();

  const dayCounts = new Map<string, number>();
  for (const a of rows) {
    const ts = new Date(a.registeredAt).getTime();
    if (ts < cutoffMs) continue;
    const date = a.registeredAt.slice(0, 10); // "YYYY-MM-DD"
    dayCounts.set(date, (dayCounts.get(date) ?? 0) + 1);
  }

  return Array.from(dayCounts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET() {
  const cacheKey = 'stats';
  const hit = cache.get<object>(cacheKey);
  if (hit) {
    return NextResponse.json(hit, { headers: { 'X-Cache': 'HIT' } });
  }

  const { rows, source, computedAt } = loadAgents();

  const totalAgents  = rows.length;
  const ratedAgents  = rows.filter((a) => a.feedbackCount > 0).length;
  const withTokenURI = rows.filter((a) => a.tokenURI != null).length;
  const x402Count    = rows.filter((a) => a.x402).length;
  const totalFeedback = rows.reduce((s, a) => s + a.feedbackCount, 0);
  const topScore     = rows.reduce((m, a) => Math.max(m, a.reputationScore), 0);
  const avgScore     = totalAgents > 0
    ? Math.round((rows.reduce((s, a) => s + a.reputationScore, 0) / totalAgents) * 100) / 100
    : 0;

  const result = {
    source,
    computedAt,
    totalAgents,
    ratedAgents,
    withTokenURI,
    x402Count,
    totalFeedback,
    topScore,
    avgScore,
    scoreDistribution: buildScoreDistribution(rows),
    activitySeries:    buildActivitySeries(rows),
  };

  cache.set(cacheKey, result, TTL.STATS);

  return NextResponse.json(result, { headers: { 'X-Cache': 'MISS' } });
}
