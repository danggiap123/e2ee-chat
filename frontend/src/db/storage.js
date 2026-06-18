import Dexie from 'dexie';
import { wrapPrivateKey, unwrapPrivateKey, toBase64, fromBase64 } from '../crypto/keyGen.js';

// ─── khởi tạo database ───────────────────────────────────────────────────────

const db = new Dexie('E2EEChatDB');

db.version(1).stores({
  // primaryKey = userId — mỗi user có đúng 1 bộ key trên thiết bị này
  privateKeys: 'userId',
  // { userId, wrapSalt, wrappedIK, ivIK, wrappedSPK, ivSPK, wrappedOPKs: [{id,wrapped,iv}] }

  // primaryKey = conversationId — mỗi conversation có 1 session key
  sessions: 'conversationId',
  // { conversationId, wrappedSK, ivSK }
});

// ─── private keys ────────────────────────────────────────────────────────────

/**
 * Lưu toàn bộ private key của user vào IndexedDB, đã được mã hóa bằng wrappingKey.
 *
 * @param {string}     userId      - UUID của user (từ server)
 * @param {Uint8Array} wrapSalt    - 16 bytes ngẫu nhiên dùng để derive wrappingKey (PBKDF2)
 * @param {CryptoKey}  wrappingKey - AES-GCM key đã derive từ password (PBKDF2), không lưu thẳng
 * @param {Uint8Array} IK_secret   - 64B Ed25519 secret key (seed 32B + pub 32B); IK_pub = slice(32)
 * @param {Uint8Array} SPK_priv    - 32B X25519 private key của Signed PreKey
 * @param {Array<{id: string, OPK_priv: Uint8Array}>} opkList - mảng 100 OPK, mỗi phần tử gồm id (UUID) và OPK_priv (32B X25519)
 */
export async function savePrivateKeys(userId, wrapSalt, wrappingKey, IK_secret, SPK_priv, opkList) {
  // Wrap từng key riêng bằng AES-GCM — cùng wrappingKey, khác IV mỗi cái
  // Quan trọng: wrappingKey đã derive sẵn → PBKDF2 chỉ chạy 1 lần, không chạy lại ở đây
  // IK_pub KHÔNG wrap riêng vì nó = IK_secret.slice(32) — recover khi load
  const { wrapped: wrappedIK, iv: ivIK  } = await wrapPrivateKey(IK_secret, wrappingKey);
  const { wrapped: wrappedSPK, iv: ivSPK } = await wrapPrivateKey(SPK_priv, wrappingKey);

  // Wrap từng OPK — mỗi OPK có IV riêng ngẫu nhiên
  const wrappedOPKs = await Promise.all(
    opkList.map(async ({ id, OPK_priv }) => {
      const { wrapped, iv } = await wrapPrivateKey(OPK_priv, wrappingKey);
      return { id, wrapped, iv };
    })
  );

  // Lưu vào IndexedDB (upsert — put ghi đè nếu userId đã tồn tại)
  await db.privateKeys.put({
    userId,
    wrapSalt: toBase64(wrapSalt), // base64 string — IndexedDB không store Uint8Array tốt
    wrappedIK, ivIK,
    wrappedSPK, ivSPK,
    wrappedOPKs,                  // array of { id, wrapped, iv }
  });
}

/**
 * Load và unwrap toàn bộ private key từ IndexedDB.
 * Nếu password sai → unwrapPrivateKey throw DOMException → caller bắt lỗi này.
 *
 * @returns {{ wrapSalt, IK_secret, IK_pub, SPK_priv, opkMap }}
 *   opkMap = Map<id, OPK_priv> — tra cứu O(1) khi cần OPK_priv cho X3DH receiver
 */
export async function loadPrivateKeys(userId, wrappingKey) {
  const record = await db.privateKeys.get(userId);
  if (!record) return null; // user chưa đăng ký trên thiết bị này

  const IK_secret = await unwrapPrivateKey(record.wrappedIK,  record.ivIK,  wrappingKey);
  const IK_pub    = IK_secret.slice(32); // Ed25519 secret = seed(32B) + pub(32B)
  const SPK_priv  = await unwrapPrivateKey(record.wrappedSPK, record.ivSPK, wrappingKey);

  // Build Map<id → OPK_priv> để lookup O(1) trong performX3DH_receiver
  const opkMap = new Map();
  for (const { id, wrapped, iv } of record.wrappedOPKs) {
    const OPK_priv = await unwrapPrivateKey(wrapped, iv, wrappingKey);
    opkMap.set(id, OPK_priv);
  }

  return {
    wrapSalt: fromBase64(record.wrapSalt), // Uint8Array — cần để re-derive wrappingKey sau logout
    IK_secret,
    IK_pub,
    SPK_priv,
    opkMap,
  };
}

/**
 * Trả wrapSalt (Uint8Array) để re-derive wrappingKey khi login/unlock.
 * Gọi trước deriveWrappingKey() — cần salt trước khi có wrappingKey.
 * @returns {Uint8Array|null}
 */
