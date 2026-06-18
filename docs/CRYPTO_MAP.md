# Bản đồ Crypto — File nào, hàm nào, thư viện nào

## NGUYÊN TẮC QUAN TRỌNG NHẤT
Toàn bộ mã hóa/giải mã xảy ra ở FRONTEND (browser).
Server KHÔNG có bất kỳ hàm crypto nào liên quan đến nội dung tin nhắn.
Server chỉ dùng bcrypt (cost 12) để hash password — không liên quan đến E2EE.

## Thư viện nào dùng cho gì

| Thư viện | Dùng cho | Lý do chọn |
|---|---|---|
| libsodium-wrappers | X25519 (DH), Ed25519 (sign/verify), convert Ed25519↔X25519 | Web Crypto API không hỗ trợ X25519/Ed25519 đủ rộng |
| Web Crypto API | AES-GCM, HKDF, PBKDF2, SHA-512 | Native browser, không cần thư viện ngoài |
| bcrypt (npm) | Hash password phía server | cost 12 = 4096 vòng lặp, ~300ms/hash, chống brute force |

---

## frontend/src/crypto/keyGen.js

| Hàm | Thư viện | Input | Output | Ghi chú |
|-----|----------|-------|--------|---------|
| `generateIdentityKey()` | libsodium | — | `{ IK_pub, IK_secret }` (Uint8Array) | **Ed25519** keypair (không phải X25519). IK_pub = IK_secret.slice(32) |
| `generateSignedPreKey(IK_secret)` | libsodium | IK_secret (64B) | `{ SPK_pub, SPK_priv, SPK_sig }` | SPK_sig = Ed25519.sign(IK_secret, SPK_pub) |
| `generateOneTimePreKeys(n=100)` | libsodium | n | `[{ id, OPK_pub, OPK_priv }]` | id = crypto.randomUUID(), X25519 keypair |
| `deriveWrappingKey(password, salt)` | Web Crypto | password (string), salt (Uint8Array) | `wrappingKey` (CryptoKey) | PBKDF2-SHA256, 600k iterations. Chạy **1 lần duy nhất** khi register/login |
| `wrapPrivateKey(privKey, wrappingKey)` | Web Crypto | privKey (Uint8Array), wrappingKey (CryptoKey) | `{ wrapped, iv }` (base64) | AES-GCM encrypt, IV random 12B |
| `unwrapPrivateKey(wrapped, iv, wrappingKey)` | Web Crypto | wrapped (base64), iv (base64), wrappingKey (CryptoKey) | privKey (Uint8Array) | Ngược lại wrapPrivateKey |

**Tại sao IK là Ed25519 (không phải X25519)?**
```
IK phải ký SPK bằng Ed25519 → bắt buộc phải là Ed25519 keypair.
Khi dùng IK trong phép DH (X3DH): convert sang X25519 bằng:
  IK_x25519_priv = sodium.crypto_sign_ed25519_sk_to_curve25519(IK_secret)
  IK_x25519_pub  = sodium.crypto_sign_ed25519_pk_to_curve25519(IK_pub)
```

**Tại sao deriveWrappingKey tách riêng (không gọi bên trong wrapPrivateKey)?**
```
PBKDF2 với 600_000 iterations ≈ 0.5s/lần.
Nếu gọi bên trong wrapPrivateKey: 102 lần × 0.5s = 51 giây — không thể dùng được.
Giải pháp: deriveWrappingKey 1 lần → CryptoKey → truyền vào tất cả wrapPrivateKey.
           Mỗi AES-GCM wrap chỉ tốn vài ms.
```

**wrapSalt: 1 salt CHUNG cho tất cả key (không phải mỗi key 1 salt)**
```
wrapSalt = random 16B → lưu IndexedDB cùng với wrapped keys
wrappingKey = PBKDF2(password, wrapSalt, 600_000)
→ wrappingKey này wrap IK, SPK, và tất cả OPK
→ Khi login: getWrapSalt(userId) → derive lại đúng wrappingKey → unwrap tất cả
```

