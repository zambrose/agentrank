#!/usr/bin/env node
// Derives ERC-8004 event topic0 hashes (keccak256 of the canonical event
// signature) using viem's toEventSelector, and prints them as a table.
//
// These are the AUTHORITATIVE hashes hard-wired into the .sql files. Each one
// was cross-checked against real mainnet logs (see sql/01_topics.sql header).
//
// Run:  node scripts/derive_topics.mjs
import { toEventSelector } from 'viem';

// Canonical signatures taken verbatim from the deployed-contract ABIs:
//   https://github.com/erc-8004/erc-8004-contracts/blob/main/abis/IdentityRegistry.json
//   https://github.com/erc-8004/erc-8004-contracts/blob/main/abis/ReputationRegistry.json
const SIGNATURES = [
  // ---- IdentityRegistry (ERC-721) -------------------------------------------
  ['Transfer(address,address,uint256)', 'ERC-721 transfer; a MINT (from == 0x0) == agent registration'],
  ['Registered(uint256,string,address)', 'Agent registered: agentId(idx), agentURI, owner(idx)'],
  ['URIUpdated(uint256,string,address)', 'tokenURI/agentURI changed: agentId(idx), newURI, updatedBy(idx)'],
  ['MetadataSet(uint256,string,string,bytes)', 'Arbitrary metadata key set: agentId(idx), indexedKey(idx), key, value'],
  ['MetadataUpdate(uint256)', 'ERC-4906 single-token metadata refresh hint'],
  ['ApprovalForAll(address,address,bool)', 'ERC-721 operator approval (not used for ranking)'],
  ['Approval(address,address,uint256)', 'ERC-721 token approval (not used for ranking)'],
  // ---- ReputationRegistry ---------------------------------------------------
  ['NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)',
    'Feedback left for an agent: agentId(idx), client(idx), feedbackIndex, value(int128), valueDecimals, indexedTag1(idx), tag1, tag2, endpoint, feedbackURI, feedbackHash'],
  ['FeedbackRevoked(uint256,address,uint64)', 'Feedback revoked: agentId(idx), client(idx), feedbackIndex(idx)'],
  ['ResponseAppended(uint256,address,uint64,address,string,bytes32)',
    'Agent/3rd-party response appended: agentId(idx), client(idx), feedbackIndex, responder(idx), responseURI, responseHash'],
  // ---- Shared proxy / ownership (UUPS) --------------------------------------
  ['Upgraded(address)', 'UUPS proxy implementation upgraded'],
  ['Initialized(uint64)', 'Proxy initializer'],
  ['OwnershipTransferred(address,address)', 'Ownable ownership transfer'],
];

console.log('topic0'.padEnd(68), 'signature');
for (const [sig, note] of SIGNATURES) {
  console.log(toEventSelector(sig), sig);
  console.log(' '.repeat(68), '↳', note);
}
