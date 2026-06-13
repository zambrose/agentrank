// =============================================================================
// app/api/agents/[id]/route.ts — GET /api/agents/[id]
// =============================================================================
import { NextRequest, NextResponse } from "next/server";
import { loadAgents } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { rows, source, computedAt } = loadAgents();
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
    }
    const agent = rows.find((a) => a.agentId === id);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    return NextResponse.json({ source, computedAt, agent });
  } catch (err) {
    console.error("/api/agents/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to load agent" },
      { status: 500 }
    );
  }
}