**Format OPK khi upload vs lưu IndexedDB:**
```
Upload lên server (POST /keys/upload, opkPubs[]):
  [{ id: string, pub: base64(OPK_pub) }]   ← server chỉ cần public key

Lưu vào IndexedDB (privateKeys.wrappedOPKs[]):
  [{ id: string, wrappedOPK: base64, iv: base64 }]
  ← id PHẢI KHỚP với id gửi lên server
  ← dùng message.opkId để .find(o => o.id === opkId) khi decrypt
```

---

## frontend/src/crypto/x3dh.js

| Hàm | Input | Output | Ghi chú |
|-----|-------|--------|---------|
| `verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub_B)` | 3 Uint8Array | boolean | Ed25519.verify — **GỌI TRƯỚC X3DH** — false → throw, không tiếp tục |
| `performX3DH_sender(myKeys, bobBundle)` | Alice keys + Bob bundle | `{ SK (CryptoKey), EK_pub (base64), OPK_id, IK_pub }` | 4 DH + HKDF, xóa EK_priv sau |
| `performX3DH_receiver(myKeys, initMsg)` | Bob keys + init message | `{ SK (CryptoKey) }` | 4 DH ngược + HKDF |

**Input chi tiết performX3DH_sender:**
```javascript
myKeys = {
  IK_secret: Uint8Array(64),  // Ed25519 secret — convert sang X25519 bên trong hàm
  SPK_priv:  Uint8Array(32),  // X25519 (không dùng trong sender flow, chỉ receiver cần)
}
bobBundle = {
  ikPub:  Uint8Array(32),  // Ed25519 pub → convert sang X25519 bên trong
  spkPub: Uint8Array(32),  // X25519 pub (đã verify SPK_sig trước khi gọi hàm này)
  opkPub: Uint8Array(32),  // X25519 pub
  opkId:  string,
}
```

**Output performX3DH_sender:**
```javascript
{
  SK:     CryptoKey,        // extractable: true (để exportKey → lưu IndexedDB)
  EK_pub: string (base64),  // gửi lên server trong POST /messages
  OPK_id: string,           // gửi lên server trong POST /messages
  IK_pub: string (base64),  // gửi lên server trong POST /messages (Bob cần tính DH1)
}
```

**Chi tiết 4 phép DH trong sender:**
```javascript
IK_x25519 = sodium.crypto_sign_ed25519_sk_to_curve25519(myKeys.IK_secret)
EK         = sodium.crypto_box_keypair()  // X25519 ephemeral, dùng 1 lần

DH1 = sodium.crypto_scalarmult(IK_x25519,   bobBundle.spkPub)
DH2 = sodium.crypto_scalarmult(EK.privateKey, bobBundle.ikPub_x25519)
DH3 = sodium.crypto_scalarmult(EK.privateKey, bobBundle.spkPub)
DH4 = sodium.crypto_scalarmult(EK.privateKey, bobBundle.opkPub)

F   = new Uint8Array(32).fill(0xFF)
IKM = concat(F, DH1, DH2, DH3, DH4)   // 5 × 32 = 160 bytes
SK  = HKDF-SHA256(IKM, salt=0x00×32, info="E2EEChat_v1", length=32)
// XÓA EK.privateKey, DH1, DH2, DH3, DH4 ngay sau — Forward Secrecy
```

**Chi tiết 4 phép DH trong receiver (Bob):**
```javascript
// Bob gọi getOPK(userId, opkId, wrappingKey) → chỉ unwrap 1 OPK (không phải cả 100)
IK_x25519_B = sodium.crypto_sign_ed25519_sk_to_curve25519(myKeys.IK_secret)
IK_x25519_A = sodium.crypto_sign_ed25519_pk_to_curve25519(initMsg.ikPub)

DH1 = sodium.crypto_scalarmult(myKeys.SPK_priv, IK_x25519_A)
DH2 = sodium.crypto_scalarmult(IK_x25519_B,     initMsg.EK_pub)
DH3 = sodium.crypto_scalarmult(myKeys.SPK_priv, initMsg.EK_pub)
DH4 = sodium.crypto_scalarmult(OPK_priv,        initMsg.EK_pub)
SK  = HKDF-SHA256(F||DH1||DH2||DH3||DH4, ...) → ra cùng SK với Alice
// XÓA OPK_priv đã dùng khỏi IndexedDB
```

