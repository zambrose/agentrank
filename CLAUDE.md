# AgentRank — ERC-8004 Agent Economy Explorer (ETHGlobal NY 2026)

A BigQuery-powered explorer that ranks ERC-8004 agents by on-chain reputation,
surfaces activity trends, and flags x402-payable agents.

**Bounty targets:** Google Cloud — Best On-Chain Agent Economy Application
($5,000). Secondary: ENS "Integrate ENS" pool ($6,000 split).

## Architecture (locked)

- **Data layer (critical path):** BigQuery SQL against
  `bigquery-public-data.crypto_ethereum.logs`, decoding ERC-8004 Identity +
  Reputation registry events by topic hash. The reputation score
  (feedback volume, score distribution, recency-weighted) is computed in SQL —
  the SQL IS the product per bounty qual requirements. Results materialized
  into summary tables/views; the UI never queries raw logs.
- **Contracts (verify on Etherscan before hard-wiring):** Ethereum mainnet
  IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`,
  ReputationRegistry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`.
  ABIs/spec: https://github.com/erc-8004/erc-8004-contracts (ERC8004SPEC.md
  is normative). A second address pair (`0x8004A818...`/`0x8004B663...`)
  exists in that repo — determine which networks each maps to; use mainnet.
- **Identity Registry is ERC-721:** registrations are mints; tokenURI →
  registration file (often IPFS) → agent metadata incl. x402 payment support.
- **API:** lightweight Next.js API routes / Cloud Run service running
  parameterized BigQuery queries with server-side caching (judges must not
  wait on cold 30s scans). Metadata (tokenURI) fetcher with cache.
- **Frontend:** Next.js + viem (ENS) + p5.js for ONE signature visualization
  (activity heatmap or reputation-flow). Searchable/filterable agent list +
  agent detail page. Deployed to a public URL (Cloud Run or Vercel).
- **ENS:** reverse-resolve agent owner addresses to ENS names via viem; read
  at least one ENS text record (ENSIP-25/26 agent records where present).
  Must be real resolution, never hard-coded values.

## Out of scope (ruthless MVP)

Writing on-chain, agent registration flows, Validation Registry depth (under
revision — best-effort decode only if a deployed address exists), auth,
historical backfill beyond one scheduled query, mobile polish.

## Sub-agent decomposition

| Agent | Model | Scope |
|---|---|---|
| `sql-layer` | opus | Topic hashes from ABI, decode queries, reputation-score query, materialized summary schema. **Locks the schema first; everything downstream consumes it.** |
| `api-caching` | sonnet | Parameterized query endpoints, scheduled refresh, tokenURI metadata fetcher + cache |
| `frontend-viz` | sonnet | List/detail/search against the API (fixtures until real data lands), p5.js signature viz |
| `ens-docs` | sonnet | ENS resolution integration, README + architecture diagram, demo script |

Critical path: sql-layer → api-caching → frontend-viz integration.
frontend-viz starts on fixtures immediately. Orchestration, planning,
integration decisions, and review of every subagent diff stay in the main
(Fable) loop. Never use `model: inherit`. If a sonnet agent fails the same
task twice, escalate that agent to opus.

## Hard rules

- **PRECONDITION:** GCP credentials for BigQuery must be present as env vars.
  If missing, STOP — do not mock around it.
- Never query raw logs from the UI path; pre-materialize. Billing cap set.
- Synthetic demo rows allowed ONLY in the viz layer, clearly labeled — never
  in ranked data.
- Conventional-commit checkpoints at every milestone (SQL decode validates,
  reputation query, API skeleton, frontend fixture render, live-data
  integration, ENS, deploy). No single-commit dumps. Sub-agents work on their
  own branches and merge via PRs.

## Acceptance criteria

- [ ] BigQuery is the core query layer over raw mainnet ERC-8004 data
- [ ] Official EF ERC-8004 registry addresses used
- [ ] Frontend + BigQuery backend deployed at a public URL
- [ ] Reputation ranking + at least one filter/search flow works live
- [ ] x402-payable agents flagged
- [ ] Real ENS resolution written this weekend, demo functional
- [ ] Public repo, README with architecture diagram

## Reference links

- https://github.com/erc-8004/erc-8004-contracts
- https://docs.cloud.google.com/blockchain-analytics/docs/supported-datasets
- https://docs.ens.domains + /ensip/25/ + /ensip/26/
- https://cloud.google.com/application/web3/discover
