-- =============================================================================
-- 01_topics.sql  —  ERC-8004 event topic0 (keccak256 of the event signature)
-- =============================================================================
-- topic0 = keccak256("EventName(type1,type2,...)") using the CANONICAL signature
-- (no parameter names, no spaces, indexed flags omitted). Derived with viem's
-- toEventSelector — see scripts/derive_topics.mjs. Every hash below was
-- VALIDATED against real Ethereum-mainnet logs for the two registry addresses
-- (counts captured 2026-06-13; first on-chain activity 2026-01-29).
--
-- Confirmed mainnet addresses (the 0x8004A818.../0x8004B663... pair is SEPOLIA):
--   IdentityRegistry    0x8004A169FB4a3325136EB29fA0ceB6D2e539a432  (also Base mainnet)
--   ReputationRegistry  0x8004BAa17C55a88189AE136b182e5fdA19dE9b63  (also Base mainnet)
--
-- Observed event counts on IdentityRegistry (since 2026-01-29):
--   MetadataSet      0x2c149ed5...  52,484
--   Transfer         0xddf252ad...  49,202   <- ERC-721 mints == registrations
--   Registered       0xca52e62c...  34,453
--   MetadataUpdate   0xf8e1a15a...  17,840
--   URIUpdated       0x3a2c7fff...   1,365
--   ApprovalForAll   0x17307eab...     302
--   Approval         0x8c5be1e5...       3
--   (Upgraded/Initialized/OwnershipTransferred — proxy lifecycle, single digits)
--
-- Observed event counts on ReputationRegistry (since 2026-01-29):
--   NewFeedback      0x6a4a6174...   3,173
--   ResponseAppended 0xb1c6be0b...      37
--   FeedbackRevoked  0x25156fd3...       0   <- NEVER fires on mainnet (note below)
--
-- NOTE on FeedbackRevoked: the topic0 is derived & correct, but ZERO revocation
-- events exist on mainnet. The reputation query still LEFT JOINs it so that if
-- revocations begin, scores self-correct without a schema change.
--
-- This file is documentation + a reusable lookup. Other queries reference these
-- constants inline (BigQuery has no cross-file constants); keep them in sync.
-- =============================================================================

-- Canonical lookup table you can SELECT to sanity-check decoders.
WITH erc8004_topics AS (
  SELECT * FROM UNNEST([
    STRUCT('IdentityRegistry'   AS contract, 'Transfer'         AS event, '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' AS topic0),
    STRUCT('IdentityRegistry',   'Registered',       '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a'),
    STRUCT('IdentityRegistry',   'URIUpdated',       '0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb'),
    STRUCT('IdentityRegistry',   'MetadataSet',      '0x2c149ed548c6d2993cd73efe187df6eccabe4538091b33adbd25fafdb8a1468b'),
    STRUCT('IdentityRegistry',   'MetadataUpdate',   '0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7'),
    STRUCT('IdentityRegistry',   'ApprovalForAll',   '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31'),
    STRUCT('IdentityRegistry',   'Approval',         '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'),
    STRUCT('ReputationRegistry', 'NewFeedback',      '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc'),
    STRUCT('ReputationRegistry', 'FeedbackRevoked',  '0x25156fd3288212246d8b008d5921fde376c71ed14ac2e072a506eb06fde6d09d'),
    STRUCT('ReputationRegistry', 'ResponseAppended', '0xb1c6be0b5b8aef6539e2fac0fd131a2faa7b49edf8e505b5eb0ad487d56051d4')
  ])
)
SELECT * FROM erc8004_topics ORDER BY contract, event;
