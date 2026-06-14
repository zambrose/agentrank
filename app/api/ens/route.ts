// =============================================================================
// app/api/ens/route.ts — live ENS lookup endpoint
// =============================================================================
// GET /api/ens?q=<ens-name|0x-address>
//
// Real on-chain resolution via viem (lib/ens). Accepts either direction:
//   - a 0x address  → reverse-resolves to the primary ENS name
//   - an ENS name   → forward-resolves to the address
// then reads a handful of ENS text records (incl. ENSIP-26 agent records).
//
// This is the demo-proof that ENS resolution is genuinely live: type any name
// (e.g. "vitalik.eth") and watch it resolve against mainnet. Requires outbound
// RPC egress (open on Cloud Run / Vercel; blocked in the build sandbox).
// =============================================================================
import { NextResponse } from "next/server";
import { lookupEns } from "@/lib/ens";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (!q.trim()) {
    return NextResponse.json({ error: "missing ?q=" }, { status: 400 });
  }
  const result = await lookupEns(q);
  return NextResponse.json(result);
}
