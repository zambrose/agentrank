-- =============================================================================
-- 02_decode_identity.sql  —  Decode IdentityRegistry registrations
-- =============================================================================
-- Produces ONE row per agent (= per ERC-721 tokenId / agentId) with:
--   agent_id        the uint256 token id (fits in INT64 for all real data)
--   owner_address   current-at-registration owner (0x-prefixed, lowercase)
--   token_uri       agent registration URI if emitted on-chain, else NULL
--   registered_at   block_timestamp of the registration
--   registered_tx   transaction hash of the registration
--
-- DECODE NOTES (validated against real rows on 2026-06-13):
--   * Registration is the `Registered(uint256 indexed agentId, string agentURI,
--     address indexed owner)` event. agentId is topics[1], owner is topics[3]
--     (right-most 20 bytes), agentURI is an ABI-encoded string in `data`.
--   * On mainnet, agentURI in `Registered` is frequently EMPTY; the real URI is
--     set later via `URIUpdated(uint256,string,address)` (newURI in `data`).
--     We therefore COALESCE: latest URIUpdated.newURI  ->  Registered.agentURI.
--   * agentId values are small (<2^53) so SAFE.CAST via hex works. We strip the
--     leading zeros of topics[1] and parse as hex.
--   * The ERC-721 `Transfer` mint (from == 0x0) is an equivalent registration
--     signal; we cross-check counts against `Registered` but key off Registered
--     because it carries the URI + a clean owner.
--
-- COST: bounded by `block_timestamp >= DEPLOY_DATE`. Do not widen the floor.
-- =============================================================================

DECLARE IDENTITY_ADDR  STRING DEFAULT LOWER('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432');
DECLARE DEPLOY_DATE    TIMESTAMP DEFAULT TIMESTAMP('2026-01-29');  -- first on-chain activity

-- Helper inline: decode an ABI-encoded single `string` sitting in `data`.
-- Layout: [32-byte offset=0x20][32-byte length][padded utf-8 bytes].
-- We read the length word, then SUBSTR the utf-8 bytes and SAFE_CONVERT to STRING.
-- Returns NULL/'' for empty strings.

WITH raw AS (
  SELECT
    topics, data, block_timestamp, transaction_hash, log_index
  FROM `bigquery-public-data.crypto_ethereum.logs`
  WHERE address = IDENTITY_ADDR
    AND block_timestamp >= DEPLOY_DATE
    AND ARRAY_LENGTH(topics) >= 1
),

-- ---- Registrations (Registered event) -------------------------------------
registered AS (
  SELECT
    -- agentId: hex of topics[1] (strip 0x, lstrip zeros, parse hex -> INT64)
    SAFE_CAST(CONCAT('0x', LTRIM(SUBSTR(topics[OFFSET(1)], 3), '0')) AS INT64) AS agent_id,
    CONCAT('0x', SUBSTR(topics[OFFSET(2)], 27)) AS owner_address,  -- last 20 bytes
    -- agentURI string from data (may be empty)
    (
      SELECT SAFE_CONVERT_BYTES_TO_STRING(
        SUBSTR(
          FROM_HEX(SUBSTR(data, 3)),
          /* byte offset: after [offset word][length word] = byte 65 (1-based) */ 65,
          /* length word value */ SAFE_CAST(CONCAT('0x', SUBSTR(data, 3 + 64, 64)) AS INT64)
        )
      )
    ) AS reg_uri,
    block_timestamp AS registered_at,
    transaction_hash AS registered_tx
  FROM raw
  WHERE topics[OFFSET(0)] = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a'
    AND ARRAY_LENGTH(topics) >= 3
),

-- ---- Latest URI per agent (URIUpdated event) ------------------------------
uri_updates AS (
  SELECT
    SAFE_CAST(CONCAT('0x', LTRIM(SUBSTR(topics[OFFSET(1)], 3), '0')) AS INT64) AS agent_id,
    SAFE_CONVERT_BYTES_TO_STRING(
      SUBSTR(
        FROM_HEX(SUBSTR(data, 3)),
        65,
        SAFE_CAST(CONCAT('0x', SUBSTR(data, 3 + 64, 64)) AS INT64)
      )
    ) AS new_uri,
    block_timestamp
  FROM raw
  WHERE topics[OFFSET(0)] = '0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb'
    AND ARRAY_LENGTH(topics) >= 2
),
latest_uri AS (
  SELECT agent_id, new_uri
  FROM (
    SELECT agent_id, new_uri,
           ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY block_timestamp DESC) AS rn
    FROM uri_updates
  )
  WHERE rn = 1
)

SELECT
  r.agent_id,
  r.owner_address,
  -- Prefer the most recent explicit URIUpdated; fall back to the registration URI.
  NULLIF(COALESCE(u.new_uri, r.reg_uri), '') AS token_uri,
  r.registered_at,
  r.registered_tx
FROM registered r
LEFT JOIN latest_uri u USING (agent_id)
-- If an agentId was registered more than once in raw data (shouldn't happen for
-- a clean mint), keep the earliest registration.
QUALIFY ROW_NUMBER() OVER (PARTITION BY r.agent_id ORDER BY r.registered_at ASC) = 1
ORDER BY r.agent_id;