export async function getWrapSalt(userId) {
  const record = await db.privateKeys.get(userId);
  if (!record) return null;
  return fromBase64(record.wrapSalt);
}

/** Trả true nếu user đã có private key trên thiết bị này */
export async function hasPrivateKeys(userId) {
  const count = await db.privateKeys.where('userId').equals(userId).count();
  return count > 0;
}

/**
 * Unwrap đúng 1 OPK theo id — dùng trong X3DH receiver thay vì loadPrivateKeys.
 * Chỉ decrypt 1 AES-GCM thay vì 100 → nhanh hơn ~100×.
 * @returns {Uint8Array|null} OPK_priv, hoặc null nếu không tìm thấy opkId
 */
export async function getOPK(userId, opkId, wrappingKey) {
  const record = await db.privateKeys.get(userId);
  if (!record) return null;

  const found = record.wrappedOPKs.find(o => o.id === opkId);
  if (!found) return null;

  return unwrapPrivateKey(found.wrapped, found.iv, wrappingKey);
}

/**
 * Xóa 1 OPK đã dùng xong khỏi IndexedDB.
 * Gọi sau performX3DH_receiver — OPK dùng 1 lần, không được tái sử dụng.
 */
export async function deleteOPK(userId, opkId) {
  await db.privateKeys
    .where('userId').equals(userId)
    .modify(record => {
      record.wrappedOPKs = record.wrappedOPKs.filter(o => o.id !== opkId);
    });
}

// ─── session keys ─────────────────────────────────────────────────────────────

/**
 * Lưu Session Key (SK) vào IndexedDB sau khi wrap bằng wrappingKey.
 * SK phải được import với extractable: true (đã làm trong hkdf() của x3dh.js).
 *
 * @param {string}    conversationId
 * @param {CryptoKey} SK            - AES-256-GCM key từ X3DH
 * @param {CryptoKey} wrappingKey   - cùng key dùng để wrap private keys
 */
export async function saveSession(conversationId, SK, wrappingKey) {
  // Export SK ra raw bytes → wrap bằng AES-GCM → lưu
  // Cần export vì CryptoKey không thể lưu thẳng vào IndexedDB
  const rawSK = new Uint8Array(await crypto.subtle.exportKey('raw', SK));
  const { wrapped: wrappedSK, iv: ivSK } = await wrapPrivateKey(rawSK, wrappingKey);
  rawSK.fill(0); // xóa raw bytes khỏi RAM ngay sau khi wrap xong

  await db.sessions.put({ conversationId, wrappedSK, ivSK });
}

/**
 * Load và unwrap Session Key từ IndexedDB.
 * @returns {CryptoKey|null} - AES-256-GCM key, hoặc null nếu chưa có session
 */
export async function loadSession(conversationId, wrappingKey) {
  const record = await db.sessions.get(conversationId);
  if (!record) return null;

  // Unwrap raw bytes → import lại thành CryptoKey để dùng cho encrypt/decrypt
  const rawSK = await unwrapPrivateKey(record.wrappedSK, record.ivSK, wrappingKey);
  const SK = await crypto.subtle.importKey(
    'raw', rawSK,
    { name: 'AES-GCM', length: 256 },
    true,                    // extractable: true — để có thể re-wrap sau khi đổi password
    ['encrypt', 'decrypt']
  );
  rawSK.fill(0); // xóa raw bytes ngay sau khi import

  return SK;
}

/** Xóa session key bị hỏng (wrappingKey không khớp) — gọi trước khi tạo lại X3DH */
export async function deleteSession(conversationId) {
  await db.sessions.delete(conversationId);
}

// ─── export / import .e2ee (chuyển thiết bị) ─────────────────────────────────

/**
 * Xuất toàn bộ dữ liệu đã mã hóa ra file .e2ee để chuyển sang thiết bị khác.
 * File chỉ chứa ciphertext — không có plaintext private key hay password.
 * Người khác lấy được file này vẫn KHÔNG thể giải mã nếu không biết password.
 */
export async function exportKeysToFile(userId) {
  const record = await db.privateKeys.get(userId);
  if (!record) throw new Error('Không tìm thấy key cho userId này');

  const sessions = await db.sessions.toArray();

  const payload = JSON.stringify({ version: 1, privateKeys: record, sessions });
  const blob = new Blob([payload], { type: 'application/octet-stream' });

  // Trigger download trình duyệt
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = `e2ee-keys-${userId.slice(0, 8)}.e2ee`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import file .e2ee vào thiết bị mới.
 * Sau khi import, user cần nhập đúng password để unlock (vì data vẫn mã hóa bằng password cũ).
 *
 * @param {File} file - File object từ <input type="file">
 */
export async function importKeysFromFile(file) {
  const text    = await file.text();
  const payload = JSON.parse(text);

  if (payload.version !== 1) throw new Error('File .e2ee không đúng phiên bản');

  // Ghi vào IndexedDB — ghi đè nếu đã có
  await db.privateKeys.put(payload.privateKeys);
  for (const session of payload.sessions) {
    await db.sessions.put(session);
  }
}
