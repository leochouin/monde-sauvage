/**
 * Shared Token Encryption Utilities
 * 
 * AES-256-GCM encryption/decryption for Google OAuth refresh tokens at rest.
 * Uses Web Crypto API (available in Deno / Edge Functions).
 *
 * SECURITY MODEL:
 * - Encryption key derived from TOKEN_ENCRYPTION_KEY env var via PBKDF2
 * - Each token gets a unique 12-byte IV (stored alongside ciphertext)
 * - GCM provides both confidentiality and authenticity
 * - Key is never logged or exposed in responses
 */

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits recommended for AES-GCM
const SALT = new TextEncoder().encode("monde-sauvage-token-salt-v1");

/**
 * Derive an AES-256 key from a passphrase using PBKDF2.
 */
async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: SALT,
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a plaintext refresh token.
 * Returns { encrypted: base64, iv: base64 }
 */
export async function encryptToken(
  plaintext: string,
  encryptionKey?: string
): Promise<{ encrypted: string; iv: string }> {
  const keyPassphrase = encryptionKey || Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!keyPassphrase) {
    console.warn("⚠️ TOKEN_ENCRYPTION_KEY not set — storing token unencrypted");
    return { encrypted: plaintext, iv: "" };
  }

  const key = await deriveKey(keyPassphrase);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoded
  );

  return {
    encrypted: uint8ArrayToBase64(new Uint8Array(ciphertext)),
    iv: uint8ArrayToBase64(iv),
  };
}

/**
 * Decrypt an encrypted refresh token.
 * Returns the plaintext token string.
 */
export async function decryptToken(
  encryptedBase64: string,
  ivBase64: string,
  encryptionKey?: string
): Promise<string> {
  const keyPassphrase = encryptionKey || Deno.env.get("TOKEN_ENCRYPTION_KEY");

  // If no encryption key or no IV, assume token is stored in plaintext (legacy)
  if (!keyPassphrase || !ivBase64) {
    return encryptedBase64;
  }

  const key = await deriveKey(keyPassphrase);
  const iv = base64ToUint8Array(ivBase64);
  const ciphertext = base64ToUint8Array(encryptedBase64);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Get the effective refresh token for a guide, handling both encrypted and legacy plaintext.
 * Prefers encrypted_refresh_token if available; falls back to google_refresh_token.
 */
export async function getEffectiveRefreshToken(guide: {
  encrypted_refresh_token?: string | null;
  token_encryption_iv?: string | null;
  google_refresh_token?: string | null;
}): Promise<string | null> {
  // Prefer encrypted token
  if (guide.encrypted_refresh_token && guide.token_encryption_iv) {
    try {
      return await decryptToken(guide.encrypted_refresh_token, guide.token_encryption_iv);
    } catch (err) {
      console.error("❌ Failed to decrypt token, falling back to plaintext:", err);
    }
  }

  // Legacy fallback: plaintext token
  return guide.google_refresh_token || null;
}

// ── Base64 helpers (Deno-compatible) ─────────────────────────────

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