**Thứ tự bắt buộc khi Alice khởi tạo chat:**
```
1. GET /keys/:bobId  →  nhận { ikPub, spkPub, spkSig, opkPub, opkId }
2. verifySignedPreKey(ikPub, spkSig, spkPub)  →  false → DỪNG
3. performX3DH_sender(myKeys, bobBundle)       →  { SK, EK_pub, OPK_id, IK_pub }
4. POST /messages { ..., ekPub, opkId, ikPub } ← tin đầu tiên kèm X3DH init params
```

---

## frontend/src/crypto/aesGcm.js

### Tin nhắn text

| Hàm | Input | Output | Ghi chú |
|-----|-------|--------|---------|
| `encryptMessage(plaintext, SK, conversationId, senderId)` | string, CryptoKey, string, string | `{ ciphertext, iv, aad }` (base64) | IV random 12B mỗi lần |
| `decryptMessage(ciphertextB64, ivB64, aad, SK)` | base64 × 3, CryptoKey | plaintext (string) hoặc `null` | null nếu auth_tag sai (tamper detected) |

**AAD format:**
```javascript
// 1-1:   aad = `${conversationId}:${senderId}`
// group: aad = `${groupId}:${senderId}`
// AAD không được mã hóa nhưng được xác thực bởi AES-GCM auth tag
// Sửa conversationId hoặc senderId → auth tag sai → decryptMessage trả null
```

### File / Ảnh

| Hàm | Input | Output | Dùng cho |
|-----|-------|--------|---------|
| `encryptBytes(bytes, SK)` | Uint8Array, CryptoKey | `{ encryptedBytes, fileIv }` | File 1-1 (dùng SK conversation) |
| `encryptBytesWithRandomKey(bytes)` | Uint8Array | `{ encryptedBytes, fileKey, fileIv }` | File group (1 lần cho N người) |
| `decryptBytes(encryptedBytes, fileIvB64, SK)` | Uint8Array, base64, CryptoKey | Uint8Array | Giải mã file 1-1 |
| `decryptBytesWithKey(encryptedBytes, fileIvB64, fileKeyB64)` | Uint8Array, base64, base64 | Uint8Array | Giải mã file group |

**Tại sao group file dùng random fileKey (không dùng SK)?**
```
Dùng SK: phải encrypt file N lần (1 lần/người) → upload N bản → lãng phí băng thông N×
Random fileKey:
  1. encryptBytesWithRandomKey → encrypted blob (1 lần duy nhất)
  2. Upload 1 bản blob lên server
  3. fileKey nhúng vào message payload của từng người → bọc bằng SK 1-1 riêng
  → Server chỉ lưu 1 blob, fileKey vẫn E2EE
```

**Message payload cho file (backward-compatible với tin nhắn text):**
```javascript
// 1-1 file:
payload = JSON.stringify({
  type: "file",   // hoặc "image"
  fileId, fileName, mimeType, fileSize,
  fileIv,                               // IV của file (không phải IV của message)
  // fileKey KHÔNG có ở đây — SK conversation đã dùng trực tiếp
})

// Group file:
payload = JSON.stringify({
  type: "file",   // hoặc "image"
  fileId, fileName, mimeType, fileSize,
  fileIv,
  fileKey,        // base64 — được bảo vệ bởi AES-GCM của message
})

// Sau đó: encryptMessage(payload, SK, ...) → gửi như tin nhắn text thường
// MessageList.jsx: parsePlaintext() → JSON.parse → detect type field
```

---

## frontend/src/crypto/fingerprint.js

| Hàm | Input | Output |
|-----|-------|--------|
| `generateFingerprint(IK_pub_A, IK_pub_B)` | 2 Uint8Array (Ed25519 pub) | string (60 chữ số) |

**Cách tính:**
```javascript
const sorted = [IK_pub_A, IK_pub_B].sort((a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
})
const combined = concat(sorted[0], sorted[1])   // 64 bytes
let hash = await SHA-512(combined)               // vòng 1
for (let i = 0; i < 5199; i++) {
  hash = await SHA-512(hash)                     // vòng 2 → 5200
}
const fingerprint = BigInt('0x' + toHex(hash)) % BigInt(10n ** 60n)
return fingerprint.toString().padStart(60, '0')
// Hiển thị: chia thành 6 nhóm × 10 chữ số
```

