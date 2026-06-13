// =============================================================================
// app/api/stats/route.ts — GET /api/stats
// =============================================================================
import { NextResponse } from "next/server";
import { loadAgents } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { rows, source, computedAt } = loadAgents();
    const totalAgents = rows.length;
    const totalFeedback = rows.reduce((s, a) => s + a.feedbackCount, 0);
    const ratedAgents = rows.filter((a) => a.feedbackCount > 0).length;
    const x402Agents = rows.filter((a) => a.x402).length;
    const avgReputation =
      rows.reduce((s, a) => s + a.reputationScore, 0) / rows.length;

    return NextResponse.json({
      source,
      computedAt,
      totalAgents,
      totalFeedback,
      ratedAgents,
      x402Agents,
      avgReputation: Math.round(avgReputation * 100) / 100,
    });
  } catch (err) {
    console.error("/api/stats error:", err);
    return NextResponse.json(
      { error: "Failed to load stats" },
      { status: 500 }
    );
  }
}
