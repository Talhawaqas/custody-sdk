// ============================================================
// crypto.js — PBKDF2 key derivation, AES-GCM-256 encryption,
// and binary midpoint sharding.
//
// Ported from the working implementation already live in the
// Inaya dApp (page.js: encryptData / decryptData / prepareShardedFile),
// refactored into the derive-once API documented in the SDK guide
// instead of re-deriving the key on every call.
// ============================================================

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return typeof window !== "undefined" ? window.btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}

function fromBase64(b64) {
  const binary = typeof window !== "undefined" ? window.atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Generates a cryptographically secure random salt of the given byte length. */
export function generateSecureSalt(bytes = SALT_BYTES) {
  return crypto.getRandomValues(new Uint8Array(bytes));
}

/**
 * Derives the local PBKDF2 vault key wrapper once, so it can be reused
 * across multiple disperseAndSlice() calls without re-deriving each time.
 */
const HASH_NAME_MAP = {
  "HMAC-SHA256": "SHA-256",
  "HMAC-SHA384": "SHA-384",
  "HMAC-SHA512": "SHA-512",
};

export async function deriveVaultKey({ passkey, salt, iterations = PBKDF2_ITERATIONS, algo = "HMAC-SHA256" }) {
  if (!passkey) throw new Error("InayaKernel.deriveVaultKey: passkey is required.");
  const hash = HASH_NAME_MAP[algo];
  if (!hash) throw new Error(`InayaKernel.deriveVaultKey: unsupported algo "${algo}". Use one of: ${Object.keys(HASH_NAME_MAP).join(", ")}.`);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passkey), { name: "PBKDF2" }, false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  return { key, salt, iterations, algo };
}

/**
 * Encrypts a file with AES-GCM-256 using an already-derived vault key,
 * then bisects the resulting ciphertext at its exact byte midpoint.
 * Neither shard alone contains contiguous bit structures.
 */
export async function disperseAndSlice({ file, encryptionKey }) {
  if (!file) throw new Error("InayaKernel.disperseAndSlice: file is required.");
  if (!encryptionKey?.key) throw new Error("InayaKernel.disperseAndSlice: a vault key from deriveVaultKey() is required.");

  const dataUrl = await readFileAsDataURL(file);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, encryptionKey.key, enc.encode(dataUrl));

  // Pack salt + iv + ciphertext together so decryption only needs the passkey.
  const combined = new Uint8Array(encryptionKey.salt.length + iv.length + encrypted.byteLength);
  combined.set(encryptionKey.salt, 0);
  combined.set(iv, encryptionKey.salt.length);
  combined.set(new Uint8Array(encrypted), encryptionKey.salt.length + iv.length);

  const cipherTextString = toBase64(combined);
  const midpoint = Math.ceil(cipherTextString.length / 2);

  return {
    filename: file.name,
    shardAlpha: cipherTextString.slice(0, midpoint),
    shardBeta: cipherTextString.slice(midpoint),
  };
}

/**
 * Reassembles Shard Alpha + Shard Beta and decrypts back to the original
 * file using only the passkey — mirrors the dApp's existing reconstruct flow.
 */
export async function reconstructAndDecrypt({ shardAlpha, shardBeta, passkey }) {
  if (!passkey) throw new Error("InayaKernel.reconstructAndDecrypt: passkey is required.");
  const fullCipherText = shardAlpha + shardBeta;
  const combined = fromBase64(fullCipherText);

  const salt = combined.slice(0, SALT_BYTES);
  const iv = combined.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const encrypted = combined.slice(SALT_BYTES + IV_BYTES);

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passkey), { name: "PBKDF2" }, false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const decryptedBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  const dataUrl = new TextDecoder().decode(decryptedBuffer);
  return dataUrl; // data: URL — same shape the dApp already renders/downloads from
}
