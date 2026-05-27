import sodium from 'libsodium-wrappers';
import { toBase64, fromBase64 } from './keyGen.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function concat(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

async function hkdf(ikm) {
  // Bước 1: import IKM (Input Key Material) vào Web Crypto
  const keyMaterial = await crypto.subtle.importKey(
    'raw', ikm, 'HKDF', false, ['deriveKey']
  );
  // Bước 2: derive AES-GCM 256-bit key theo HKDF-SHA256
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),                    // 0x00 × 32 — theo Signal spec
      info: new TextEncoder().encode('E2EEChat_v1'), // domain separation
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,                    // extractable: true — bắt buộc để lưu IndexedDB sau này
    ['encrypt', 'decrypt']
  );
}

// ─── verify ─────────────────────────────────────────────────────────────────

export async function verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub_B) {
  await sodium.ready;
  // Ed25519 verify: kiểm tra SPK_sig là chữ ký hợp lệ của IK_priv_B trên SPK_pub_B
  // Nếu server giả mạo SPK_pub_B → chữ ký sai → return false → dừng X3DH
  return sodium.crypto_sign_verify_detached(SPK_sig, SPK_pub_B, IK_pub_B);
}

// ─── sender (Alice) ──────────────────────────────────────────────────────────

export async function performX3DH_sender(myKeys, bobBundle) {
  await sodium.ready;

  const { IK_secret, IK_pub } = myKeys;

  // bobBundle chứa base64 strings từ server → phải convert sang Uint8Array
  const IK_pub_B = fromBase64(bobBundle.ikPub);
  const SPK_pub_B = fromBase64(bobBundle.spkPub);
  const SPK_sig = fromBase64(bobBundle.spkSig);
  const OPK_pub_B = fromBase64(bobBundle.opkPub);

  // Bước 1: verify chữ ký SPK — nếu false thì dừng ngay
  const valid = await verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub_B);
  if (!valid) throw new Error('SPK signature invalid — possible MITM attack');

  // Bước 2: sinh Ephemeral Key — dùng 1 lần duy nhất cho lần chat này
  const EK = sodium.crypto_box_keypair();

  // Bước 3: convert IK Ed25519 → X25519 để dùng với crypto_scalarmult
  // IK_secret (64B Ed25519) → IK_priv (32B X25519) — cùng format SPK_priv, OPK_priv
  // IK_pub_B  (32B Ed25519) → IK_pub_B_x (32B X25519) — để tính DH2
  const IK_priv = sodium.crypto_sign_ed25519_sk_to_curve25519(IK_secret);
  const IK_pub_B_x = sodium.crypto_sign_ed25519_pk_to_curve25519(IK_pub_B);

  // Bước 4: 4 phép Diffie-Hellman — tất cả X25519, cùng format
  const DH1 = sodium.crypto_scalarmult(IK_priv, SPK_pub_B);   // mutual auth
  const DH2 = sodium.crypto_scalarmult(EK.privateKey, IK_pub_B_x); // mutual auth
  const DH3 = sodium.crypto_scalarmult(EK.privateKey, SPK_pub_B);  // forward secrecy
  const DH4 = sodium.crypto_scalarmult(EK.privateKey, OPK_pub_B);  // forward secrecy (OPK)

  // Bước 4: ghép IKM = F(0xFF×32) || DH1 || DH2 || DH3 || DH4 = 160 bytes
  const F = new Uint8Array(32).fill(0xFF); // phân biệt X25519 vs X448 theo Signal spec
  const IKM = concat(F, DH1, DH2, DH3, DH4);

  // Bước 5: HKDF → Session Key
  const SK = await hkdf(IKM);

  // Bước 6: xóa dữ liệu nhạy cảm khỏi RAM ngay sau khi tính xong tránh bị dump memory sau này
  // — Forward Secrecy: ai dump memory sau này cũng không tính lại được SK
  DH1.fill(0); DH2.fill(0); DH3.fill(0); DH4.fill(0);
  IK_priv.fill(0);      // X25519 key tạm — xóa ngay sau khi DH xong
  EK.privateKey.fill(0);

  return {
    SK,                   // CryptoKey — dùng để encrypt tin đầu tiên
    EK_pub: EK.publicKey, // Uint8Array 32 bytes — gửi cho Bob để Bob tính lại SK
    OPK_id: bobBundle.opkId, // string — Bob cần để tìm đúng OPK_priv
    IK_pub,               // Uint8Array — Bob cần để tính DH1 chiều ngược
  };
}

// ─── receiver (Bob) ──────────────────────────────────────────────────────────

export async function performX3DH_receiver(myKeys, initMsg) {
  await sodium.ready;

  const { IK_secret, SPK_priv, OPK_priv } = myKeys;
  // OPK_priv (32B X25519) — caller load từ IndexedDB trước khi gọi hàm này

  // initMsg chứa base64 strings từ tin nhắn đầu tiên của Alice
  const IK_pub_A = fromBase64(initMsg.ikPub);
  const EK_pub_A = fromBase64(initMsg.ekPub);

  // Convert IK Ed25519 → X25519: cùng logic với sender
  // IK_secret (64B Ed25519) → IK_priv (32B X25519) — cùng format SPK_priv, OPK_priv
  // IK_pub_A  (32B Ed25519) → IK_pub_A_x (32B X25519)
  const IK_priv = sodium.crypto_sign_ed25519_sk_to_curve25519(IK_secret);
  const IK_pub_A_x = sodium.crypto_sign_ed25519_pk_to_curve25519(IK_pub_A);

  // 4 phép DH chiều ngược — tất cả X25519, ra cùng kết quả với sender
  const DH1 = sodium.crypto_scalarmult(SPK_priv, IK_pub_A_x); // đối xứng DH1 Alice
  const DH2 = sodium.crypto_scalarmult(IK_priv, EK_pub_A);   // đối xứng DH2 Alice
  const DH3 = sodium.crypto_scalarmult(SPK_priv, EK_pub_A);   // đối xứng DH3 Alice
  const DH4 = sodium.crypto_scalarmult(OPK_priv, EK_pub_A);   // đối xứng DH4 Alice

  const F = new Uint8Array(32).fill(0xFF);
  const IKM = concat(F, DH1, DH2, DH3, DH4);

  const SK = await hkdf(IKM);

  DH1.fill(0); DH2.fill(0); DH3.fill(0); DH4.fill(0);
  IK_priv.fill(0);   // X25519 key tạm — xóa ngay sau khi DH xong
  OPK_priv.fill(0);  // OPK đã dùng → xóa, không dùng lại bao giờ

  return { SK };
}

export { toBase64, fromBase64 };
