// =============================================================================
// app/page.tsx — AgentRank home: ranked list + Reputation Flow visualization
// =============================================================================
import dynamic from "next/dynamic";
import { loadAgents } from "@/lib/data";
import AgentList from "@/components/AgentList";
import type { AgentSummary } from "@/shared/schema";

// p5.js visualization — client-only, no SSR
const ReputationFlow = dynamic(() => import("@/components/ReputationFlow"), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center rounded-lg border border-slate-800 bg-panel text-slate-500 text-sm"
      style={{ height: 420 }}
    >
      loading visualization…
    </div>
  ),
});

function computeStats(rows: AgentSummary[]) {
  const totalFeedback = rows.reduce((s, a) => s + a.feedbackCount, 0);
  const ratedAgents = rows.filter((a) => a.feedbackCount > 0).length;
  const x402Agents = rows.filter((a) => a.x402).length;
  return { totalFeedback, ratedAgents, x402Agents };
}

export default function Home() {
  const { rows, source, computedAt } = loadAgents();

  // Default view: top 50 by rank
  const initialAgents = rows.slice(0, 50);
  const { totalFeedback, ratedAgents, x402Agents } = computeStats(rows);

  return (
    <main className="min-h-screen" style={{ background: "#0a0e17" }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-accent tracking-tight">
              AgentRank
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              ERC-8004 Agent Economy Explorer · Ethereum mainnet
            </p>
          </div>
          <div className="flex gap-6 text-right">
            <div>
              <div className="text-lg font-bold text-slate-200 tabular-nums">
                {rows.length.toLocaleString()}
              </div>
              <div className="text-xs text-slate-500">agents registered</div>
            </div>
            <div>
              <div className="text-lg font-bold text-slate-200 tabular-nums">
                {totalFeedback.toLocaleString()}
              </div>
              <div className="text-xs text-slate-500">feedback events</div>
            </div>
            <div>
              <div className="text-lg font-bold text-slate-200 tabular-nums">
                {ratedAgents.toLocaleString()}
              </div>
              <div className="text-xs text-slate-500">rated agents</div>
            </div>
            {x402Agents > 0 && (
              <div>
                <div className="text-lg font-bold text-accent tabular-nums">
                  {x402Agents.toLocaleString()}
                </div>
                <div className="text-xs text-slate-500">x402-payable</div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-6 space-y-8">
        {/* ── Visualization ──────────────────────────────────────── */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Reputation Flow
            </h2>
            <span className="text-xs text-slate-600">
              force-directed · real reputation scores · positions synthetic
            </span>
          </div>
          <div className="rounded-xl border border-slate-800 overflow-hidden" style={{ background: "#080c14" }}>
            <ReputationFlow agents={rows} width={900} height={420} />
          </div>
          <p className="mt-1.5 text-xs text-slate-600">
            Each node is a registered ERC-8004 agent. Color encodes reputation:
            <span className="text-accent"> blue = high</span>,
            <span className="text-warn"> amber = neutral</span>,
            <span className="text-bad"> red = low</span>.
            Size scales with feedback volume. Glowing sparks = active in the last 7 days.
          </p>
        </section>

        {/* ── Ranked list ────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Ranked Agents
          </h2>
          <AgentList
            initialAgents={initialAgents}
            initialTotal={rows.length}
            source={source}
            computedAt={computedAt}
          />
        </section>
      </div>
    </main>
  );
}
