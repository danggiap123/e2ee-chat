# Bản đồ Crypto — File nào, hàm nào, thư viện nào

## NGUYÊN TẮC QUAN TRỌNG NHẤT
Toàn bộ mã hóa/giải mã xảy ra ở FRONTEND (browser).
Server KHÔNG có bất kỳ hàm crypto nào liên quan đến nội dung tin nhắn.
Server chỉ dùng bcrypt (cost 12) để hash password — không liên quan đến E2EE.

## Thư viện nào dùng cho gì

| Thư viện | Dùng cho | Lý do chọn |
|---|---|---|
| libsodium-wrappers | X25519, Ed25519 | Web Crypto API không hỗ trợ X25519/Ed25519 đủ rộng |
| Web Crypto API | AES-GCM, HKDF, PBKDF2, SHA-512 | Native browser, đã hỗ trợ rộng, không cần thư viện ngoài |
| bcrypt (npm) | Hash password phía server | cost factor 12 = 4096 vòng lặp, ~300ms/hash, đủ chậm để chống brute force |

---

## frontend/src/crypto/keyGen.js

| Hàm | Thư viện | Input | Output | Ghi chú |
|-----|----------|-------|--------|---------|
| `generateIdentityKey()` | libsodium | — | `{ IK_pub, IK_priv }` (Uint8Array) | Keypair X25519, vĩnh viễn |
| `generateSignedPreKey(IK_priv)` | libsodium | IK_priv | `{ SPK_pub, SPK_priv, SPK_sig }` | SPK_sig = Ed25519.sign(IK_priv, SPK_pub) |
| `generateOneTimePreKeys(n=100)` | libsodium | n | `[{ id, OPK_pub, OPK_priv }]` | id = `crypto.randomUUID()`, OPK_pub/priv là Uint8Array |
| `wrapPrivateKey(privKey, password)` | Web Crypto | privKey (Uint8Array), password (string) | `{ wrapped (base64), salt (base64) }` | PBKDF2(600k) → AES-GCM encrypt |
| `unwrapPrivateKey(wrapped, salt, password)` | Web Crypto | wrapped, salt, password | privKey (Uint8Array) | Ngược lại wrapPrivateKey |

**Chi tiết wrapPrivateKey:**
```
salt        = crypto.getRandomValues(16 bytes)
wrappingKey = PBKDF2-SHA256(password, salt, 600_000 iterations, 32 bytes)
wrapped     = AES-256-GCM encrypt(privKey, wrappingKey, IV=random 12 bytes)
lưu IndexedDB: { wrapped, salt, iv }
```

**Format OPK khi upload lên server vs lưu IndexedDB:**
```
Upload lên server (POST /keys/upload, opkPubs[]):
  { id: string, pub: base64(OPK_pub) }   ← server chỉ cần public key

Lưu vào IndexedDB (privateKeys.wrappedOPKs[]):
  { id: string, wrappedOPK: base64, salt: base64, iv: base64 }
                                          ← id PHẢI KHỚP với id gửi lên server
                                          ← cần id để tra khi Bob nhận message.opkId
```

---

## frontend/src/crypto/x3dh.js

| Hàm | Input | Output | Ghi chú |
|-----|-------|--------|---------|
| `verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub_B)` | 3 Uint8Array | boolean | Ed25519.verify — **GỌI TRƯỚC KHI X3DH** — false → throw error, không được tiếp tục |
| `performX3DH_sender(myKeys, bobBundle)` | Alice keys + Bob bundle (`ikPub, spkPub, opkPub`) | `{ SK (CryptoKey), EK_pub (base64) }` | Tính 4 DH + HKDF, xóa EK_priv sau khi xong |
| `performX3DH_receiver(myKeys, initMsg)` | Bob keys + init msg (`ekPub, opkId, ikPub_A`) | `{ SK (CryptoKey) }` | Tính 4 DH chiều ngược + HKDF |

**Thứ tự bắt buộc khi Alice khởi tạo chat với Bob (sender flow):**
```
1. GET /keys/:bobId  →  nhận { ikPub, spkPub, spkSig, opkPub, opkId }
2. verifySignedPreKey(ikPub, spkSig, spkPub)  →  false → DỪNG, không tiếp tục
3. performX3DH_sender(...)  →  { SK, EK_pub }
4. POST /messages { ..., ekPub: EK_pub, opkId, ikPub: base64(IK_pub_A) }
```