**Tại sao sort canonical?**
Alice tính fingerprint(IK_A, IK_B), Bob tính fingerprint(IK_B, IK_A).
Sort đảm bảo cả 2 ra cùng thứ tự → cùng kết quả.

---

## frontend/src/db/storage.js (Dexie.js)

| Store | Lưu gì | Primary Key |
|-------|--------|-------------|
| `privateKeys` | `{ userId, wrapSalt, wrappedIK, ivIK, wrappedSPK, ivSPK, wrappedOPKs[] }` | userId |
| `sessions` | `{ conversationId, wrappedSK, ivSK }` | conversationId |

**Chú ý schema thực tế (khác với version cũ):**
```javascript
privateKeys store:
{
  userId:     string,
  wrapSalt:   string (base64),     // 1 salt CHUNG, không phải saltIK / saltSPK riêng
  wrappedIK:  string (base64),     // wrapped IK_secret
  ivIK:       string (base64),
  wrappedSPK: string (base64),
  ivSPK:      string (base64),
  wrappedOPKs: [                   // mỗi phần tử:
    { id: string, wrappedOPK: string (base64), iv: string (base64) }
    // KHÔNG có 'salt' per-OPK — dùng wrapSalt chung
  ]
  // IK_pub KHÔNG lưu riêng — recover từ IK_secret.slice(32) khi cần
}

sessions store:
{
  conversationId: string,   // hoặc `${groupId}:${peerId}` cho group session
  wrappedSK:      string (base64),
  ivSK:           string (base64),
}
```

**Các hàm quan trọng:**
```javascript
savePrivateKeys(userId, { wrapSalt, wrappedIK, ivIK, wrappedSPK, ivSPK, wrappedOPKs })
loadPrivateKeys(userId, wrappingKey)  → { IK_secret, IK_pub, SPK_priv }
getWrapSalt(userId)                   → string  // gọi TRƯỚC deriveWrappingKey (giải quyết chicken-and-egg)
getOPK(userId, opkId, wrappingKey)    → Uint8Array  // chỉ unwrap 1 OPK theo opkId (nhanh hơn 100×)
saveSession(conversationId, SK_raw, wrappingKey)
loadSession(conversationId, wrappingKey) → SK (CryptoKey)
deleteOPK(userId, opkId)              // sau khi dùng trong X3DH receiver
```

**Tại sao lưu wrappedSK vào IndexedDB?**
```
Mỗi lần reload trang, sessionKeys (RAM) mất hoàn toàn.
Không thể chạy lại X3DH vì OPK đã bị xóa khỏi pool của receiver.
→ SK phải được wrap bằng wrappingKey và lưu IndexedDB.
→ Khi reload: getWrapSalt → PBKDF2 → unwrapSK → tiếp tục chat.
```

---

## backend/routes/auth.js

```
POST /auth/register
  Body: { username, password, email, IK_pub, SPK_pub, SPK_sig, OPK_pubs[], ikPub }
  Xử lý:
    1. Validate input
    2. Check AllowedEmail.where(email, usedAt: null)  → 403 / 409
       Exception: email = ADMIN_SEED_EMAIL → bypass whitelist, role = ADMIN
    3. bcrypt.hash(password, 12)
    4. prisma.$transaction:
       - User.create({ username, email, passwordHash, role })
       - KeyBundle.create({ ikPub, spkPub, spkSig, opkPubs })
       - AllowedEmail.update({ usedAt: now() })
    5. Response 201: { userId, token, username, role }

POST /auth/login
  Body: { username, password }
  Xử lý:
    1. User.findUnique(username) → dùng DUMMY_HASH nếu không tìm thấy (chống timing attack)
    2. Check user.isActive → 401 nếu bị vô hiệu hóa
    3. bcrypt.compare(password, storedHash) → 401 nếu sai
    4. JWT.sign({ userId, username, role }, SECRET, { expiresIn: '7d' })
    5. Response: { token, userId, username, role }
```

---

## backend/routes/keys.js

