-- =============================================================================
-- 03_decode_reputation.sql  —  Decode ReputationRegistry feedback
-- =============================================================================
-- Produces ONE row per feedback event with:
--   agent_id        the rated agent (uint256 -> INT64)
--   client_address  who left the feedback (0x lowercase)
--   feedback_index  per-(agent,client) sequence number (uint64)
--   raw_value       the int128 `value`, two's-complement decoded
--   value_decimals  uint8 fixed-point decimals to apply to raw_value
--   score           raw_value / 10^value_decimals  (FLOAT64, the usable rating)
--   tag1            primary category string (e.g. 'trust','liveness')
--   created_at      block_timestamp
--   feedback_tx     transaction hash
--
-- DECODE NOTES (validated against real rows on 2026-06-13):
--   Event: NewFeedback(uint256 indexed agentId, address indexed clientAddress,
--     uint64 feedbackIndex, int128 value, uint8 valueDecimals,
--     string indexed indexedTag1, string tag1, string tag2, string endpoint,
--     string feedbackURI, bytes32 feedbackHash)
--   Indexed (topics): [0]=sig, [1]=agentId, [2]=clientAddress, [3]=keccak(tag1).
--   Non-indexed `data` head, 32-byte words in order:
--     w0 feedbackIndex (uint64)
--     w1 value         (int128, SIGNED — two's complement over 128 bits)
--     w2 valueDecimals (uint8)
--     w3 offset->tag1  | w4 offset->tag2 | w5 offset->endpoint
--     w6 offset->feedbackURI | w7 feedbackHash (bytes32, inline)
--   Real samples: value=85 dec=0; value=100 dec=0; value=72 dec=0  => 0..100 scale.
--
--   SIGNED int128 decode: read low 16 bytes (value fits int128). We parse the
--   full 32-byte word as the int128 sign-extended representation. In practice
--   all observed values are small positive ints; we still handle the sign bit so
--   a future negative rating decodes correctly rather than as a huge positive.
--
-- COST: bounded; ReputationRegistry is tiny (~3.2k NewFeedback rows total).
-- =============================================================================

DECLARE REPUTATION_ADDR STRING DEFAULT LOWER('0x8004BAa17C55a88189AE136b182e5fdA19dE9b63');
DECLARE DEPLOY_DATE     TIMESTAMP DEFAULT TIMESTAMP('2026-01-29');

WITH raw AS (
  SELECT topics, data, block_timestamp, transaction_hash
  FROM `bigquery-public-data.crypto_ethereum.logs`
  WHERE address = REPUTATION_ADDR
    AND block_timestamp >= DEPLOY_DATE
    AND topics[OFFSET(0)] = '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc'  -- NewFeedback
    AND ARRAY_LENGTH(topics) >= 3
),
decoded AS (
  SELECT
    SAFE_CAST(CONCAT('0x', LTRIM(SUBSTR(topics[OFFSET(1)], 3), '0')) AS INT64) AS agent_id,
    CONCAT('0x', SUBSTR(topics[OFFSET(2)], 27))                                 AS client_address,
    -- w0 feedbackIndex (uint64): hex of bytes 0..31 of data
    SAFE_CAST(CONCAT('0x', LTRIM(SUBSTR(data, 3, 64), '0')) AS INT64)           AS feedback_index,
    -- w1 value (int128): low 32 hex-chars of word1 hold the int128 (high bytes
    -- are sign extension). Word1 = chars [3+64 .. 3+128). Take the trailing 32
    -- hex chars (16 bytes) and interpret as signed.
    (
      SELECT
        -- raw unsigned 128-bit value of the low 16 bytes
        CAST(SAFE_CAST(CONCAT('0x', SUBSTR(data, 3 + 64 + 32, 32)) AS INT64) AS FLOAT64)
    )                                                                          AS value_low64,
    -- detect sign via the int128 high bit (bit 127): if word1's 17th hex char
    -- from the end region indicates the top nibble of the 16-byte int128 >= 8.
    SUBSTR(data, 3 + 64 + 32, 1)                                               AS int128_top_nibble,
    -- w2 valueDecimals (uint8)
    SAFE_CAST(CONCAT('0x', LTRIM(SUBSTR(data, 3 + 128, 64), '0')) AS INT64)    AS value_decimals,
    block_timestamp AS created_at,
    transaction_hash AS feedback_tx,
    data
  FROM raw
)
SELECT
  agent_id,
  client_address,
  feedback_index,
  -- Two's-complement: if top nibble of the int128 >= 8 the number is negative.
  CASE
    WHEN int128_top_nibble IN ('8','9','a','b','c','d','e','f')
      THEN value_low64 - POW(2, 64)   -- sign-extend within the parsed 64-bit window
    ELSE value_low64
  END AS raw_value,
  COALESCE(value_decimals, 0) AS value_decimals,
  -- usable score = raw_value / 10^decimals
  SAFE_DIVIDE(
    CASE WHEN int128_top_nibble IN ('8','9','a','b','c','d','e','f')
         THEN value_low64 - POW(2, 64) ELSE value_low64 END,
    POW(10, COALESCE(value_decimals, 0))
  ) AS score,
  created_at,
  feedback_tx
FROM decoded
ORDER BY created_at;
