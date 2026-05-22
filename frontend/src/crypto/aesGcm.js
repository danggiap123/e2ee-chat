import { toBase64, fromBase64 } from './keyGen.js';

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