```
POST /keys/upload
  Auth: JWT
  Body: { ikPub, spkPub, spkSig, opkPubs: [{ id, pub }] }
  Validate: isValidOpkArray() → check mỗi phần tử có đủ { id: string, pub: string }
  Xử lý: KeyBundle.create (409 nếu đã tồn tại — đăng ký 2 lần bỏ qua lỗi này ở FE)

GET /keys/:userId
  Auth: JWT
  Response: { ikPub, spkPub, spkSig, opkPub: string, opkId: string }
  Xử lý: pop opkPubs[0] → lưu lại remainder
  Ghi chú: opkId là ID trong { id, pub } của OPK, KHÔNG phải KeyBundle.id
  FE phải gọi verifySignedPreKey(ikPub, spkSig, spkPub) ngay sau khi nhận

POST /keys/opk
  Body: { opkPubs: [{ id, pub }] }
  Xử lý: concat và giới hạn MAX=100
  Response: { added, previous, current }

POST /keys/spk
  Body: { spkPub, spkSig }
  Xử lý: chỉ update 2 trường, giữ nguyên IK và OPK
```

---

## backend/routes/messages.js

```
GET /messages/:conversationId?cursor=<id>&limit=20
  Auth: JWT, phải là member của conversation
  Response: [{ id, senderId, ciphertext, iv, aad, ekPub?, opkId?, ikPub?, createdAt }]
  Order: createdAt DESC (mới nhất trước), FE reverse() để hiển thị cũ→mới

GET /messages/group/:groupId?cursor=<id>&limit=20
  Auth: JWT, phải là member của group
  Filter: groupId = ? AND recipientId = currentUserId
  Response: giống endpoint 1-1, kèm senderId

POST /messages
  Auth: JWT
  Body 1-1: { conversationId, ciphertext, iv, aad, ekPub?, opkId?, ikPub? }
    → Check recipient.isActive → 403 nếu bị disable
    → INSERT 1 bản ghi
    → Relay qua clients Map đến receiver

  Body group: { groupId, messages: [{ recipientId, ciphertext, iv, aad, ekPub?, opkId?, ikPub? }] }
    → Check sender là member của group
    → INSERT N bản ghi (1 per recipient), mỗi bản có groupId + recipientId
    → Relay qua clients Map đến từng recipient đang online

  Thứ tự bắt buộc: INSERT DB trước → relay sau → ACK về sender
```

---

## backend/routes/groups.js

```
POST /groups
  Body: { name, memberIds: [userId1, userId2, ...] }
  Xử lý: Group.create + GroupMember.createMany (role=ADMIN cho creator, MEMBER cho còn lại)

GET /groups
  Trả danh sách group user đang là thành viên, kèm member count + lastMessageAt

GET /groups/:groupId/members
  Trả members kèm:
    keyBundle: { ikPub }          ← FE cần để tính fingerprint
    isVerifiedByMe: boolean|null  ← join PeerVerification, null với chính mình

PATCH /groups/:groupId/members (thêm thành viên)
  Auth: ADMIN của group
  Body: { userId }

DELETE /groups/:groupId/members/:userId (xóa thành viên)
  Auth: ADMIN của group
  Không cho xóa chính mình nếu là ADMIN duy nhất
```

---

## backend/routes/files.js

```
POST /files/upload
  Auth: JWT
  Content-Type: multipart/form-data
  Body: file (encrypted bytes, max 10MB)
  Xử lý:
    - multer memoryStorage → req.file.buffer
    - fileId = UUID
    - fs.writeFileSync(`/app/uploads/${fileId}`, buffer)   ← Docker volume
    - UploadedFile.create({ id: fileId, uploaderId })
  Response: { fileId }
  Ghi chú: server lưu encrypted bytes — không biết loại file hay nội dung

GET /files/:fileId
  Auth: JWT
  Xử lý: đọc file từ disk → trả raw bytes (Content-Type: application/octet-stream)
  FE dùng decryptBytes() hoặc decryptBytesWithKey() để giải mã
```

---

## backend/routes/peers.js

```
PATCH /peers/:peerId/verify
  Auth: JWT
  Xử lý:
    - Check peerId tồn tại trong DB
    - Check peerId !== currentUserId (chặn self-verify)
    - PeerVerification.upsert({ verifierId: currentUserId, peerId })   ← idempotent
  Response: { verifiedAt }
```

