// =============================================================================
// components/EnsLookup.tsx — live ENS resolution box (client component)
// =============================================================================
// Type any ENS name (e.g. "vitalik.eth") or 0x address and resolve it live
// against Ethereum mainnet through /api/ens (viem → ENS Universal Resolver).
// This is the interactive proof that ENS resolution is real, independent of
// whether a given agent owner has set a primary name.
// =============================================================================
"use client";

import { useState } from "react";

interface EnsResult {
  query: string;
  kind: "address" | "name" | "invalid";
  name: string | null;
  address: string | null;
  records: Record<string, string | null>;
}

const EXAMPLES = ["vitalik.eth", "ens.eth", "nick.eth"];

export default function EnsLookup() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EnsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/ens?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error(`lookup failed (${res.status})`);
      setResult((await res.json()) as EnsResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "lookup failed");
    } finally {
      setLoading(false);
    }
  }

  const resolved =
    result && (result.name || result.address) && result.kind !== "invalid";

  return (
    <div className="rounded-xl border border-slate-800 p-4" style={{ background: "#080c14" }}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          Live ENS Resolver
        </h2>
        <span className="text-xs text-slate-600">viem · mainnet · real on-chain read</span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(q);
        }}
        className="flex gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="vitalik.eth  or  0xd8dA…6045"
          spellCheck={false}
          className="flex-1 rounded-lg border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-accent focus:outline-none font-mono"
        />
        <button
          type="submit"
          disabled={loading || !q.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          {loading ? "resolving…" : "Resolve"}
        </button>
      </form>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="text-xs text-slate-600 mr-1">try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => {
              setQ(ex);
              run(ex);
            }}
            className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400 hover:border-accent hover:text-accent font-mono"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-xs text-bad">{error}</p>}

      {result && !resolved && !error && (
        <p className="mt-3 text-xs text-slate-500">
          No ENS {result.kind === "address" ? "primary name" : "address"} found for{" "}
          <span className="font-mono text-slate-400">{result.query}</span>. The
          resolution call was live — this name/address simply has no record set.
        </p>
      )}

      {result && resolved && (
        <div className="mt-3 space-y-2 rounded-lg border border-slate-800 bg-black/20 p-3">
          <div className="flex items-center gap-3">
            {result.records.avatar && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.records.avatar}
                alt=""
                className="h-9 w-9 rounded-full border border-slate-700 object-cover"
              />
            )}
            <div className="min-w-0">
              {result.name && (
                <div className="text-sm font-semibold text-good">{result.name}</div>
              )}
              {result.address && (
                <div className="truncate font-mono text-xs text-slate-400">{result.address}</div>
              )}
            </div>
          </div>
          {Object.entries(result.records).filter(([k]) => k !== "avatar").length > 0 && (
            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
              {Object.entries(result.records)
                .filter(([k]) => k !== "avatar")
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-slate-600 font-mono">{k}</dt>
                    <dd className="truncate text-slate-300">{v}</dd>
                  </div>
                ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
