import { Buffer } from "node:buffer";

// The encryption key is a Worker secret, independent of the authentication secret.
export const CONTENT_ENCODING = "aes-256-gcm-v1";
const encoder = new TextEncoder();

export async function contentKey(secret: string | undefined) {
  if (!secret || !/^[a-fA-F0-9]{64}$/.test(secret))
    throw new Error("CONTENT_ENCRYPTION_KEY must be a 32-byte hexadecimal key");
  const bytes = Uint8Array.from(secret.match(/../g) ?? [], (b) =>
    Number.parseInt(b, 16),
  );
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptContent(
  key: CryptoKey,
  id: string,
  plaintext: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(`${CONTENT_ENCODING}:${id}`),
      tagLength: 128,
    },
    key,
    encoder.encode(plaintext),
  );
  return `${Buffer.from(iv).toString("base64")}.${Buffer.from(encrypted).toString("base64")}`;
}

export async function decryptContent(
  key: CryptoKey,
  id: string,
  stored: string,
) {
  try {
    const parts = stored.split(".");
    if (parts.length !== 2) throw new Error("Invalid envelope");
    const iv = Buffer.from(parts[0], "base64");
    const ciphertext = Buffer.from(parts[1], "base64");
    if (iv.length !== 12 || ciphertext.length < 16)
      throw new Error("Invalid envelope");
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(`${CONTENT_ENCODING}:${id}`),
        tagLength: 128,
      },
      key,
      ciphertext,
    );
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      plaintext,
    );
  } catch {
    // Never return corrupt ciphertext as plaintext or log its contents.
    throw new Error("Content decryption failed");
  }
}
