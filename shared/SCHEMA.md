# AgentDex — Locked Output Schema

This is the contract the API and frontend consume. The TypeScript source of
truth is [`shared/schema.ts`](./schema.ts) (`AgentSummary`). The BigQuery
materialized table `agentrank-499305.agentrank.agent_summary`
(built by [`sql/05_materialize.sql`](../sql/05_materialize.sql)) returns the
same columns in snake_case; the API maps snake_case → camelCase at the edge.

**Changing this schema is a breaking change** — update `schema.ts`,
`05_materialize.sql`, and this file together, and announce it to api-caching and
frontend-viz.

## Confirmed mainnet contracts

| Registry | Address | Notes |
|---|---|---|
| IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | ERC-721; also on Base mainnet |
| ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | also on Base mainnet |

The `0x8004A818…` / `0x8004B663…` pair is **Sepolia testnet** — not used.
First on-chain activity: **2026-01-29**. As of 2026-06-13: **34,452 registered
agents**, **3,173 feedback events** (`NewFeedback`), **0 revocations**.

## Fields

| Column (BQ) | TS field | Type | Meaning |
|---|---|---|---|
| `agent_id` | `agentId` | int | ERC-721 tokenId == ERC-8004 agentId. Dense 1..N. |
| `owner_address` | `ownerAddress` | string | Registrant address, `0x` lowercase. |
| `token_uri` | `tokenURI` | string \| null | Registration URI (often `ipfs://`). Latest `URIUpdated`, else `Registered.agentURI`, else null. |
| `registered_at` | `registeredAt` | ISO ts | Registration time. |
| `registered_tx` | `registeredTx` | string | Registration tx hash. |
| `feedback_count` | `feedbackCount` | int | Raw `NewFeedback` count. |
| `unique_clients` | `uniqueClients` | int | Distinct feedback authors. |
| `positive/neutral/negative_count` | `scoreBreakdown` | `{positive,neutral,negative}` | Feedback bucketed by quality. |
| `avg_raw_score` | `avgRawScore` | float \| null | Simple mean score (0..100). Diagnostic, not ranking. |
| `reputation_score` | `reputationScore` | float | **The ranking number, 0..100.** See below. |
| `effective_feedback` | `effectiveFeedback` | float | Recency-weighted feedback volume. |
| `last_feedback_at` | `lastFeedbackAt` | ISO ts \| null | Most recent feedback. |
| `last_activity_at` | `lastActivityAt` | ISO ts | `max(registeredAt, lastFeedbackAt)`. |
| `rank` | `rank` | int | 1-based, by score then volume then recency. |
| `x402` | `x402` | bool | **Placeholder (false)** — filled by api-caching from tokenURI metadata. |
| `computed_at` | `computedAt` | ISO ts | Snapshot time. |

## Reputation scoring methodology

Per feedback *i*: normalised quality `q_i = clamp(value_i / 10^decimals_i / 100, 0, 1)`
(observed on-chain scale is 0..100). Recency weight
`w_i = 0.5 ^ (age_days_i / 30)` — a **30-day half-life** exponential decay.

```
wq      = Σ(w_i · q_i) / Σ(w_i)            # recency-weighted mean quality
eff_n   = Σ(w_i)                           # recency-weighted volume
conf    = eff_n / (eff_n + 5)              # Bayesian confidence, K=5 pseudo-count
score   = 100 · (conf · wq + (1−conf) · 0.5)
```

- **Recency weighting:** fresh feedback dominates; month-old feedback counts half.
- **Volume confidence:** Bayesian shrinkage toward a neutral 0.5 prior so a single
  5-star rating cannot outrank a long track record. Unrated agents score exactly
  **50.0** and are ordered amongst themselves by registration recency (a sort
  tie-breaker, never baked into the score).
- **Revocations:** `FeedbackRevoked` never fires on mainnet today; the SQL is
  structured so scores self-correct if it ever does.

Tunables live as `DECLARE` constants at the top of `sql/04_reputation_score.sql`
(`HALF_LIFE_DAYS=30`, `K_PRIOR=5`, `PRIOR_Q=0.5`).

## Refresh cadence

The table is a **snapshot**, rebuilt by re-running `05_materialize.sql`. Because
`reputationScore` decays with wall-clock time, refresh **daily** (a BigQuery
scheduled query). The UI never queries raw logs — only this table.

## Example query (UI list page)

```sql
SELECT agent_id, owner_address, token_uri, reputation_score, feedback_count,
       positive_count, neutral_count, negative_count, x402, rank
FROM `agentrank-499305.agentrank.agent_summary`
WHERE feedback_count > 0          -- optional filter
ORDER BY rank
LIMIT 50;
```

## Status / blockers

The materialized table is **not yet built** — the build scan is blocked on the
free-tier query-bytes quota and a missing `datasets.create` permission. See
[`fixtures/PROVENANCE.md`](./fixtures/PROVENANCE.md). All decode + scoring SQL is
validated; the table will populate correctly once a billable scan is enabled.