**Chi tiết 4 phép DH trong performX3DH_sender:**
```javascript
DH1 = sodium.crypto_scalarmult(IK_priv_A,  SPK_pub_B)
DH2 = sodium.crypto_scalarmult(EK_priv_A,  IK_pub_B)
DH3 = sodium.crypto_scalarmult(EK_priv_A,  SPK_pub_B)
DH4 = sodium.crypto_scalarmult(EK_priv_A,  OPK_pub_B)
F   = new Uint8Array(32).fill(0xFF)
IKM = concat(F, DH1, DH2, DH3, DH4)           // 32+32+32+32+32 = 160 bytes
SK  = HKDF-SHA256(IKM, salt=0x00×32, info="E2EEChat_v1", length=32)
// XÓA EK_priv_A, DH1, DH2, DH3, DH4 ngay sau đây
```

**Chi tiết performX3DH_receiver — Bob nhận tin đầu tiên:**
```javascript
// Bob lấy OPK_priv từ IndexedDB bằng message.opkId:
const opkEntry = wrappedOPKs.find(o => o.id === message.opkId)
OPK_priv_B = unwrapPrivateKey(opkEntry.wrappedOPK, opkEntry.salt, opkEntry.iv, password)

DH1 = sodium.crypto_scalarmult(SPK_priv_B, IK_pub_A)   // IK_pub_A = message.ikPub
DH2 = sodium.crypto_scalarmult(IK_priv_B,  EK_pub_A)   // EK_pub_A = message.ekPub
DH3 = sodium.crypto_scalarmult(SPK_priv_B, EK_pub_A)
DH4 = sodium.crypto_scalarmult(OPK_priv_B, EK_pub_A)
SK  = HKDF-SHA256(F||DH1||DH2||DH3||DH4, ...) → ra cùng SK với Alice
// XÓA OPK_priv_B đã dùng khỏi IndexedDB
```

---

## frontend/src/crypto/aesGcm.js

| Hàm | Input | Output | Ghi chú |
|-----|-------|--------|---------|
| `encryptMessage(plaintext, SK, senderId, receiverId)` | string, CryptoKey, string, string | `{ ciphertext, iv, aad }` (base64) | IV random 12 bytes mỗi lần |
| `decryptMessage(ciphertext, iv, aad, SK)` | base64 × 3, CryptoKey | plaintext (string) | Throw nếu auth_tag sai |

**AAD format:**
```javascript
const aad = `${conversationId}:${senderId}`
// AAD không được mã hóa nhưng được xác thực bởi AES-GCM auth tag
// Nếu ai sửa conversationId hoặc senderId → auth tag sai → decrypt throw error
// Không dùng timestamp vì server đã tự tạo createdAt khi lưu DB
```

---

## frontend/src/crypto/fingerprint.js

| Hàm | Input | Output |
|-----|-------|--------|
| `generateFingerprint(IK_pub_A, IK_pub_B)` | 2 Uint8Array | string (60 chữ số) |

**Cách tính:**
```javascript
// Sort canonical để cả 2 bên ra cùng kết quả dù ai gọi trước
const sorted = [IK_pub_A, IK_pub_B].sort((a, b) => compare(a, b))
const combined = concat(sorted[0], sorted[1])
let hash = await SHA-512(combined)
for (let i = 0; i < 5199; i++) hash = await SHA-512(hash)  // 5200 vòng tổng
const fingerprint = BigInt('0x' + toHex(hash)) % BigInt(10**60)
return fingerprint.toString().padStart(60, '0')
```

---

## frontend/src/db/storage.js (Dexie.js)

| Store (bảng IndexedDB) | Lưu gì | Key |
|---|---|---|
| `privateKeys` | `{ userId, wrappedIK, saltIK, ivIK, wrappedSPK, saltSPK, ivSPK, wrappedOPKs[] }` | userId |
| `sessions` | `{ conversationId, wrappedSK, saltSK, ivSK }` | conversationId |
| `messages` | `{ id, conversationId, plaintext, timestamp }` | id |

**Format của `wrappedOPKs[]` trong `privateKeys` store:**
```javascript
wrappedOPKs: [
  { id: "uuid-khớp-với-server", wrappedOPK: "base64", salt: "base64", iv: "base64" },
  // ... 99 cái còn lại
]
// QUAN TRỌNG: id ở đây phải KHỚP CHÍNH XÁC với id gửi lên server lúc upload
// Bob dùng message.opkId để .find(o => o.id === message.opkId) → unwrap → giải mã
```

**Tại sao lưu wrappedSK (Session Key) vào IndexedDB?**
Mỗi lần reload trang, không thể chạy lại X3DH vì OPK đã bị xóa.
→ SK phải được lưu lại (dạng đã wrap bằng password).

---

## backend/routes/auth.js

