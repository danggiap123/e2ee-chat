import sodium from 'libsodium-wrappers';

// ─── helpers ────────────────────────────────────────────────────────────────

function toBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

function encode(str) {
  return new TextEncoder().encode(str);
}

// ─── key generation ─────────────────────────────────────────────────────────

export async function generateIdentityKey() {
  await sodium.ready;
  // Dùng crypto_sign_keypair() thay vì crypto_box_keypair() vì:
  // - IK cần ký SPK bằng Ed25519 → cần Ed25519 secret key (64 bytes)
  // - crypto_box_keypair() sinh X25519 key (32 bytes) → crypto_sign_detached sẽ lỗi "invalid privateKey length"
  // - Khi dùng IK trong DH: chuyển sang X25519 bằng crypto_sign_ed25519_sk/pk_to_curve25519()
  const pair = sodium.crypto_sign_keypair();
  return {
    IK_pub:  pair.publicKey,   // Uint8Array 32 bytes — Ed25519 public key
    IK_priv: pair.privateKey,  // Uint8Array 64 bytes — Ed25519 secret key (seed + pub ghép lại)
  };
}

export async function generateSignedPreKey(IK_priv) {
  await sodium.ready;
  const pair = sodium.crypto_box_keypair();
  // Ed25519 sign: IK_priv ký lên SPK_pub → bất kỳ ai có IK_pub đều verify được
  const SPK_sig = sodium.crypto_sign_detached(pair.publicKey, IK_priv);
  return {
    SPK_pub:  pair.publicKey,   // Uint8Array 32 bytes
    SPK_priv: pair.privateKey,  // Uint8Array 32 bytes
    SPK_sig,                    // Uint8Array 64 bytes (Ed25519 signature)
  };
}

export async function generateOneTimePreKeys(n = 100) {
  await sodium.ready;
  return Array.from({ length: n }, () => {
    const pair = sodium.crypto_box_keypair();
    return {
      id:       crypto.randomUUID(), // string UUID — dùng để server + client đối chiếu
      OPK_pub:  pair.publicKey,
      OPK_priv: pair.privateKey,
    };
  });
}

// ─── wrapping key (PBKDF2) ──────────────────────────────────────────────────

export async function deriveWrappingKey(password, salt) {
  // Bước 1: import password thô vào dạng Web Crypto hiểu được
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encode(password),
    'PBKDF2',     // chỉ dùng để derive, không encrypt trực tiếp
    false,        // không thể export ra ngoài
    ['deriveKey'] // chỉ dùng để tạo key mới
  );

  // Bước 2: derive AES-GCM key từ password + salt bằng PBKDF2
  return crypto.subtle.deriveKey(
    {
      name:       'PBKDF2',
      salt,                     // Uint8Array 16 bytes — phải khác nhau mỗi user
      iterations: 600_000,      // 600k vòng — OWASP 2023 minimum cho PBKDF2-SHA256
      hash:       'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 }, // output là AES-256 key
    false,        // wrappingKey không được export — chỉ dùng để encrypt/decrypt
    ['encrypt', 'decrypt']
  );
}

// ─── wrap / unwrap individual key ───────────────────────────────────────────

export async function wrapPrivateKey(privKey, wrappingKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 12 bytes = 96 bits, chuẩn AES-GCM
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    wrappingKey,
    privKey // Uint8Array
  );
  return {
    wrapped: toBase64(wrapped), // string — an toàn để lưu IndexedDB
    iv:      toBase64(iv),
  };
}

export async function unwrapPrivateKey(wrappedB64, ivB64, wrappingKey) {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivB64) },
    wrappingKey,
    fromBase64(wrappedB64)
  );
  // Nếu wrappingKey sai (password sai) → decrypt throw DOMException
  // → AuthContext.login() bắt lỗi này và throw 'Sai mật khẩu'
  return new Uint8Array(decrypted);
}

// ─── re-export helpers (dùng ở nhiều nơi khác) ──────────────────────────────

export { toBase64, fromBase64 };
