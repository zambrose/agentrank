// =============================================================================
// app/api/agents/[id]/route.ts  —  GET /api/agents/[id]
// =============================================================================
// Returns a single agent by agentId (the ERC-721 tokenId / ERC-8004 agentId).
// Enriches the response with tokenURI metadata (name, description, raw JSON,
// x402 re-check) fetched on-demand from lib/metadata (cached separately).
//
// Path parameter:
//   id — numeric agentId (uint256, fits in JS number for current data)
//
// Response (200):
//   { source, computedAt, agent: AgentSummary & { metadata?: AgentMetadata } }
//
// Response (404):
//   { error: "Agent not found", agentId: <number> }
//
// Caching: keyed by "agent:<id>"; TTL.AGENT_DETAIL (5 min).
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { loadAgents } from '@/lib/data';
import { cache, TTL } from '@/lib/cache';
import { fetchMetadata } from '@/lib/metadata';

export const runtime = 'nodejs';

type RouteContext = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const rawId = params.id;
  const agentId = parseInt(rawId, 10);

  if (isNaN(agentId) || agentId < 0) {
    return NextResponse.json(
      { error: 'Invalid agentId — must be a non-negative integer', agentId: rawId },
      { status: 400 },
    );
  }

  const cacheKey = `agent:${agentId}`;
  const hit = cache.get<object>(cacheKey);
  if (hit) {
    return NextResponse.json(hit, { headers: { 'X-Cache': 'HIT' } });
  }

  const { rows, source, computedAt } = loadAgents();
  const agent = rows.find((a) => a.agentId === agentId);

  if (!agent) {
    return NextResponse.json(
      { error: 'Agent not found', agentId },
      { status: 404 },
    );
  }

  // Enrich with metadata (non-blocking: if this fails we still return the agent).
  let metadata = null;
  try {
    metadata = await fetchMetadata(agent.tokenURI);
  } catch {
    // metadata remains null; not fatal.
  }

  const result = {
    source,
    computedAt,
    agent: {
      ...agent,
      // If metadata confirmed x402 override the snapshot value (more up-to-date).
      ...(metadata?.x402 ? { x402: true } : {}),
      metadata,
    },
  };

  cache.set(cacheKey, result, TTL.AGENT_DETAIL);

  return NextResponse.json(result, { headers: { 'X-Cache': 'MISS' } });
}
