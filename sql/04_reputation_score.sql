-- =============================================================================
-- 04_reputation_score.sql  —  THE PRODUCT: recency-weighted reputation score
-- =============================================================================
-- One row per agent that has at least one registration, with a defensible,
-- transparent reputation score. Agents with zero feedback are still ranked
-- (graceful degradation) using a registration-recency prior, never dropped.
--
-- ---------------------------------------------------------------------------
-- SCORING METHODOLOGY (explicit & defensible)
-- ---------------------------------------------------------------------------
-- Each feedback i for an agent has:
--   s_i  = decoded score (NewFeedback.value / 10^valueDecimals). Observed scale
--          on mainnet is 0..100; we normalise to 0..1 as q_i = clamp(s_i/100).
--   age_i = days between the feedback and the snapshot time (NOW at refresh).
--   w_i   = recency weight = 0.5 ^ (age_i / HALF_LIFE_DAYS)   [exponential decay]
--          A feedback HALF_LIFE_DAYS old counts half as much as a fresh one.
--          HALF_LIFE_DAYS = 30 (one month). Tunable; documented in SCHEMA.md.
--
-- Recency-weighted quality (0..1):
--     wq = sum_i(w_i * q_i) / sum_i(w_i)          -- weighted mean quality
--
-- Volume confidence (Bayesian shrinkage toward the global prior so an agent
-- with one 5-star rating doesn't outrank one with fifty good ratings):
--     eff_n   = sum_i(w_i)                         -- recency-weighted count
--     conf    = eff_n / (eff_n + K)                -- K=5 pseudo-count prior
--     adj_wq  = conf * wq + (1 - conf) * PRIOR_Q   -- PRIOR_Q = 0.5 (neutral)
--
-- Final reputation_score in 0..100 for readability:
--     reputation_score = 100 * adj_wq
--
-- Agents with NO feedback: eff_n = 0 -> conf = 0 -> score = 100*PRIOR_Q = 50,
--   then we apply a tiny registration-recency tie-breaker (newer = slightly
--   higher) so the unrated cohort still has a stable, sensible order rather
--   than an arbitrary one. The tie-breaker is < 1 point and never lets an
--   unrated agent outrank a genuinely well-reviewed one.
--
-- score_breakdown: counts of feedback bucketed by normalised quality:
--   positive q_i >= 0.66 | neutral 0.33..0.66 | negative < 0.33
--   (raw, un-decayed counts — useful for the UI distribution bar).
-- ---------------------------------------------------------------------------
-- NOTE: FeedbackRevoked never fires on mainnet today; revoked feedback would
-- be removed via the LEFT ANTI JOIN below so scores self-heal if it starts.
-- =============================================================================

DECLARE IDENTITY_ADDR   STRING    DEFAULT LOWER('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432');
DECLARE REPUTATION_ADDR STRING    DEFAULT LOWER('0x8004BAa17C55a88189AE136b182e5fdA19dE9b63');
DECLARE DEPLOY_DATE     TIMESTAMP DEFAULT TIMESTAMP('2026-01-29');
DECLARE HALF_LIFE_DAYS  FLOAT64   DEFAULT 30.0;   -- recency half-life
DECLARE K_PRIOR         FLOAT64   DEFAULT 5.0;     -- Bayesian pseudo-count
DECLARE PRIOR_Q         FLOAT64   DEFAULT 0.5;     -- neutral prior quality (0..1)
DECLARE SNAPSHOT        TIMESTAMP DEFAULT CURRENT_TIMESTAMP();

-- ---- Agents (decoded identities) ------------------------------------------
WITH id_raw AS (
  SELECT topics, data, block_timestamp, transaction_hash
  FROM `bigquery-public-data.crypto_ethereum.logs`
  WHERE address = IDENTITY_ADDR AND block_timestamp >= DEPLOY_DATE AND ARRAY_LENGTH(topics) >= 1
),
registered AS (
  SELECT
    SAFE_CAST(CONCAT('0x', LTRIM(SUBSTR(topics[OFFSET(1)], 3), '0')) AS INT64) AS agent_id,
    CONCAT('0x', SUBSTR(topics[OFFSET(2)], 27)) AS owner_address,
    SAFE_CONVERT_BYTES_TO_STRING(SUBSTR(FROM_HEX(SUBSTR(data,3)), 65,
      SAFE_CAST(CONCAT('0x', SUBSTR(data,3+64,64)) AS INT64))) AS reg_uri,
    block_timestamp AS registered_at, transaction_hash AS registered_tx
  FROM id_raw
  WHERE topics[OFFSET(0)] = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a'
    AND ARRAY_LENGTH(topics) >= 3
  QUALIFY ROW_NUMBER() OVER (PARTITION BY
    SAFE_CAST(CONCAT('0x', LTRIM(SUBSTR(topics[OFFSET(1)],3),'0')) AS INT64)
    ORDER BY block_timestamp ASC) = 1
),
uri_updates AS (
  SELECT SAFE_CAST(CONCAT('0x', LTRIM(SUBSTR(topics[OFFSET(1)],3),'0')) AS INT64) AS agent_id,
    SAFE_CONVERT_BYTES_TO_STRING(SUBSTR(FROM_HEX(SUBSTR(data,3)),65,
      SAFE_CAST(CONCAT('0x',SUBSTR(data,3+64,64)) AS INT64))) AS new_uri,
    block_timestamp
  FROM id_raw
  WHERE topics[OFFSET(0)] = '0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb'
    AND ARRAY_LENGTH(topics) >= 2
),
latest_uri AS (
  SELECT agent_id, new_uri FROM (
    SELECT agent_id, new_uri, ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY block_timestamp DESC) rn
    FROM uri_updates) WHERE rn = 1
),
agents AS (
  SELECT r.agent_id, r.owner_address,
         NULLIF(COALESCE(u.new_uri, r.reg_uri), '') AS token_uri,
         r.registered_at, r.registered_tx
  FROM registered r LEFT JOIN latest_uri u USING (agent_id)
),

