import { toBase64, fromBase64 } from './keyGen.js';

// ─── File encryption (dùng cho 1-1) ──────────────────────────────────────────
// Mã hóa raw bytes bằng SK của conversation — không có AAD vì fileIv đã đủ để chống replay
// Return: { encryptedBytes: Uint8Array, fileIv: base64 }
export async function encryptBytes(bytes, SK) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    SK,
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  );
  return { encryptedBytes: new Uint8Array(encrypted), fileIv: toBase64(iv) };
}

// Mã hóa raw bytes bằng key ngẫu nhiên (dùng cho group — upload 1 file, gửi key trong mỗi message)
// Return: { encryptedBytes, fileIv, fileKey: base64 } — fileKey được bọc trong message payload
export async function encryptBytesWithRandomKey(bytes) {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  );
  return {
    encryptedBytes: new Uint8Array(encrypted),
    fileIv: toBase64(iv),
    fileKey: toBase64(rawKey),
  };
}

// Giải mã bytes bằng SK của conversation (dùng cho 1-1)
export async function decryptBytes(encryptedBytes, fileIvB64, SK) {
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(fileIvB64) },
      SK,
      encryptedBytes instanceof Uint8Array ? encryptedBytes : new Uint8Array(encryptedBytes)
    );
    return new Uint8Array(decrypted);
  } catch {
    return null;
  }
}

// Giải mã bytes bằng fileKey base64 (dùng cho group)
export async function decryptBytesWithKey(encryptedBytes, fileIvB64, fileKeyB64) {
  try {
    const key = await crypto.subtle.importKey(
      'raw', fromBase64(fileKeyB64), 'AES-GCM', false, ['decrypt']
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(fileIvB64) },
      key,
      encryptedBytes instanceof Uint8Array ? encryptedBytes : new Uint8Array(encryptedBytes)
    );
    return new Uint8Array(decrypted);
  } catch {
    return null;
  }
}

// ─── Message encryption ───────────────────────────────────────────────────────
export async function encryptMessage(plaintext, SK, conversationId, senderId) {
  const iv  = crypto.getRandomValues(new Uint8Array(12)); // 96-bit random IV
  const aad = `${conversationId}:${senderId}`;           // authenticated, NOT encrypted

  const ciphertext = await crypto.subtle.encrypt(
    {
      name:           'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(aad), // buộc ciphertext vào đúng conv + sender
    },
    SK,
    new TextEncoder().encode(plaintext)
  );

  return {
    ciphertext: toBase64(ciphertext), // base64 string — an toàn gửi qua JSON/WebSocket
    iv:         toBase64(iv),
    aad,                              // gửi plaintext — server cần để verify, không cần bí mật
  };
}

export async function decryptMessage(ciphertextB64, ivB64, aad, SK) {
  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name:           'AES-GCM',
        iv:             fromBase64(ivB64),
        additionalData: new TextEncoder().encode(aad),
      },
      SK,
      fromBase64(ciphertextB64)
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // SK sai, IV sai, AAD bị sửa, hoặc ciphertext bị tamper → auth tag fail → decrypt throw
    return null;
  }
}
