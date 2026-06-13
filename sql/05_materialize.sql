-- =============================================================================
-- 05_materialize.sql  —  Build the UI-facing summary table
-- =============================================================================
-- Creates `agentrank-499305.agentrank.agent_summary` as a MATERIALIZED TABLE
-- (a snapshot, not a view) so the API/UI never re-scan the 3.7TB logs table.
-- Refresh by re-running this statement on a schedule (see SCHEMA.md). Each run
-- is a single bounded scan (block_timestamp >= DEPLOY_DATE).
--
-- The column list here IS the locked contract in shared/schema.ts. If you add,
-- remove, or rename a column, update shared/schema.ts + shared/SCHEMA.md in the
-- SAME change and announce it — downstream API + frontend import this shape.
--
-- Dataset bootstrap (run once; safe to re-run):
--   CREATE SCHEMA IF NOT EXISTS `agentrank-499305.agentrank`
--     OPTIONS (location = 'US');
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS `agentrank-499305.agentrank` OPTIONS (location = 'US');

CREATE OR REPLACE TABLE `agentrank-499305.agentrank.agent_summary`
OPTIONS (
  description = 'ERC-8004 mainnet agents ranked by recency-weighted reputation. Built by sql/05_materialize.sql. x402 column is a placeholder filled by the api-caching tokenURI fetcher.'
) AS
WITH
-- ===== identical decode + scoring logic as 04_reputation_score.sql ==========
id_raw AS (
  SELECT topics, data, block_timestamp, transaction_hash
  FROM `bigquery-public-data.crypto_ethereum.logs`
  WHERE address = LOWER('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
    AND block_timestamp >= TIMESTAMP('2026-01-29') AND ARRAY_LENGTH(topics) >= 1
),
registered AS (
  SELECT
    SAFE_CAST(CONCAT('0x', LTRIM(SUBSTR(topics[OFFSET(1)],3),'0')) AS INT64) AS agent_id,
    CONCAT('0x', SUBSTR(topics[OFFSET(2)],27)) AS owner_address,
    SAFE_CONVERT_BYTES_TO_STRING(SUBSTR(FROM_HEX(SUBSTR(data,3)),65,
      SAFE_CAST(CONCAT('0x',SUBSTR(data,3+64,64)) AS INT64))) AS reg_uri,
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
      SAFE_CAST(CONCAT('0x',SUBSTR(data,3+64,64)) AS INT64))) AS new_uri, block_timestamp
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
fb_raw AS (
  SELECT topics, data, block_timestamp
  FROM `bigquery-public-data.crypto_ethereum.logs`
  WHERE address = LOWER('0x8004BAa17C55a88189AE136b182e5fdA19dE9b63')
    AND block_timestamp >= TIMESTAMP('2026-01-29')
    AND topics[OFFSET(0)] = '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc'
    AND ARRAY_LENGTH(topics) >= 3
),
feedback_scored AS (
  SELECT
    SAFE_CAST(CONCAT('0x', LTRIM(SUBSTR(topics[OFFSET(1)],3),'0')) AS INT64) AS agent_id,
    CONCAT('0x', SUBSTR(topics[OFFSET(2)],27)) AS client_address,
    block_timestamp AS created_at,
    LEAST(1.0, GREATEST(0.0,
      SAFE_DIVIDE(
        CASE WHEN SUBSTR(data,3+64+32,1) IN ('8','9','a','b','c','d','e','f')
             THEN CAST(SAFE_CAST(CONCAT('0x',SUBSTR(data,3+64+32,32)) AS INT64) AS FLOAT64) - POW(2,64)
             ELSE CAST(SAFE_CAST(CONCAT('0x',SUBSTR(data,3+64+32,32)) AS INT64) AS FLOAT64) END,
        POW(10, COALESCE(SAFE_CAST(CONCAT('0x',LTRIM(SUBSTR(data,3+128,64),'0')) AS INT64),0))
      ) / 100.0)) AS q,
    POW(0.5, DATE_DIFF(CURRENT_DATE(), DATE(block_timestamp), DAY) / 30.0) AS w
  FROM fb_raw
),
agg AS (
  SELECT agent_id,
    COUNT(*) AS feedback_count,
    COUNT(DISTINCT client_address) AS unique_clients,
    SUM(w) AS eff_n,
    SAFE_DIVIDE(SUM(w*q), NULLIF(SUM(w),0)) AS wq,
    MAX(created_at) AS last_feedback_at,
    COUNTIF(q >= 0.66) AS positive_count,
    COUNTIF(q >= 0.33 AND q < 0.66) AS neutral_count,
    COUNTIF(q < 0.33) AS negative_count,
    AVG(q*100.0) AS avg_raw_score
  FROM feedback_scored GROUP BY agent_id
),
scored AS (
  SELECT
    a.agent_id,
    a.owner_address,
    a.token_uri,
    a.registered_at,
    a.registered_tx,
    COALESCE(g.feedback_count,0)  AS feedback_count,
    COALESCE(g.unique_clients,0)  AS unique_clients,
    COALESCE(g.positive_count,0)  AS positive_count,
    COALESCE(g.neutral_count,0)   AS neutral_count,
    COALESCE(g.negative_count,0)  AS negative_count,
    ROUND(g.avg_raw_score,2)      AS avg_raw_score,
    g.last_feedback_at,
    GREATEST(a.registered_at, COALESCE(g.last_feedback_at, a.registered_at)) AS last_activity_at,
    ROUND(100.0 * (
      (COALESCE(g.eff_n,0)/(COALESCE(g.eff_n,0)+5.0)) * COALESCE(g.wq,0.5)
      + (5.0/(COALESCE(g.eff_n,0)+5.0)) * 0.5
    ), 4) AS reputation_score,
    ROUND(COALESCE(g.eff_n,0),4) AS effective_feedback
  FROM agents a LEFT JOIN agg g USING (agent_id)
)
SELECT
  agent_id,
  owner_address,
  token_uri,
  registered_at,
  registered_tx,
  feedback_count,
  unique_clients,
  positive_count,
  neutral_count,
  negative_count,
  avg_raw_score,
  reputation_score,
  effective_feedback,
  last_feedback_at,
  last_activity_at,
  -- dense rank by reputation_score (ties broken by volume then recency)
  CAST(ROW_NUMBER() OVER (
    ORDER BY reputation_score DESC, feedback_count DESC, registered_at DESC
  ) AS INT64) AS rank,
  -- x402 PLACEHOLDER: filled by the api-caching tokenURI metadata fetcher.
  FALSE AS x402,
  CURRENT_TIMESTAMP() AS computed_at
FROM scored;
