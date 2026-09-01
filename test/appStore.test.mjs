// test/appStore.test.mjs
//
// Web3 App Store client coverage for appStore.js's request-building/
// response-shaping and submitListing()'s signed-message construction.
// Stubs global fetch (this module's own network boundary, not logic
// under test) — same rationale backup.test.mjs/metadata.js's module
// comment give: what's actually being verified is THIS module's request
// shape, matching what api/apps/submit/route.js (the dApp repo) expects.
//
// Run with: node --test test/appStore.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { AppStore } from "../src/appStore.js";
import { InayaValidationError, InayaNetworkError } from "../src/errors.js";

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => handler(url, options);
  return () => { globalThis.fetch = original; };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fakeSigner({ address = "0xAbC0000000000000000000000000000000dEaD", signMessage } = {}) {
  return {
    getAddress: async () => address,
    signMessage: signMessage || (async (msg) => `0xsig(${msg.length})`),
  };
}

test("submitListing: rejects missing name/description/hostType before ever touching the signer or the network", async () => {
  await assert.rejects(() => AppStore.submitListing({ connection: fakeSigner(), name: "", description: "x", hostType: "ipfs", cid: "Qm123" }), InayaValidationError);
  await assert.rejects(() => AppStore.submitListing({ connection: fakeSigner(), name: "App", description: "", hostType: "ipfs", cid: "Qm123" }), InayaValidationError);
  await assert.rejects(() => AppStore.submitListing({ connection: fakeSigner(), name: "App", description: "x", hostType: "carrier-pigeon" }), InayaValidationError);
});

test("submitListing: hostType ipfs requires cid, hostType iframe requires embedUrl", async () => {
  await assert.rejects(() => AppStore.submitListing({ connection: fakeSigner(), name: "App", description: "x", hostType: "ipfs" }), InayaValidationError);
  await assert.rejects(() => AppStore.submitListing({ connection: fakeSigner(), name: "App", description: "x", hostType: "iframe" }), InayaValidationError);
});

test("submitListing (ipfs): signs a canonical 'Inaya Metadata Action' message over 'ipfs:<cid>' with name as an extra field, POSTs the full auth tuple", async () => {
  let capturedUrl, capturedBody, signedMessage;
  const restore = stubFetch(async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return jsonResponse(200, { slug: "my-app-abc123", status: "pending" });
  });
  try {
    const signer = fakeSigner({
      address: "0x1111111111111111111111111111111111111a",
      signMessage: async (msg) => { signedMessage = msg; return "0xdeadbeef"; },
    });
    const result = await AppStore.submitListing({
      connection: signer, name: "My App", description: "A test app.", category: "Tools",
      hostType: "ipfs", cid: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", apiBaseUrl: "https://example.test",
    });

    assert.equal(capturedUrl, "https://example.test/api/apps/submit");
    assert.equal(result.slug, "my-app-abc123");
    assert.equal(capturedBody.address, "0x1111111111111111111111111111111111111a");
    assert.equal(capturedBody.signature, "0xdeadbeef");
    assert.equal(capturedBody.cid, "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG");

    // The exact message shape verifyMetadataAuth() (dApp repo) recomputes and compares —
    // resourceId must be "ipfs:<RAW cid>", never re-derived, and must include the "name" extra
    // field, matching appStoreListings.js's submitAppListing() exactly.
    assert.match(signedMessage, /^Inaya Metadata Action\n/);
    assert.match(signedMessage, /\naction: submitAppListing\n/);
    assert.match(signedMessage, /\nresourceId: ipfs:QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG\n/);
    assert.match(signedMessage, /\nname: My App\n/);
    assert.match(signedMessage, /\ntimestamp: \d+$/);
    assert.equal(capturedBody.message, signedMessage);
  } finally {
    restore();
  }
});

test("submitListing (iframe): resourceId uses the RAW embedUrl exactly as passed, never re-normalized", async () => {
  // A real bug this mirrors: new URL("https://example.com").toString() adds a trailing slash,
  // which would make the server's recomputed resourceId diverge from what was actually signed
  // if either side normalized the URL. This client must never do that.
  let signedMessage;
  const restore = stubFetch(async () => jsonResponse(200, { slug: "iframe-app-xyz", status: "pending" }));
  try {
    const signer = fakeSigner({ signMessage: async (msg) => { signedMessage = msg; return "0xsig"; } });
    await AppStore.submitListing({
      connection: signer, name: "Iframe App", description: "x", hostType: "iframe", embedUrl: "https://example.com",
    });
    assert.match(signedMessage, /\nresourceId: iframe:https:\/\/example\.com\n/);
  } finally {
    restore();
  }
});

test("submitListing: a non-ok response is translated into an InayaNetworkError carrying the server's error message", async () => {
  const restore = stubFetch(async () => jsonResponse(400, { error: "That doesn't look like a valid IPFS CID." }));
  try {
    await assert.rejects(
      () => AppStore.submitListing({ connection: fakeSigner(), name: "App", description: "x", hostType: "ipfs", cid: "not-a-cid" }),
      (err) => { assert.ok(err instanceof InayaNetworkError); assert.match(err.message, /valid IPFS CID/); return true; }
    );
  } finally {
    restore();
  }
});

test("getListings: GETs /api/apps/listings with no auth required", async () => {
  let capturedUrl;
  const restore = stubFetch(async (url) => {
    capturedUrl = url;
    return jsonResponse(200, { listings: [{ slug: "app-1", status: "approved" }] });
  });
  try {
    const result = await AppStore.getListings({ apiBaseUrl: "https://example.test" });
    assert.equal(capturedUrl, "https://example.test/api/apps/listings");
    assert.equal(result.listings.length, 1);
  } finally {
    restore();
  }
});

test("getMyListings: rejects a missing address before touching the network", async () => {
  await assert.rejects(() => AppStore.getMyListings({ address: "" }), InayaValidationError);
});

test("getMyListings: GETs /api/apps/my-listings with address as a query param, returns every status (not just approved)", async () => {
  let capturedUrl;
  const restore = stubFetch(async (url) => {
    capturedUrl = url;
    return jsonResponse(200, { listings: [{ slug: "app-1", status: "pending" }, { slug: "app-2", status: "rejected" }] });
  });
  try {
    const result = await AppStore.getMyListings({ address: "0xabc", apiBaseUrl: "https://example.test" });
    assert.equal(capturedUrl, "https://example.test/api/apps/my-listings?address=0xabc");
    assert.deepEqual(result.listings.map((l) => l.status), ["pending", "rejected"]);
  } finally {
    restore();
  }
});
