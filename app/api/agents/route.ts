// =============================================================================
// app/api/agents/route.ts — GET /api/agents
// =============================================================================
// Query params:
//   q       — substring search on agentId, ownerAddress, tokenURI
//   x402    — "true" to filter to x402-payable agents only
//   rated   — "true" to filter to agents with at least one feedback event
//   sort    — "rank" | "reputation" | "feedback" | "recency" (default: rank)
//   limit   — max rows to return (default 50, max 200)
//   offset  — pagination offset (default 0)
// =============================================================================
import { NextRequest, NextResponse } from "next/server";
import { loadAgents } from "@/lib/data";
import type { AgentSummary } from "@/shared/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SortKey = "rank" | "reputation" | "feedback" | "recency";

function applySort(rows: AgentSummary[], sort: SortKey): AgentSummary[] {
  const copy = [...rows];
  switch (sort) {
    case "reputation":
      copy.sort((a, b) => b.reputationScore - a.reputationScore);
      break;
    case "feedback":
      copy.sort((a, b) => b.feedbackCount - a.feedbackCount);
      break;
    case "recency":
      copy.sort(
        (a, b) =>
          new Date(b.lastActivityAt).getTime() -
          new Date(a.lastActivityAt).getTime()
      );
      break;
    case "rank":
    default:
      copy.sort((a, b) => a.rank - b.rank);
      break;
  }
  return copy;
}

export async function GET(req: NextRequest) {
  try {
    const { rows, source, computedAt } = loadAgents();
    const sp = req.nextUrl.searchParams;

    const q = sp.get("q")?.toLowerCase().trim() ?? "";
    const x402 = sp.get("x402") === "true";
    const rated = sp.get("rated") === "true";
    const sort = (sp.get("sort") ?? "rank") as SortKey;
    const limit = Math.min(parseInt(sp.get("limit") ?? "50", 10), 200);
    const offset = Math.max(parseInt(sp.get("offset") ?? "0", 10), 0);

    let filtered = rows;

    if (q) {
      filtered = filtered.filter(
        (a) =>
          String(a.agentId).includes(q) ||
          a.ownerAddress.toLowerCase().includes(q) ||
          (a.tokenURI ?? "").toLowerCase().includes(q)
      );
    }
    if (x402) {
      filtered = filtered.filter((a) => a.x402);
    }
    if (rated) {
      filtered = filtered.filter((a) => a.feedbackCount > 0);
    }

    const sorted = applySort(filtered, sort);
    const total = sorted.length;
    const page = sorted.slice(offset, offset + limit);

    return NextResponse.json({
      source,
      computedAt,
      total,
      count: page.length,
      agents: page,
    });
  } catch (err) {
    console.error("/api/agents error:", err);
    return NextResponse.json(
      { error: "Failed to load agents" },
      { status: 500 }
    );
  }
}
