// =============================================================================
// components/AgentList.tsx — searchable + filterable ranked agent list (client)
// =============================================================================
"use client";

import { useState, useCallback, useTransition, useEffect } from "react";
import Link from "next/link";
import type { AgentSummary } from "@/shared/schema";

interface Props {
  initialAgents: AgentSummary[];
  initialTotal: number;
  source: string;
  computedAt: string | null;
}

type SortKey = "rank" | "reputation" | "feedback" | "recency";

function truncAddr(addr: string): string {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function reputationColor(score: number): string {
  if (score >= 70) return "text-good";
  if (score >= 40) return "text-warn";
  return "text-bad";
}

function ScoreBar({ breakdown }: { breakdown: AgentSummary["scoreBreakdown"] }) {
  const total = breakdown.positive + breakdown.neutral + breakdown.negative;
  if (total === 0) return <div className="h-1 w-16 rounded bg-slate-700" />;
  const pct = (n: number) => Math.round((n / total) * 100);
  return (
    <div className="flex h-1.5 w-20 overflow-hidden rounded-full">
      <div
        className="bg-good"
        style={{ width: pct(breakdown.positive) + "%" }}
      />
      <div
        className="bg-warn"
        style={{ width: pct(breakdown.neutral) + "%" }}
      />
      <div
        className="bg-bad"
        style={{ width: pct(breakdown.negative) + "%" }}
      />
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "1d ago";
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  if (m < 12) return `${m}mo ago`;
  return `${Math.floor(m / 12)}y ago`;
}

export default function AgentList({
  initialAgents,
  initialTotal,
  source,
  computedAt,
}: Props) {
  const [agents, setAgents] = useState<AgentSummary[]>(initialAgents);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [x402, setX402] = useState(false);
  const [rated, setRated] = useState(false);
  const [sort, setSort] = useState<SortKey>("rank");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(initialTotal > initialAgents.length);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  const PAGE = 50;

  const fetchAgents = useCallback(
    async (
      q: string,
      filterX402: boolean,
      filterRated: boolean,
      sortKey: SortKey,
      off: number,
      append: boolean
    ) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q,
          x402: filterX402 ? "true" : "false",
          rated: filterRated ? "true" : "false",
          sort: sortKey,
          limit: String(PAGE),
          offset: String(off),
        });
        const res = await fetch(`/api/agents?${params}`);
        if (!res.ok) throw new Error("API error");
        const data = await res.json();
        setTotal(data.total);
        setHasMore(off + data.count < data.total);
        setAgents((prev) => (append ? [...prev, ...data.agents] : data.agents));
      } catch {
        // API not ready — fall through gracefully (keep existing agents)
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      setOffset(0);
      startTransition(() => {
        fetchAgents(query, x402, rated, sort, 0, false);
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, x402, rated, sort]);

  const loadMore = () => {
    const newOffset = offset + PAGE;
    setOffset(newOffset);
    fetchAgents(query, x402, rated, sort, newOffset, true);
  };

  const computedAtStr = computedAt
    ? new Date(computedAt).toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "short",
      })
    : null;

  return (
    <div>
      {/* ── Controls ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search agent ID, address, tokenURI…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-48 rounded border border-slate-700 bg-panel px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-accent focus:outline-none"
        />

        <button
          onClick={() => setX402(!x402)}
          className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
            x402
              ? "border-accent bg-accent/20 text-accent"
              : "border-slate-700 bg-panel text-slate-400 hover:border-slate-500"
          }`}
        >
          x402-payable
        </button>

        <button
          onClick={() => setRated(!rated)}
          className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
            rated
              ? "border-good bg-good/10 text-good"
              : "border-slate-700 bg-panel text-slate-400 hover:border-slate-500"
          }`}
        >
          has feedback
        </button>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded border border-slate-700 bg-panel px-2 py-1.5 text-xs text-slate-300 focus:border-accent focus:outline-none"
        >
          <option value="rank">Sort: rank</option>
          <option value="reputation">Sort: reputation</option>
          <option value="feedback">Sort: feedback</option>
          <option value="recency">Sort: recency</option>
        </select>
      </div>

      {/* ── Source badge ─────────────────────────────────────── */}
      <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
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
        <span>{total.toLocaleString()} agents</span>
        {computedAtStr && <span>· computed {computedAtStr}</span>}
        {loading && <span className="text-accent animate-pulse">loading…</span>}
      </div>

      {/* ── Table ────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2 text-right w-12">rank</th>
              <th className="px-3 py-2 text-left">agent</th>
              <th className="px-3 py-2 text-left">owner</th>
              <th className="px-3 py-2 text-right">score</th>
              <th className="px-3 py-2 text-right">feedback</th>
              <th className="px-3 py-2 text-left">breakdown</th>
              <th className="px-3 py-2 text-right">activity</th>
              <th className="px-3 py-2 text-center">flags</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a, i) => (
              <tr
                key={a.agentId}
                className={`border-b border-slate-800/50 transition-colors hover:bg-panel/60 ${
                  i % 2 === 0 ? "bg-transparent" : "bg-slate-900/20"
                }`}
              >
                <td className="px-3 py-2 text-right text-slate-500 tabular-nums">
                  #{a.rank}
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/agent/${a.agentId}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {a.agentId}
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-400 font-mono text-xs">
                  {truncAddr(a.ownerAddress)}
                </td>
                <td className={`px-3 py-2 text-right font-bold tabular-nums ${reputationColor(a.reputationScore)}`}>
                  {a.reputationScore.toFixed(1)}
                </td>
                <td className="px-3 py-2 text-right text-slate-400 tabular-nums">
                  {a.feedbackCount > 0 ? a.feedbackCount.toLocaleString() : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <ScoreBar breakdown={a.scoreBreakdown} />
                </td>
                <td className="px-3 py-2 text-right text-xs text-slate-500">
                  {timeAgo(a.lastActivityAt)}
                </td>
                <td className="px-3 py-2 text-center">
                  {a.x402 && (
                    <span className="rounded bg-accent/20 px-1.5 py-0.5 text-xs text-accent font-medium">
                      x402
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Load more ────────────────────────────────────────── */}
      {hasMore && (
        <div className="mt-4 text-center">
          <button
            onClick={loadMore}
            disabled={loading}
            className="rounded border border-slate-700 bg-panel px-6 py-2 text-sm text-slate-300 hover:border-accent hover:text-accent disabled:opacity-40 transition-colors"
          >
            {loading ? "loading…" : `Load more (${total - agents.length} remaining)`}
          </button>
        </div>
      )}

      {agents.length === 0 && !loading && (
        <div className="mt-8 text-center text-slate-500 text-sm">
          No agents match your filters.
        </div>
      )}
    </div>
  );
}
