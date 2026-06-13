# Fixtures & snapshot provenance

All rows are **real ERC-8004 mainnet data** decoded from
`bigquery-public-data.crypto_ethereum.logs` — never synthetic. They conform to
`shared/schema.ts` (`AgentSummary`).

## Live materialization (current)

On 2026-06-13 the full pipeline was materialized into BigQuery table
`agentrank-499305.agentrank.agent_summary` by `sql/05_materialize.sql`:

- **34,453 agents** (dense agentIds), **1,652 with feedback**, **16,711 with a tokenURI**.
- Full snapshot exported to `data/agent_summary.json` (the deploy artifact the
  API serves; `lib/data.ts` prefers it over fixtures).
- `shared/fixtures/agents.json` = the **top 50 by rank**, committed so the app
  builds/runs even without the snapshot present.

Reputation score = 30-day half-life recency decay × Bayesian volume shrinkage
toward a neutral 0.5 prior, scaled 0..100 (see `shared/SCHEMA.md`). Unrated
agents score exactly 50.0. The `x402` field is the SQL-layer placeholder
(`false`); the api-caching tokenURI fetcher populates it from registration
metadata.

## Refresh

Re-run `npm run materialize` (or `node scripts/materialize.mjs`) with
`GOOGLE_APPLICATION_CREDENTIALS` set. Each run rebuilds the table (one bounded
~352 GB scan, `block_timestamp >= 2026-01-29`, capped at 400 GB billed) and
re-exports the snapshot + top-50 fixtures.
