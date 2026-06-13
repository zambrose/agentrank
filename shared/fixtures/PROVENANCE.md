# Fixtures provenance — `agents.json`

These rows are **real ERC-8004 mainnet data**, not synthetic. They were decoded
from `bigquery-public-data.crypto_ethereum.logs` during the sql-layer build
(2026-06-13) and conform to `shared/schema.ts` (`AgentSummary`).

| agentId | what is real | what is placeholder |
|--------:|--------------|---------------------|
| 29267, 24667, 22775 | feedback `value` decoded from real `NewFeedback` events (100, 85, 72 / 100), client address, reputationScore computed per the locked formula | `ownerAddress` (not decoded for these — set to zero address), `registeredTx`, exact `registeredAt`/`lastFeedbackAt` (approximated to the observed window) |
| 23041, 23093 | agentId, `ownerAddress`, `tokenURI` (ipfs://) all decoded from real `URIUpdated` events | unrated (no feedback) — score is the neutral 50.0 prior |
| 7, 50, 65 | agentId, `ownerAddress` (`0x9ce7…569c`), `registeredTx`, `registeredAt` all from a real `Registered` event | unrated |

## Why only 8 rows (target was 15–30)

The materialized table could **not** be built in this session. Two hard blockers,
both requiring an orchestrator decision:

1. **Free-tier query-bytes quota exhausted.** Every fresh scan of the public
   `logs` table costs ~170–365 GB (the table is partitioned by month, not
   clustered by address, so an address filter does not reduce *bytes scanned*).
   Validation queries earlier in the session ran from BigQuery's 24h results
   cache (0 bytes billed); new query text now returns
   `Quota exceeded: ... free query bytes scanned`.
2. **No `bigquery.datasets.create` permission** for the service account, so
   `agentrank-499305.agentrank` could not be created.

**To get the full ~34,452-row table + complete fixtures:** enable billing on
project `agentrank-499305` (or grant the SA dataset-create + a paid query slot),
then run `sql/05_materialize.sql`, then re-export the top N rows with
`node scripts/bq.mjs run sql/04_reputation_score.sql`. The decode + scoring SQL
is fully validated (counts cross-checked against on-chain), so the table will
populate correctly the moment the scan can run.
