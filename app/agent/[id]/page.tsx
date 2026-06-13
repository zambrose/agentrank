// =============================================================================
// app/agent/[id]/page.tsx — Agent detail page
// =============================================================================
import { notFound } from "next/navigation";
import Link from "next/link";
import { loadAgents } from "@/lib/data";
import { resolveENS } from "@/lib/ens";
import type { AgentSummary } from "@/shared/schema";

interface Props {
  params: { id: string };
}

function StatBlock({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-panel px-4 py-3">
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-lg font-bold text-slate-200">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function ScoreBarWide({ breakdown }: { breakdown: AgentSummary["scoreBreakdown"] }) {
  const total = breakdown.positive + breakdown.neutral + breakdown.negative;
  if (total === 0) {
    return (
      <div className="text-slate-500 text-sm">No feedback recorded</div>
    );
  }
  const pct = (n: number) => Math.round((n / total) * 100);
  return (
    <div className="space-y-2">
      <div className="flex h-3 overflow-hidden rounded-full border border-slate-800">
        {breakdown.positive > 0 && (
          <div className="bg-good" style={{ width: pct(breakdown.positive) + "%" }} />
        )}
        {breakdown.neutral > 0 && (
          <div className="bg-warn" style={{ width: pct(breakdown.neutral) + "%" }} />
        )}
        {breakdown.negative > 0 && (
          <div className="bg-bad" style={{ width: pct(breakdown.negative) + "%" }} />
        )}
      </div>
      <div className="flex gap-4 text-xs">
        <span className="text-good">{breakdown.positive} positive ({pct(breakdown.positive)}%)</span>
        <span className="text-warn">{breakdown.neutral} neutral ({pct(breakdown.neutral)}%)</span>
        <span className="text-bad">{breakdown.negative} negative ({pct(breakdown.negative)}%)</span>
      </div>
    </div>
  );
}

function reputationColor(score: number): string {
  if (score >= 70) return "text-good";
  if (score >= 40) return "text-warn";
  return "text-bad";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function truncTx(tx: string): string {
  return tx.slice(0, 10) + "…" + tx.slice(-8);
}

export default async function AgentDetailPage({ params }: Props) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) notFound();

  const { rows, source, computedAt } = loadAgents();
  const agent = rows.find((a) => a.agentId === id);
  if (!agent) notFound();

  // ENS resolution — stub returns null until ens-docs agent ships real resolution
  let ensName: string | null = null;
  try {
    ensName = await resolveENS(agent.ownerAddress);
  } catch {
    // swallow — not critical
  }

  const computedAtStr = computedAt
    ? new Date(computedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
    : null;

  return (
    <main className="min-h-screen" style={{ background: "#0a0e17" }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="mx-auto max-w-4xl flex items-center gap-4">
          <Link
            href="/"
            className="text-xs text-slate-500 hover:text-accent transition-colors"
          >
            ← AgentRank
          </Link>
          <span className="text-slate-700">/</span>
          <span className="text-sm text-slate-400">Agent #{agent.agentId}</span>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        {/* ── Title ──────────────────────────────────────────────── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-200">
              Agent{" "}
              <span className="text-accent">#{agent.agentId}</span>
            </h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-400">
              <span>Rank</span>
              <span className="font-bold text-slate-200">#{agent.rank}</span>
              {agent.x402 && (
                <span className="rounded bg-accent/20 px-1.5 py-0.5 text-xs text-accent font-medium">
                  x402-payable
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${
                  source === "live"
                    ? "bg-good/10 text-good"
                    : "bg-warn/10 text-warn"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current inline-block" />
                {source}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-4xl font-bold tabular-nums ${reputationColor(agent.reputationScore)}`}>
              {agent.reputationScore.toFixed(1)}
            </div>
            <div className="text-xs text-slate-500 mt-1">reputation score</div>
          </div>
        </div>

        {/* ── Stats grid ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatBlock
            label="Feedback Events"
            value={agent.feedbackCount.toLocaleString()}
          />
          <StatBlock
            label="Unique Clients"
            value={agent.uniqueClients.toLocaleString()}
          />
          <StatBlock
            label="Avg Raw Score"
            value={agent.avgRawScore !== null ? agent.avgRawScore.toFixed(1) : "—"}
            sub="0–100 (unweighted)"
          />
          <StatBlock
            label="Effective Feedback"
            value={agent.effectiveFeedback.toFixed(2)}
            sub="recency-decayed volume"
          />
        </div>

        {/* ── Score breakdown ────────────────────────────────────── */}
        <div className="rounded-lg border border-slate-800 bg-panel px-5 py-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Score Breakdown
          </h2>
          <ScoreBarWide breakdown={agent.scoreBreakdown} />
        </div>

        {/* ── Owner / Identity ───────────────────────────────────── */}
        <div className="rounded-lg border border-slate-800 bg-panel px-5 py-4 space-y-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Identity
          </h2>
          <div className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Owner address</span>
              <a
                href={`https://etherscan.io/address/${agent.ownerAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-accent hover:underline"
              >
                {agent.ownerAddress}
              </a>
            </div>
            {ensName ? (
              <div className="flex justify-between">
                <span className="text-slate-500">ENS name</span>
                <span className="text-good font-mono text-xs">{ensName}</span>
              </div>
            ) : (
              <div className="flex justify-between">
                <span className="text-slate-500">ENS name</span>
                <span className="text-slate-600 text-xs">not resolved</span>
              </div>
            )}
            {agent.tokenURI && (
              <div className="flex justify-between items-start gap-4">
                <span className="text-slate-500 shrink-0">Token URI</span>
                <a
                  href={agent.tokenURI.replace(/^ipfs:\/\//, "https://ipfs.io/ipfs/")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-slate-400 hover:text-accent truncate max-w-xs"
                  title={agent.tokenURI}
                >
                  {agent.tokenURI}
                </a>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-500">Registered</span>
              <span className="text-slate-300 text-xs">{formatDate(agent.registeredAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Registration tx</span>
              <a
                href={`https://etherscan.io/tx/${agent.registeredTx}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-slate-400 hover:text-accent"
              >
                {truncTx(agent.registeredTx)}
              </a>
            </div>
            {agent.lastFeedbackAt && (
              <div className="flex justify-between">
                <span className="text-slate-500">Last feedback</span>
                <span className="text-slate-300 text-xs">{formatDate(agent.lastFeedbackAt)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-500">Last activity</span>
              <span className="text-slate-300 text-xs">{formatDate(agent.lastActivityAt)}</span>
            </div>
          </div>
        </div>

        {/* ── x402 status ────────────────────────────────────────── */}
        <div className="rounded-lg border border-slate-800 bg-panel px-5 py-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Payment Support
          </h2>
          {agent.x402 ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-accent inline-block" />
              <span className="text-accent font-medium">x402 payments enabled</span>
              <span className="text-slate-500">— this agent accepts HTTP 402 micropayments</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="h-2 w-2 rounded-full bg-slate-700 inline-block" />
              x402 not advertised in registration metadata
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        {computedAtStr && (
          <p className="text-xs text-slate-600 text-center">
            Data computed {computedAtStr} · sourced from BigQuery over Ethereum mainnet ERC-8004 registries
          </p>
        )}
      </div>
    </main>
  );
}
