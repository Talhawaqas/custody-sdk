// src/pqc.js
//
// SDK-facing Pqc namespace (Internxt-inspired SOW, Workstream A). Unlike
// competitive.js's Shares/Governance/etc (thin REST clients calling the
// server's public API), every function here runs entirely on the caller's
// own device and never makes a network call -- consistent with the ADR's
// "private keys never leave the client" rule. A device's own secretKey
// from generateDeviceKeyPair() is the caller's to store (OS keychain /
// expo-secure-store / a non-extractable Web Crypto wrapping key, same
// pattern already used for MLS chat device keys) and to never transmit.
//
// See docs/architecture/pqc-architecture-adr.md (inaya-network-dapp repo)
// for the full design.

export { ALGORITHM_ID, capabilityInfo } from "./pqc/provider.js";
export { ENVELOPE_VERSION, wrapContentKeyHybrid, unwrapContentKeyHybrid, isHybridEnvelope } from "./pqc/envelope.js";

import { ALGORITHM_ID, capabilityInfo, generateKeyPair } from "./pqc/provider.js";
import { ENVELOPE_VERSION, wrapContentKeyHybrid, unwrapContentKeyHybrid, isHybridEnvelope } from "./pqc/envelope.js";

/** Generates one PQC device key pair. Call once per device, on the device; store secretKey locally, register publicKey with the server. */
export function generateDeviceKeyPair() {
  return generateKeyPair(ALGORITHM_ID);
}

export const Pqc = {
  ALGORITHM_ID,
  ENVELOPE_VERSION,
  capabilityInfo,
  generateDeviceKeyPair,
  wrapContentKeyHybrid,
  unwrapContentKeyHybrid,
  isHybridEnvelope,
};

export default Pqc;
