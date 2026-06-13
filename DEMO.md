# AgentRank — 3-Minute Demo Script

ETHGlobal NY 2026 | Google Cloud + ENS bounties

---

## Before you start (30 seconds pre-flight)

1. Open the live app URL in a browser tab.
2. Open a second tab with BigQuery console at
   `https://console.cloud.google.com/bigquery?project=agentrank-499305`
3. Have the following ready to type/paste:

```sql
SELECT agent_id, owner_address, reputation_score, feedback_count,
       positive_count, neutral_count, negative_count, rank
FROM `agentrank-499305.agentrank.agent_summary`
ORDER BY rank
LIMIT 10;
```

---

## Minute 1 — The pitch and the BigQuery layer

**Say:** "ERC-8004 defines an on-chain agent economy: any AI agent can
register on Ethereum, receive reputation feedback, and advertise payment
support. AgentRank is a live explorer built on top of that data."

**Show:** Switch to BigQuery console. Paste the SQL and click Run.

**Say:** "This is the core of the product — a single SQL query over
34,453 real registered agents decoded from `bigquery-public-data.crypto_ethereum.logs`.
The reputation score is computed entirely in BigQuery: a 30-day half-life
recency weight times a Bayesian confidence factor, scaled 0 to 100. Fresh,
high-volume positive feedback ranks highest. The SQL IS the product."

**Point out:** `reputation_score`, `feedback_count`, `positive_count` columns
in the result. Show the top agent has score ~81.3 with 9 positive feedbacks.

---

## Minute 2 — The frontend: search, filter, x402

**Switch to the app.**

**Say:** "The frontend serves this materialized table — never raw logs.
Response time is under 50ms because the snapshot is pre-loaded."

**Click:** Type `surfliquid` in the search box.

**Say:** "Full-text search across agent IDs and owner addresses. This matches
agent #34135, rank 1, from `mcp.surfliquid.com/agent.json` — the current
top-ranked agent."

**Click:** Turn on the x402 filter.

**Say:** "x402-payable agents are ones whose tokenURI registration metadata
declares HTTP 402 payment support — meaning they can charge micropayments for
API calls. We detect this by fetching each tokenURI at index time."

**Click:** Agent detail page for rank-1 agent (#34135).

**Say:** "Detail page shows the full score breakdown — 9 positive feedbacks,
0 neutral, 0 negative — the tokenURI from IPFS, the registration transaction
on Etherscan, and last activity timestamps."

---

## Minute 3 — ENS resolution and ENSIP-25/26

**On the agent detail page, scroll to the Identity section.**

**Say:** "Every owner address is reverse-resolved to an ENS name in real time.
We call viem's `getEnsName` against the ENS Universal Resolver on mainnet —
no hard-coded names, this is a live `eth_call`. Results are cached 24 hours."

**If an ENS name is shown:**
"You can see this agent's owner has the ENS name [NAME]. We also read
ENSIP-26 text records: `agent-context` gives an AI-readable system prompt,
and `agent-endpoint[mcp]` gives the Model Context Protocol endpoint URL."

**If no ENS name is shown for rank-1:**
"This owner hasn't set a primary ENS name. Let's look at rank-2" — click
rank-2 agent (#22771). "Here you can see..."

**Say:** "For agents whose ENS name links back to a specific registration,
we also read the ENSIP-25 key: `agent-registration[<erc7930-registry>][<agentId>]`.
This is the owner's on-chain attestation that their ENS name corresponds to
this exact agent registration."

**Show p5.js viz** (scroll down or click Viz tab):

**Say:** "The p5.js visualization shows reputation flow across the top agents —
nodes are agents, edge weight is feedback volume, color is score tier.
It's live data, not a mock."

---

## Closing (15 seconds)

"To summarize: 34,453 real mainnet ERC-8004 agents, reputation computed in
BigQuery SQL with recency decay and Bayesian confidence, ENS names resolved
live on-chain, x402 payment detection from tokenURI metadata, all served
under 50ms from a materialized snapshot. The repo is public, the BigQuery
project is `agentrank-499305`, and the SQL is the product."

---

## Fallback cheat-sheet

If ENS names are slow to appear (RPC cold start), explain: "The first resolve
per address is a live eth_call — about 200ms — and is then cached for 24 hours.
In production we pre-warm the top 200 owners with `node scripts/ens-warm.mjs`."

If the app is down, fall back to the BigQuery console with this query showing
score distribution:

```sql
SELECT
  CASE
    WHEN reputation_score >= 70 THEN 'high (>=70)'
    WHEN reputation_score >= 40 THEN 'medium (40-70)'
    ELSE 'low (<40)'
  END AS tier,
  COUNT(*) AS agents,
  ROUND(AVG(feedback_count), 1) AS avg_feedbacks
FROM `agentrank-499305.agentrank.agent_summary`
GROUP BY tier
ORDER BY tier;
```

---

## Key numbers to cite

| Stat | Value |
|---|---|
| Total registered agents | 34,453 |
| Agents with reputation feedback | 1,652 |
| x402-payable agents | TBD (tokenURI scan in progress) |
| Feedback events (NewFeedback) | 3,173 |
| Top score | 81.3 / 100 |
| ENS names resolved (top 200) | ~varies (live on-chain) |
| BigQuery table | `agentrank-499305.agentrank.agent_summary` |
| Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Reputation Registry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