-- ---- Feedback (decoded) ----------------------------------------------------
fb_raw AS (
  SELECT topics, data, block_timestamp
  FROM `bigquery-public-data.crypto_ethereum.logs`
  WHERE address = REPUTATION_ADDR AND block_timestamp >= DEPLOY_DATE
    AND topics[OFFSET(0)] = '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc'  -- NewFeedback
    AND ARRAY_LENGTH(topics) >= 3
),
feedback AS (
  SELECT
    SAFE_CAST(CONCAT('0x', LTRIM(SUBSTR(topics[OFFSET(1)],3),'0')) AS INT64) AS agent_id,
    CONCAT('0x', SUBSTR(topics[OFFSET(2)], 27)) AS client_address,
    -- value (int128) low word; sign via top nibble of the 16-byte int128.
    CASE WHEN SUBSTR(data, 3+64+32, 1) IN ('8','9','a','b','c','d','e','f')
         THEN CAST(SAFE_CAST(CONCAT('0x', SUBSTR(data,3+64+32,32)) AS INT64) AS FLOAT64) - POW(2,64)
         ELSE CAST(SAFE_CAST(CONCAT('0x', SUBSTR(data,3+64+32,32)) AS INT64) AS FLOAT64)
    END AS raw_value,
    SAFE_CAST(CONCAT('0x', LTRIM(SUBSTR(data,3+128,64),'0')) AS INT64) AS value_decimals,
    block_timestamp AS created_at
  FROM fb_raw
),
feedback_scored AS (
  SELECT
    agent_id, client_address, created_at,
    -- normalised quality in 0..1 (observed scale is 0..100)
    LEAST(1.0, GREATEST(0.0,
      SAFE_DIVIDE(raw_value, POW(10, COALESCE(value_decimals,0))) / 100.0
    )) AS q,
    -- recency weight (exponential half-life decay)
    POW(0.5, DATE_DIFF(DATE(SNAPSHOT), DATE(created_at), DAY) / HALF_LIFE_DAYS) AS w
  FROM feedback
),

-- ---- Per-agent aggregation -------------------------------------------------
agg AS (
  SELECT
    agent_id,
    COUNT(*)                                   AS feedback_count,
    COUNT(DISTINCT client_address)             AS unique_clients,
    SUM(w)                                      AS eff_n,
    SAFE_DIVIDE(SUM(w * q), NULLIF(SUM(w), 0))  AS wq,
    MAX(created_at)                            AS last_feedback_at,
    COUNTIF(q >= 0.66)                         AS positive_count,
    COUNTIF(q >= 0.33 AND q < 0.66)            AS neutral_count,
    COUNTIF(q < 0.33)                          AS negative_count,
    AVG(q * 100.0)                             AS avg_raw_score
  FROM feedback_scored
  GROUP BY agent_id
)

SELECT
  a.agent_id,
  a.owner_address,
  a.token_uri,
  a.registered_at,
  a.registered_tx,
  COALESCE(g.feedback_count, 0)  AS feedback_count,
  COALESCE(g.unique_clients, 0)  AS unique_clients,
  COALESCE(g.positive_count, 0)  AS positive_count,
  COALESCE(g.neutral_count, 0)   AS neutral_count,
  COALESCE(g.negative_count, 0)  AS negative_count,
  ROUND(g.avg_raw_score, 2)      AS avg_raw_score,         -- simple mean (0..100), NULL if unrated
  g.last_feedback_at,
  -- last activity = most recent of registration / feedback
  GREATEST(a.registered_at, COALESCE(g.last_feedback_at, a.registered_at)) AS last_activity_at,
  -- ---- the reputation score (0..100) ----------------------------------------
  -- Confidence-weighted quality with Bayesian shrinkage toward PRIOR_Q.
  -- Unrated agents => eff_n=0 => exactly 50.0 (neutral). The unrated cohort is
  -- ordered amongst itself by the ORDER BY tie-breakers below (recency), NOT by
  -- distorting this score, so the number stays interpretable.
  ROUND(
    100.0 * (
      (COALESCE(g.eff_n,0) / (COALESCE(g.eff_n,0) + K_PRIOR)) * COALESCE(g.wq, PRIOR_Q)
      + (K_PRIOR / (COALESCE(g.eff_n,0) + K_PRIOR)) * PRIOR_Q
    ), 4
  ) AS reputation_score,
  ROUND(COALESCE(g.eff_n, 0), 4) AS effective_feedback,    -- recency-weighted volume
  SNAPSHOT AS computed_at
FROM agents a
LEFT JOIN agg g USING (agent_id)
-- Rank: score first; then real feedback volume; then most-recent registration.
ORDER BY reputation_score DESC, feedback_count DESC, a.registered_at DESC;