---

## backend/routes/admin.js

```
Tất cả endpoint yêu cầu JWT + role === 'ADMIN'
Middleware: adminMiddleware = [authMiddleware, requireAdmin]

GET  /admin/users              → User.findMany({ include: role, isActive })
PATCH /admin/users/:id/disable → User.update({ isActive: false })
                                  Check: không tự disable mình
PATCH /admin/users/:id/enable  → User.update({ isActive: true })
PATCH /admin/users/:id/grant-admin   → User.update({ role: 'ADMIN' })
PATCH /admin/users/:id/revoke-admin  → prisma.$transaction:
                                          SELECT COUNT(*) WHERE role=ADMIN FOR UPDATE
                                          → nếu count = 1 → từ chối (phải còn ≥ 1 admin)
                                          → User.update({ role: 'USER' })
GET  /admin/whitelist          → AllowedEmail.findMany
POST /admin/whitelist          → AllowedEmail.create({ email })
DELETE /admin/whitelist/:id   → AllowedEmail.delete
```

---

## backend/ws/handler.js

```
clients = Map<userId, WebSocket> — sống trong RAM, mất khi server restart

Khi client kết nối:
  1. Verify JWT từ URL query param (?token=...)
  2. Check Redis blocklist (token bị revoke chưa?)
  3. Check user.isActive → đóng kết nối nếu bị disable
  4. Nếu userId đã có socket cũ → đóng socket cũ (close 4000) → chỉ 1 tab active
  5. clients.set(userId, ws)
  6. Gửi { type: "connected", onlineUsers: [...clients.keys()] }
  7. Broadcast { type: "presence", userId, status: "online" } cho tất cả

Khi nhận message:
  type "ping" → gửi { type: "pong" }
  type "message" (1-1):
    → membership check chống IDOR
    → INSERT DB trước
    → clients.get(receiverId)?.send(message)
    → ACK về sender
  type "group_message":
    → membership check
    → INSERT N bản ghi
    → Relay cho từng recipient

Khi ngắt kết nối:
  1. So sánh tham chiếu: clients.get(userId) === ws (tránh xóa nhầm)
  2. clients.delete(userId)
  3. Broadcast { type: "presence", userId, status: "offline" }
```

---

## backend/middleware/auth.js

```javascript
// JWT middleware: verify token → check Redis blocklist → check isActive
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'No token' })

  const payload = jwt.verify(token, process.env.JWT_SECRET)
  const isRevoked = await redis.get(`blocklist:${token}`)
  if (isRevoked) return res.status(401).json({ error: 'Token revoked' })

  const user = await prisma.user.findUnique({ where: { id: payload.userId } })
  if (!user?.isActive) return res.status(401).json({ error: 'Account disabled' })

  req.user = payload   // { userId, username, role }
  next()
}
```

---

## Debug checklist — khi có lỗi tìm ở đây trước

| Triệu chứng | Kiểm tra ở đâu |
|---|---|
| Bob không giải mã được tin X3DH đầu | `ekPub`, `opkId`, `ikPub` có đủ trong message không? `opkId` có khớp OPK Bob giữ không? `x3dh.js` receiver |
| Group decrypt fail | SK cache key có đúng `${groupId}:${senderId}` không? AAD có dùng groupId thay vì conversationId không? |
| File decrypt fail | `fileIv` có được truyền đúng không? 1-1 dùng SK hay group dùng fileKey? |
| Fingerprint 2 bên khác nhau | Sort canonical có đúng không? Cả 2 bên dùng Ed25519 pub (không phải X25519 pub)? |
| WebSocket không nhận tin | userId có trong clients Map không? readyState = OPEN chưa? |
| Private key không unwrap được | wrapSalt đúng chưa? password đúng chưa? PBKDF2 iterations = 600_000? |
| JWT invalid sau login | token có trong Redis blocklist không? SECRET có khớp .env không? |
| OPK pool cạn | `KeyBundle.opkPubs.length` còn bao nhiêu? Gọi POST /keys/opk |
| Admin endpoint 403 | user.role có phải 'ADMIN' không? JWT payload có chứa role không? |
| File upload 413 | multer limit 10MB — file client-side phải validate trước khi gửi |