```
POST /auth/register
  Body: { username, password, IK_pub, SPK_pub, SPK_sig, OPK_pubs[] }
  Xử lý: bcrypt.hash(password, 12) → lưu User + KeyBundle → trả 201

POST /auth/login  
  Body: { username, password }
  Xử lý: bcrypt.compare(password, storedHash) → trả { token, userId, username }
  Bảo vệ: DUMMY_HASH đảm bảo bcrypt luôn chạy dù username không tồn tại (chống timing attack)
```

---

## backend/routes/keys.js

```
POST /keys/upload
  Xác thực: JWT
  Body: { ikPub, spkPub, spkSig, opkPubs: [{ id, pub }] }  ← opkPubs là Json[], không phải String[]
  Xử lý: tạo KeyBundle lần đầu (409 nếu đã tồn tại)

GET /keys/:userId
  Xác thực: JWT
  Xử lý: lấy KeyBundle → pop 1 OPK (xóa khỏi DB) → lưu lại remainder
  Response: { ikPub, spkPub, spkSig, opkPub: string (base64), opkId: string }
  ← FE PHẢI gọi verifySignedPreKey(ikPub, spkSig, spkPub) ngay sau khi nhận response này

POST /keys/opk
  Xác thực: JWT
  Body: { opkPubs: [{ id, pub }] }
  Xử lý: thêm OPK vào pool, giới hạn MAX=100
  Response: { added, previous, current }

POST /keys/spk
  Xác thực: JWT
  Body: { spkPub, spkSig }
  Xử lý: rotate SPK (chỉ thay 2 trường này, IK và OPK giữ nguyên)
```

---

## backend/routes/messages.js

```
GET /messages/:conversationId?cursor=<id>&limit=20
  Xác thực: JWT
  Xử lý: query WHERE conversationId = ? ORDER BY createdAt DESC LIMIT 20, cursor pagination theo id
  Response: [{ id, senderId, ciphertext, iv, aad, ekPub?, opkId?, ikPub?, createdAt }]
  Ghi chú: ekPub/opkId/ikPub chỉ có giá trị ở tin X3DH đầu tiên, null ở mọi tin còn lại

POST /messages
  Xác thực: JWT
  Body: { conversationId, ciphertext, iv, aad, ekPub?, opkId?, ikPub? }
  Xử lý: membership check → lưu vào DB trước → relay qua in-memory Map → trả ACK
  Lý do thứ tự DB trước: tin không bị mất khi server sập giữa chừng
  Server KHÔNG đọc ciphertext
```

---

## backend/ws/handler.js

```
clients = Map<userId, WebSocket> — sống trong RAM, mất khi server restart

Khi client kết nối:
  1. Verify JWT từ query param (?token=...)
  2. Check Redis blocklist (token bị revoke chưa?)
  3. Nếu userId đã có socket cũ → đóng socket cũ (close 4000) → chỉ 1 tab active
  4. Lưu mapping: clients.set(userId, ws)
  5. Gửi danh sách onlineUsers cho client mới
  6. Broadcast presence online cho tất cả user khác

Khi nhận message từ client:
  1. Parse JSON → phân loại theo msg.type (ping / message)
  2. Membership check chống IDOR
  3. Lưu vào DB trước (đảm bảo không mất tin khi sập)
  4. clients.get(receiverId)?.send(message) — relay nếu receiver online
  5. Gửi ACK về sender

Khi client ngắt kết nối:
  1. So sánh tham chiếu: clients.get(userId) === ws (tránh xóa nhầm socket mới)
  2. clients.delete(userId)
  3. Broadcast presence offline
```

---

## Debug checklist — khi có lỗi tìm ở đây trước

| Triệu chứng | Kiểm tra ở đâu |
|---|---|
| Bob không giải mã được tin đầu | `ekPub`, `opkId`, `ikPub` có đủ trong message không? `OPK_id` có khớp OPK Bob dùng không? `x3dh.js` receiver |
| Decrypt throw error | IV có bị thay đổi không? AAD có khớp không? `aesGcm.js` |
| Fingerprint 2 bên khác nhau | Thứ tự sort IK_pub có canonical không? `fingerprint.js` |
| WebSocket không nhận tin | userId có trong clients Map không? readyState có OPEN không? `ws/handler.js` |
| Private key không unwrap được | Password đúng chưa? PBKDF2 iterations có đúng 600_000 không? `keyGen.js` |
| JWT invalid | Token có hết hạn không? SECRET có khớp .env không? `middleware/auth.js` |
| OPK pool cạn | `KeyBundle.opkPubs` còn bao nhiêu? Cần gọi `/keys/upload` |