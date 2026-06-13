// Placeholder home page — replaced by the frontend-viz agent with the
// searchable/filterable ranked list + signature p5.js visualization.
import { loadAgents } from "@/lib/data";

export default function Home() {
  const { rows, source } = loadAgents();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-bold text-accent">AgentRank</h1>
      <p className="mt-2 text-sm text-slate-400">
        ERC-8004 Agent Economy Explorer · data source:{" "}
        <span className="font-bold">{source}</span> · {rows.length} agents
      </p>
      <ul className="mt-6 space-y-1 text-sm">
        {rows.slice(0, 10).map((a) => (
          <li key={a.agentId} className="flex justify-between border-b border-slate-800 py-1">
            <span>#{a.rank} · agent {a.agentId}</span>
            <span className="text-good">{a.reputationScore.toFixed(1)}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
