# AgentRank — ETHGlobal NY 2026 submission copy

Paste-ready values for the ETHGlobal project form. Char limits verified.

---

## Project details

**Project name:** `AgentRank`

**Category:** `Infrastructure`

**Emoji:** 🏆

**Demonstration link:** _your live URL_ (Vercel `*.vercel.app` or Cloud Run `*.run.app`)

**Short description** (99/100 chars):
```
Ranks ERC-8004 agents by on-chain reputation computed in BigQuery; flags x402 agents, resolves ENS.
```

**Description** (≥280):
```
AgentRank is an explorer for the emerging ERC-8004 agent economy on Ethereum mainnet. It ranks autonomous agents by an on-chain reputation score computed entirely in BigQuery SQL over raw chain logs — decoding the Identity Registry (ERC-721 mints) and Reputation Registry feedback events directly by topic hash, then scoring each agent by feedback volume, score distribution, and recency. The result is a searchable, filterable leaderboard of 34,000+ registered agents, each with a detail page showing reputation, owner, and metadata. Agents that accept x402 micropayments are flagged from their tokenURI registration files. Owner addresses reverse-resolve to ENS names with ENSIP-25/26 agent text records surfaced where set, and a live ENS resolver resolves any name or address against mainnet in real time. The reputation SQL is the product — the UI never touches raw logs.
```

**How it's made** (≥280):
```
The data layer is pure BigQuery SQL against bigquery-public-data.crypto_ethereum.logs. We derived the ERC-8004 event topic hashes from the official registry ABIs and decode Identity + Reputation registry events in SQL, computing a recency-weighted reputation score (feedback volume, score distribution, time decay) in one CREATE OR REPLACE TABLE that materializes agentrank.agent_summary — bounded to a 400GB billing cap and kept fresh by a native BigQuery scheduled query. The web app is Next.js 14 (App Router) reading the materialized snapshot, so judges never wait on a cold 30s scan. A tokenURI/IPFS metadata fetcher with server-side cache detects x402 support. ENS is real on-chain resolution via viem through the ENS Universal Resolver (forward + reverse + text records), never hard-coded. The signature visual is a p5.js force-directed "reputation flow" where node color encodes score and size encodes feedback volume. Deployed on Google Cloud Run (Next.js standalone container) with a Vercel fallback.
```

**GitHub repository:** `zambrose/agentrank` (Primary, Monorepo) — must be **public**.

---

## Tech stack (tags)

`BigQuery` · `Google Cloud Run` · `Next.js` · `TypeScript` · `viem` · `ENS` · `p5.js` · `Ethereum` · `ERC-8004` · `x402`

---

## Select prizes

- **Google Cloud — Best On-Chain Agent Economy Application** ($5,000) — primary.
  BigQuery is the core query layer over raw mainnet ERC-8004 data; reputation
  scoring is done in SQL; deployed on Cloud Run.
- **ENS — Integrate ENS** ($6,000 pool) — real viem resolution (forward +
  reverse + ENSIP-25/26 text records) plus a live resolver in the UI.

---

## Video script (≤4 min — see DEMO.md for the full run-of-show)

1. Open the live URL → leaderboard of 34k ERC-8004 agents ranked by reputation.
2. Search/filter; open an agent detail page (reputation, owner, x402 flag).
3. Show the p5.js reputation-flow visualization.
4. Live ENS resolver: type `vitalik.eth`, resolve against mainnet in real time.
5. Cut to the BigQuery console: the materialize SQL + scheduled query — "the SQL is the product."
