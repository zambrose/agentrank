// =============================================================================
// app/api/agents/route.ts  —  GET /api/agents
// =============================================================================
// Returns a ranked, filterable, searchable list of ERC-8004 agents.
//
// Query parameters:
//   q       — substring search against agentId (string), ownerAddress, tokenURI
//   x402    — "true" → only agents with x402 payment support
//   rated   — "true" → only agents with feedbackCount > 0
//   sort    — "rank" (default) | "reputation" | "feedback" | "recent"
//   limit   — max rows to return (default 50, max 200)
//   offset  — skip N rows (default 0, for pagination)
//
// Response:
//   { source, computedAt, total, count, agents: AgentSummary[] }
//
// Caching: keyed by full querystring; TTL.AGENT_LIST (5 min).
// Never queries BigQuery at request time — reads from loadAgents() snapshot.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { loadAgents } from '@/lib/data';
import { cache, TTL } from '@/lib/cache';
import type { AgentSummary } from '@/shared/schema';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

type SortKey = 'rank' | 'reputation' | 'feedback' | 'recent';

function sortAgents(agents: AgentSummary[], sort: SortKey): AgentSummary[] {
  const sorted = [...agents];
  switch (sort) {
    case 'reputation':
      sorted.sort((a, b) => b.reputationScore - a.reputationScore
        || b.feedbackCount - a.feedbackCount
        || a.rank - b.rank);
      break;
    case 'feedback':
      sorted.sort((a, b) => b.feedbackCount - a.feedbackCount
        || b.reputationScore - a.reputationScore
        || a.rank - b.rank);
      break;
    case 'recent':
      sorted.sort((a, b) => {
        const ta = new Date(a.lastActivityAt).getTime();
        const tb = new Date(b.lastActivityAt).getTime();
        return tb - ta || a.rank - b.rank;
      });
      break;
    case 'rank':
    default:
      sorted.sort((a, b) => a.rank - b.rank);
      break;
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const cacheKey = `agents:${req.nextUrl.search}`;

  // Check in-memory cache first.
  const hit = cache.get<ReturnType<typeof buildResponse>>(cacheKey);
  if (hit) {
    return NextResponse.json(hit, { headers: { 'X-Cache': 'HIT' } });
  }

  // Parse query params.
  const sp = req.nextUrl.searchParams;
  const q      = sp.get('q')?.trim().toLowerCase() ?? '';
  const x402   = sp.get('x402') === 'true';
  const rated  = sp.get('rated') === 'true';
  const sort   = (sp.get('sort') ?? 'rank') as SortKey;
  const limit  = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50));
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0);

  const { rows, source, computedAt } = loadAgents();

  // Apply filters.
  let filtered = rows;
  if (x402)   filtered = filtered.filter((a) => a.x402);
  if (rated)  filtered = filtered.filter((a) => a.feedbackCount > 0);
  if (q) {
    filtered = filtered.filter(
      (a) =>
        String(a.agentId).includes(q) ||
        a.ownerAddress.toLowerCase().includes(q) ||
        (a.tokenURI?.toLowerCase().includes(q) ?? false),
    );
  }

  // Apply sort.
  const validSorts: SortKey[] = ['rank', 'reputation', 'feedback', 'recent'];
  const appliedSort: SortKey = validSorts.includes(sort) ? sort : 'rank';
  const sorted = sortAgents(filtered, appliedSort);

  // Paginate.
  const page   = sorted.slice(offset, offset + limit);
  const result = buildResponse(source, computedAt, sorted.length, page);

  cache.set(cacheKey, result, TTL.AGENT_LIST);

  return NextResponse.json(result, { headers: { 'X-Cache': 'MISS' } });
}

function buildResponse(
  source: 'live' | 'fixtures',
  computedAt: string | null,
  total: number,
  agents: AgentSummary[],
) {
  return { source, computedAt, total, count: agents.length, agents };
}
