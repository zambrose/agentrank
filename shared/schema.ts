// =============================================================================
// shared/schema.ts  —  LOCKED OUTPUT CONTRACT for AgentDex
// =============================================================================
// This is the single source of truth for the shape of a ranked agent row.
// The BigQuery materialized table `agentrank-499305.agentrank.agent_summary`
// (built by sql/05_materialize.sql) returns EXACTLY these columns, and the API
// + frontend import this interface. Do NOT change a field without updating
// sql/05_materialize.sql + shared/SCHEMA.md in the same change and announcing
// it to the api-caching and frontend-viz agents.
//
// Naming: BigQuery columns are snake_case; this TS contract is camelCase. The
// API layer maps snake_case -> camelCase at the edge (documented in SCHEMA.md).
// =============================================================================

/** Distribution of feedback by normalised quality bucket (raw, un-decayed counts). */
export interface ScoreBreakdown {
  /** Feedback with normalised quality q >= 0.66 (e.g. on-chain value >= 66/100). */
  positive: number;
  /** Feedback with 0.33 <= q < 0.66. */
  neutral: number;
  /** Feedback with q < 0.33. */
  negative: number;
}

/** One ranked ERC-8004 agent. Mirrors `agentrank.agent_summary` one-to-one. */
export interface AgentSummary {
  /** ERC-721 tokenId == ERC-8004 agentId (uint256; fits in JS number for all
   *  current mainnet data, max ~34.5k). BigQuery column: agent_id. */
  agentId: number;

  /** Registrant/owner address, 0x-prefixed lowercase. BigQuery: owner_address. */
  ownerAddress: string;

  /** Agent registration URI (often ipfs://...), or null if none was emitted
   *  on-chain. Resolved as: latest URIUpdated.newURI, else Registered.agentURI,
   *  else null. BigQuery: token_uri. */
  tokenURI: string | null;

  /** Registration timestamp (ISO-8601 UTC). BigQuery: registered_at. */
  registeredAt: string;

  /** Registration transaction hash. BigQuery: registered_tx. */
  registeredTx: string;

  /** Total NewFeedback events for this agent (raw count). BigQuery: feedback_count. */
  feedbackCount: number;

  /** Distinct feedback-giving addresses. BigQuery: unique_clients. */
  uniqueClients: number;

  /** Feedback distribution by quality bucket. BigQuery columns:
   *  positive_count / neutral_count / negative_count. */
  scoreBreakdown: ScoreBreakdown;

  /** Simple arithmetic mean of normalised scores * 100 (0..100), or null if
   *  unrated. Diagnostic only — NOT the ranking number. BigQuery: avg_raw_score. */
  avgRawScore: number | null;

  /** THE ranking number: recency-weighted, volume-confidence-adjusted quality
   *  on a 0..100 scale. Unrated agents == 50.0 (neutral prior). See SCHEMA.md
   *  for the exact formula. BigQuery: reputation_score. */
  reputationScore: number;

  /** Recency-weighted effective feedback volume (sum of decay weights). Useful
   *  as a confidence/tie-break signal. BigQuery: effective_feedback. */
  effectiveFeedback: number;

  /** Most recent feedback timestamp (ISO-8601 UTC), or null if unrated.
   *  BigQuery: last_feedback_at. */
  lastFeedbackAt: string | null;

  /** Most recent on-chain activity = max(registeredAt, lastFeedbackAt).
   *  BigQuery: last_activity_at. */
  lastActivityAt: string;

  /** Dense 1-based rank by reputationScore (ties: feedbackCount, then recency).
   *  BigQuery: rank. */
  rank: number;

  /** Whether the agent's registration metadata advertises x402 payment support.
   *  PLACEHOLDER in the SQL layer (always false); populated by the api-caching
   *  tokenURI metadata fetcher. BigQuery: x402. */
  x402: boolean;

  /** When this summary row was computed (ISO-8601 UTC). BigQuery: computed_at. */
  computedAt: string;
}

/** Mainnet ERC-8004 registry addresses this dataset is built from. */
export const ERC8004_MAINNET = {
  identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
} as const;
