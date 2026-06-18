# Kiến trúc & Luồng dữ liệu chi tiết

## Sơ đồ tổng thể
```
[Browser Alice]                    [Server]                    [Browser Bob]
  E2EE layer                   Blind Server                    E2EE layer
  (encrypt)  ──── HTTPS/WS ──► (relay only) ◄──── HTTPS/WS ──  (decrypt)
                                    │
                              [PostgreSQL]
                              [Redis] ← chỉ dùng cho JWT blocklist
```
Server KHÔNG đọc được nội dung — chỉ lưu và chuyển tiếp ciphertext.

---

## Frontend Architecture

### Cấu trúc thư mục
```
frontend/src/
├── pages/
│   ├── Login.jsx        # Form đăng nhập, xử lý DEVICE_NOT_REGISTERED
│   ├── Register.jsx     # Form đăng ký 4 field, loading "Đang sinh key mã hóa..."
│   ├── Chat.jsx         # Orchestrator: useWebSocket + useMessages + X3DH + send logic
│   └── Admin.jsx        # Trang admin: quản lý user + whitelist email (chỉ ADMIN thấy)
├── components/
│   ├── UnlockModal.jsx       # Overlay sau reload, nhập password để giải mã key trong RAM
│   ├── Avatar.jsx            # Hash userId → HSL hue, 2 initials uppercase
│   ├── ConversationItem.jsx  # Online dot, thời gian, cảnh báo "Chưa xác minh danh tính"
│   ├── GroupItem.jsx         # Item nhóm trong sidebar
│   ├── ChatSidebar.jsx       # Tab "Tin nhắn"/"Nhóm", search debounce 400ms, nút tạo nhóm,
│   │                         # icon bánh răng ⚙ cho admin (SPA navigate → không mất wrappingKey)
│   ├── CreateGroupModal.jsx  # Modal tạo nhóm: tìm kiếm + chọn thành viên + đặt tên
│   ├── FingerprintModal.jsx  # SHA-512 × 5200, hiển thị 60 chữ số, callback onConfirm
│   ├── GroupInfoPanel.jsx    # Danh sách thành viên + shield icon verify, gọi FingerprintModal
│   ├── MessageList.jsx       # Auto-scroll, infinite scroll, group tin cùng người, FileBubble
│   └── MessageInput.jsx      # Auto-resize, Enter gửi, paperclip đính kèm, Ctrl+V paste ảnh
├── hooks/
│   ├── useWebSocket.js  # WS singleton, xử lý message/presence/group, sessionKeysRef
│   └── useMessages.js   # Load lịch sử, cursor pagination, decrypt song song, addMessage
├── contexts/
│   └── AuthContext.jsx  # token/userId/username/role (localStorage) + wrappingKey/keys (RAM)
├── crypto/
│   ├── keyGen.js        # Sinh IK(Ed25519)/SPK(X25519)/OPK + deriveWrappingKey + wrap/unwrap
│   ├── x3dh.js          # verifySignedPreKey + X3DH sender + X3DH receiver
│   ├── aesGcm.js        # encrypt/decrypt message + encrypt/decrypt bytes (file)
│   └── fingerprint.js   # SHA-512 × 5200 → 60 chữ số
├── db/
│   └── storage.js       # Dexie.js: lưu private keys, session keys, OPK pool
└── services/
    ├── api.js            # 22+ hàm REST (auth, keys, conv, messages, groups, files, admin, peers)
    └── socket.js         # WebSocket singleton, reconnect 3s, ping keepalive 30s
```

### Nguyên tắc phân tầng
```
pages/components  →  hooks  →  services/crypto/db
      ↑                              (không có chiều ngược lại)

crypto/ không import gì từ React, hooks, services
db/     không import gì từ crypto hay React
services/ không import gì từ React
```

---

## Luồng 1: Đăng ký tài khoản

**Điều kiện tiên quyết:** Email phải được IT Admin thêm vào bảng `AllowedEmail` trước.

```
Browser (Alice)
  1. Sinh Identity Key (IK)    = crypto_sign_keypair()       → Ed25519 keypair, vĩnh viễn
     IK_pub    = 32 bytes  (Ed25519 public key)
     IK_secret = 64 bytes  (libsodium format: seed 32B + pub 32B ghép lại)
     Lý do dùng Ed25519 (không phải X25519):
       IK cần ký SPK bằng Ed25519 → bắt buộc phải là Ed25519 keypair
       Khi dùng IK trong DH: convert sang X25519 bằng crypto_sign_ed25519_sk/pk_to_curve25519()
       Từ IK_secret: IK_pub = IK_secret.slice(32) (không cần lưu riêng)

  2. Sinh Signed PreKey (SPK)  = crypto_box_keypair()        → X25519 keypair, 32 bytes mỗi chiều
     SPK_sig = Ed25519.sign(IK_secret, SPK_pub)              → ký để chứng minh SPK là của Alice

  3. Sinh 100 One-Time PreKey (OPK) = crypto_box_keypair() × 100  → X25519, mỗi cái dùng 1 lần

  4. Sinh wrapSalt = crypto.getRandomValues(16 bytes)        ← random salt CHUNG cho tất cả key
     wrappingKey = PBKDF2-SHA256(password, wrapSalt, 600_000)  ← chạy 1 LẦN DUY NHẤT
     (PBKDF2 600k iterations ≈ 0.5s — không thể chạy lại mỗi lần wrap)

  5. Wrap từng private key bằng wrappingKey (chỉ AES-GCM, không chạy PBKDF2 lại):
     { wrapped: IK_secret, iv: ivIK  } = AES-GCM.encrypt(IK_secret, wrappingKey)
     { wrapped: SPK_priv,  iv: ivSPK } = AES-GCM.encrypt(SPK_priv,  wrappingKey)
     wrappedOPKs[i] = { id, wrappedOPK, iv } × 100
     → Tổng 102 lần AES-GCM, ~vài ms — toàn bộ quá trình ~1-2 giây

  6. Lưu vào IndexedDB: { userId, wrapSalt, wrappedIK, ivIK, wrappedSPK, ivSPK, wrappedOPKs[] }
     wrapSalt phải được lưu cùng — dùng khi login để derive lại wrappingKey
     IK_pub KHÔNG lưu riêng — recover từ IK_secret.slice(32) khi cần

  7. POST /auth/register {
       username, password (bcrypt server-side),
       email,                       ← bắt buộc, phải có trong bảng AllowedEmail
       IK_pub, SPK_pub, SPK_sig,
       OPK_pubs[100]                ← chỉ public key, KHÔNG có private key
     }

Server
  → Check email trong AllowedEmail → 403 nếu không có, 409 nếu đã dùng
  → hash password bằng bcrypt (cost 12)
  → prisma.$transaction: lưu User + KeyBundle + đánh dấu AllowedEmail.usedAt
  → ADMIN_SEED_EMAIL: bypass whitelist, gán role = ADMIN (chỉ có tác dụng lần đầu)
  → trả { userId, token, username, role }
```

---

## Luồng 2: Đăng nhập

```
Browser
  1. POST /auth/login { username, password }
  2. Server: check isActive → bcrypt.compare → trả { token, userId, username, role }
  3. Browser nhận JWT + lưu vào localStorage { token, userId, username, role }
     (localStorage để UnlockModal hoạt động sau reload — xem giải thích bên dưới)

  4. Kiểm tra thiết bị:
     hasKeys = IndexedDB.privateKeys.get(userId) !== null
     - false → gọi POST /auth/logout (revoke token ngay)
               throw Error('DEVICE_NOT_REGISTERED')
               Login.jsx hiển thị: "Tài khoản này đã đăng ký trên thiết bị khác"
                                   + UI import file .e2ee
     - true  → tiếp tục

  5. Derive wrappingKey (1 lần):
     salt = getWrapSalt(userId)  ← lấy từ IndexedDB
     wrappingKey = PBKDF2(password, salt, 600_000)

  6. Unwrap private keys:
     IK_secret = AES-GCM.decrypt(wrappedIK, wrappingKey, ivIK)
     SPK_priv  = AES-GCM.decrypt(wrappedSPK, wrappingKey, ivSPK)
     IK_pub    = IK_secret.slice(32)     ← không cần decrypt thêm
     → private keys sẵn sàng trong RAM (AuthContext state)

  7. uploadKeys (POST /keys/upload) → 409 bỏ qua (đã upload từ lần đăng ký)

  8. lưu { wrappingKey, IK_secret, IK_pub, SPK_priv } vào RAM (AuthContext)
```

**Tại sao token lưu localStorage (không phải RAM)?**
- Sau reload, React state mất → wrappingKey mất → cần nhập lại password (UnlockModal)
- Token trong localStorage giúp app biết user đã đăng nhập → hiện UnlockModal thay vì redirect login
- Rủi ro XSS: giảm thiểu bằng CSP; private key vẫn an toàn vì wrappingKey chỉ sống trong RAM

**UnlockModal flow (sau reload):**
```
App khởi động → isAuthenticated=true (có token localStorage) + isLocked=true (wrappingKey=null)
→ ProtectedRoute hiện UnlockModal (không cho vào chat)
→ User nhập password → unlock():
    getWrapSalt(userId) → deriveWrappingKey → loadPrivateKeys → set RAM state
→ isLocked=false → UnlockModal đóng → user vào chat bình thường
```

---

## Luồng 3: X3DH — Thiết lập phiên chat 1-1 lần đầu

**Tình huống:** Alice muốn nhắn tin cho Bob lần đầu. Bob có thể đang offline.

```
Alice (Sender)                              Server                    Bob (Receiver)

Bước 1: Lấy key bundle của Bob
  GET /keys/bob ──────────────────────────► trả IK_pub_B, SPK_pub_B,
                                            SPK_sig, OPK_pub_B, OPK_id
                                            (xóa OPK_B này khỏi pool)

Bước 2: Verify chữ ký SPK
  Ed25519.verify(IK_pub_B, SPK_sig, SPK_pub_B)
  → false → DỪNG (server có thể đã giả mạo SPK)
  → true  → tiếp tục

Bước 3: Sinh Ephemeral Key (chỉ dùng 1 lần)
  EK = crypto_box_keypair()   → X25519

Bước 4: Tính 4 phép Diffie-Hellman
  [convert IK_secret → X25519 bằng crypto_sign_ed25519_sk_to_curve25519]
  DH1 = X25519(IK_x25519_A,  SPK_pub_B)  ← mutual authentication
  DH2 = X25519(EK_priv_A,    IK_pub_B)   ← mutual authentication (IK_pub_B convert sang X25519)
  DH3 = X25519(EK_priv_A,    SPK_pub_B)  ← forward secrecy
  DH4 = X25519(EK_priv_A,    OPK_pub_B)  ← forward secrecy (OPK dùng 1 lần)

Bước 5: Derive Session Key bằng HKDF-SHA256
  F   = 0xFF × 32 bytes           (phân biệt X25519 với X448 theo Signal spec)
  IKM = F || DH1 || DH2 || DH3 || DH4
  SK  = HKDF-SHA256(IKM, salt=0x00×32, info="E2EEChat_v1", length=32)

Bước 6: Lưu SK vào IndexedDB, xóa vật liệu tạm khỏi RAM
  wrappedSK = AES-GCM.encrypt(SK_raw, wrappingKey)
  IndexedDB.sessions.put({ conversationId, wrappedSK, ivSK })
  EK_priv_A, DH1, DH2, DH3, DH4 → null  ← XÓA ngay (Forward Secrecy)

Bước 7: Gửi tin đầu tiên
  POST /messages {
    conversationId,
    IK_pub_A, EK_pub_A, OPK_id,   ← Bob cần để tính lại SK
    IV, ciphertext, aad            ← tin nhắn đã mã hóa
  }

                                              Bob online, nhận tin qua WS:
Bước 8: Bob tính lại SK (chiều ngược)
  OPK_priv_B = getOPK(userId, opkId, wrappingKey)  ← chỉ unwrap 1 OPK (không unwrap cả 100)
  DH1 = X25519(SPK_priv_B,  IK_pub_A)   [IK_pub_A convert sang X25519]
  DH2 = X25519(IK_x25519_B, EK_pub_A)
  DH3 = X25519(SPK_priv_B,  EK_pub_A)
  DH4 = X25519(OPK_priv_B,  EK_pub_A)
  SK  = HKDF-SHA256(F||DH1||DH2||DH3||DH4, ...) → ra cùng SK với Alice
  Xóa OPK_priv_B đã dùng khỏi IndexedDB
  Giải mã tin nhắn
```

**Lưu ý:** Từ tin nhắn thứ 2 trở đi, không cần X3DH nữa. Chỉ dùng SK đã cache.

---

## Luồng 4: Gửi tin nhắn 1-1 (AES-256-GCM)

```
Alice muốn gửi "Xin chào Bob":

  SK = getOrCreateSK(conversationId):
    1. sessionKeysRef.current.get(conversationId)  ← RAM cache
    2. IndexedDB.sessions.get(conversationId)      ← persistent cache
    3. X3DH sender                                 ← nếu chưa có SK

  IV  = crypto.getRandomValues(12 bytes)
  AAD = `${conversationId}:${senderId}`  ← không mã hóa nhưng được xác thực

  { ciphertext } = AES-256-GCM encrypt(plaintext, SK, IV, AAD)

  → Optimistic UI: hiển thị tin ngay lập tức (trạng thái "đang gửi")
  POST /messages { conversationId, ciphertext, iv, aad }
  → Server lưu DB → relay qua WebSocket → Bob nhận

  Bob giải mã: AES-256-GCM decrypt(ciphertext, SK, IV, AAD)
  → auth_tag sai → null (hiển thị "[Lỗi giải mã]")
  → auth_tag đúng → plaintext
```

**Tại sao AAD là `${conversationId}:${senderId}`?**
Nếu không có AAD, attacker thay senderId hoặc chuyển ciphertext sang conversation khác mà AES-GCM không phát hiện.
Với AAD, bất kỳ thay đổi nào → auth_tag sai → decrypt fail.

---

## Luồng 5: WebSocket + In-Memory Relay

```
Bob gửi tin cho Alice:

Bob ──WS──► Server (handler.js)
                │
                ├─1. INSERT vào PostgreSQL ← lưu trước, không mất tin khi sập
                │
                └─2. clients.get("alice_uuid")?.send(message) ← relay nếu Alice online

clients = Map<userId, WebSocket> — sống trong RAM của tiến trình Node.js
```

**Tại sao lưu DB TRƯỚC, relay SAU?**
- Relay trước rồi sập: Alice nhận tin nhưng reload thì tin biến mất
- Lưu DB trước: tin an toàn, Alice chỉ cần reload là thấy
- Chênh lệch 5–15ms, người dùng không cảm nhận

**Xử lý multi-tab:** Khi user mở tab mới → đóng socket cũ (close 4000) → chỉ 1 tab active

**Xử lý khi Bob offline:** clients.get(receiverId) → undefined → bỏ qua relay, tin đã lưu DB

**Hạn chế (ghi vào báo cáo):**
1 server instance. Nếu scale ngang → cần Redis Pub/Sub.

---

## Luồng 6: Fingerprint Verification 1-1 (chống MITM)

```
Alice và Bob đều tính fingerprint độc lập:

  sorted_keys = sort([IK_pub_Alice, IK_pub_Bob])  ← sort canonical, 2 bên ra cùng kết quả
  hash = SHA-512(sorted_keys)
  for i in range(5199): hash = SHA-512(hash)      ← lặp 5200 vòng
  fingerprint = BigInt(hash) % 10^60              ← 60 chữ số decimal

Alice đọc 60 chữ số cho Bob nghe qua điện thoại (kênh ngoài).
Khớp → PATCH /conversations/:convId/fingerprint + PATCH /peers/:peerId/verify
      → fingerprintVerified = true → Chat.jsx cho phép MessageInput
Không khớp → có thể đang bị MITM.
```

**Tại sao bắt verify TRƯỚC khi chat (1-1)?**
Đảm bảo người dùng ý thức được rủi ro MITM. Nếu server thay IK_pub giả → fingerprint sai → phát hiện ngay.

---

## Luồng 7: Chuyển thiết bị (Export / Import key)

**Bối cảnh:** Private key chỉ tồn tại trong IndexedDB của thiết bị đăng ký. Thiết bị mới → DEVICE_NOT_REGISTERED.

```
EXPORT (trên thiết bị cũ)
  1. Login thành công
  2. User bấm "Export backup"
  3. data = IndexedDB.privateKeys.get(userId)
     → { userId, wrapSalt, wrappedIK, ivIK, wrappedSPK, ivSPK, wrappedOPKs[] }
     → TẤT CẢ đã wrap bằng wrappingKey — plaintext private key KHÔNG xuất hiện trong file
  4. download file e2ee-keys-{userId}.e2ee

IMPORT (trên thiết bị mới)
  1. Login → nhận lỗi DEVICE_NOT_REGISTERED
  2. Upload file .e2ee
  3. JSON.parse → validate cấu trúc
  4. IndexedDB.privateKeys.put(data)
  5. Login bình thường → PBKDF2(password, data.wrapSalt) → unwrap keys
```

**Bảo mật file .e2ee:**
- Có file mà không có password: không giải mã được private key
- Có cả file và password: tương đương bị lộ credential — quản lý file như quản lý mật khẩu

---

## Luồng 8: Group Chat E2EE (N tin 1-1 song song)

**Mô hình:** Mỗi tin nhắn group = N bản ciphertext riêng (1 cho mỗi thành viên), mã hóa bằng SK 1-1 riêng.

```
Alice gửi tin "Hello team" vào nhóm {Alice, Bob, Charlie}:

  Chat.jsx:
    Với mỗi member (Bob, Charlie):
      SK_alice_bob     = getOrCreateGroupSK(groupId, bobId)
      SK_alice_charlie = getOrCreateGroupSK(groupId, charlieId)

  SK group cache key = `${groupId}:${recipientId}` (phía sender)
                     = `${groupId}:${senderId}`    (phía receiver)
  → tách biệt hoàn toàn với SK 1-1

  encryptMessage(plaintext, SK_alice_bob, groupId, aliceId)     → ciphertext1
  encryptMessage(plaintext, SK_alice_charlie, groupId, aliceId) → ciphertext2

  POST /messages {
    groupId,
    messages: [
      { recipientId: bobId,     ciphertext: ciphertext1, iv, aad },
      { recipientId: charlieId, ciphertext: ciphertext2, iv, aad }
    ]
  }

Server:
  → Kiểm tra sender là member của group
  → INSERT N bản ghi vào Message (groupId + recipientId riêng cho mỗi bản)
  → Relay real-time cho từng member đang online:
      clients.get(bobId)?.send(...)
      clients.get(charlieId)?.send(...)

AAD group message = `${groupId}:${senderId}` (giống 1-1 nhưng dùng groupId)

Bob nhận tin:
  SK_bob_alice = getOrCreateGroupSK(groupId, aliceId)  ← X3DH hoặc cache
  decryptMessage(ciphertext, SK_bob_alice, ...)
```

**Fingerprint nhóm (PeerVerification toàn cục):**
- Verify Bob trong nhóm A → cũng xanh ở nhóm B (cùng IK_pub)
- Không block chat như 1-1 — nhóm vẫn gửi được kể cả chưa verify (giống Signal)
- PATCH /peers/:peerId/verify → ghi vào bảng PeerVerification
- PATCH /conversations/:convId/fingerprint → đồng thời ghi PeerVerification (đồng bộ 1-1 ↔ group)

---

## Luồng 9: Gửi File/Ảnh E2EE

### 1-1: Dùng SK conversation

```
Alice gửi file ảnh cho Bob:

  1. encryptBytes(fileBytes, SK)
     → { encryptedBytes (Uint8Array), fileIv (base64) }

  2. POST /files/upload (FormData, max 10MB)
     → Server lưu encrypted bytes dưới UUID, không biết loại file hay nội dung
     → { fileId }

  3. payload = { type: "image", fileId, fileName, mimeType, fileSize, fileIv }
     encryptMessage(JSON.stringify(payload), SK, conversationId, senderId)
     → gửi như tin nhắn text thường

Bob nhận:
  plaintext = decryptMessage(...)          → JSON parse → phát hiện type "image"
  encryptedBytes = downloadFile(fileId)    → GET /files/:fileId
  fileBytes = decryptBytes(encryptedBytes, fileIv, SK)
  → hiển thị ảnh inline / cho tải xuống
```

### Group: Dùng Random FileKey

```
Alice gửi file vào nhóm {Alice, Bob, Charlie}:

  1. { encryptedBytes, fileKey, fileIv } = encryptBytesWithRandomKey(fileBytes)
     fileKey = random 256-bit AES key (không phải SK)
     → mã hóa file 1 lần duy nhất

  2. POST /files/upload → { fileId }
     (server chỉ lưu 1 bản ciphertext dù N người)

  3. Với mỗi member, nhúng fileKey vào message payload:
     payload = { type: "image", fileId, fileName, mimeType, fileSize, fileIv,
                 fileKey: base64(fileKey) }
     encryptMessage(JSON.stringify(payload), SK_alice_bob, ...)     → ciphertext1
     encryptMessage(JSON.stringify(payload), SK_alice_charlie, ...) → ciphertext2
     → fileKey được bảo vệ bởi SK 1-1 riêng của từng người

Bob nhận:
  plaintext = decryptMessage(...)          → JSON parse → lấy fileKey
  encryptedBytes = downloadFile(fileId)
  fileBytes = decryptBytesWithKey(encryptedBytes, fileIv, fileKey)
```

**Ưu điểm group file:** Upload 1 lần, không tốn băng thông N×. fileKey đi theo message payload → được E2EE bảo vệ.

---

## Luồng 10: Admin System

**Kiến trúc:** Role-based admin — admin là user thực trong hệ thống, không có secret riêng.

```
Bootstrap admin đầu tiên:
  docker-compose.yml → ADMIN_SEED_EMAIL=admin@company.com
  Đăng ký với email đó → server check email = ADMIN_SEED_EMAIL
  → bypass whitelist → gán role = ADMIN (chỉ có tác dụng 1 lần)

Admin quản lý:
  GET  /admin/users              → danh sách tất cả user + role + isActive
  PATCH /admin/users/:id/disable → vô hiệu hóa (soft delete, chặn tự disable mình)
  PATCH /admin/users/:id/enable  → kích hoạt lại
  PATCH /admin/users/:id/grant-admin   → cấp quyền ADMIN
  PATCH /admin/users/:id/revoke-admin  → thu hồi quyền ADMIN
    Race condition 2 admin thu hồi nhau đồng thời:
    → prisma.$transaction + SELECT COUNT(*) FOR UPDATE → PostgreSQL row lock
    → request thứ 2 phải chờ, đọc lại count → thấy 1 admin còn lại → bị từ chối
  GET  /admin/whitelist          → danh sách AllowedEmail
  POST /admin/whitelist          → thêm email mới
  DELETE /admin/whitelist/:id   → xóa email

User bị disable:
  - Ẩn khỏi /users?search= (GET /users thêm filter isActive: true)
  - Không đăng nhập được (POST /auth/login check isActive)
  - Người khác không gửi tin được (POST /messages check recipient.isActive)
  - Conversation cũ vẫn đọc được (ciphertext vẫn giải mã được vì đã có SK)
  - Chat.jsx hiển thị banner thay thế MessageInput

Điều hướng admin:
  Icon bánh răng ⚙ trong ChatSidebar → navigate('/admin') (SPA, không reload)
  → wrappingKey vẫn còn trong RAM → quay lại /chat không cần nhập password lại
  Gõ thẳng URL /admin (reload) → wrappingKey mất → cần UnlockModal khi vào /chat
  → đúng về bảo mật E2EE
```

---

## Frontend Crypto Flow (Runtime)

### sessionKeysRef — Map trong useWebSocket

```
sessionKeysRef.current = Map<cacheKey, CryptoKey>
  1-1:   cacheKey = conversationId
  group: cacheKey = `${groupId}:${peerId}`

Nguồn 1 — getOrCreateSK / getOrCreateGroupSK (khi gửi tin):
  X3DH sender → SK → wrap → lưu IndexedDB
  sessionKeysRef.current.set(cacheKey, SK)

Nguồn 2 — useWebSocket (nhận tin X3DH đầu tiên):
  X3DH receiver → SK → wrap → lưu IndexedDB → set sessionKeysRef

Nguồn 3 — useMessages (lazy-load khi mở conversation):
  loadSession → unwrap SK từ IndexedDB → set sessionKeysRef

useMessages nhận sessionKeysRef từ useWebSocket → chia sẻ cache, không đọc IndexedDB 2 lần
```

### Vòng đời của các key trong RAM

```
wrappingKey (CryptoKey):        sinh khi register/login → tồn tại đến khi logout/reload
IK_secret, SPK_priv (Uint8Array): giống wrappingKey
IK_pub (Uint8Array):            derive từ IK_secret.slice(32)
sessionKeysRef (Map):           tích lũy khi chat → MẤT khi reload (lazy-load lại từ IndexedDB)
EK_priv (Uint8Array):           ephemeral — XÓA ngay sau X3DH
DH1, DH2, DH3, DH4:            intermediate — XÓA ngay sau tính xong SK
fileKey (Uint8Array):           ephemeral — XÓA sau khi wrap vào message payload
```

---

## Database Schema (Prisma)

```prisma
enum Role { USER  ADMIN }

model User {
  id           String   @id @default(uuid())
  username     String   @unique
  email        String   @unique          -- phải có trong AllowedEmail khi đăng ký
  passwordHash String
  role         Role     @default(USER)
  isActive     Boolean  @default(true)   -- false = vô hiệu hóa (soft delete)
  createdAt    DateTime @default(now())

  keyBundle           KeyBundle?
  sentMessages        Message[]       @relation("SentMessages")
  conversationsAsA    Conversation[]  @relation("ConversationA")
  conversationsAsB    Conversation[]  @relation("ConversationB")
  groupMemberships    GroupMember[]
  uploadedFiles       UploadedFile[]
  verificationsGiven    PeerVerification[] @relation("Verifier")
  verificationsReceived PeerVerification[] @relation("Verified")
}

model AllowedEmail {
  id        String    @id @default(uuid())
  email     String    @unique
  usedAt    DateTime?                     -- null = chưa dùng, non-null = đã đăng ký
  createdAt DateTime  @default(now())
}

model KeyBundle {
  id      String @id @default(uuid())
  userId  String @unique
  user    User   @relation(fields: [userId], references: [id])
  ikPub   String              -- base64, Ed25519 public key
  spkPub  String              -- base64, X25519 public key
  spkSig  String              -- base64, Ed25519 signature của SPK_pub
  opkPubs Json[]              -- [{ id: string, pub: string (base64) }], tối đa 100
}

model Conversation {
  id                  String    @id @default(uuid())
  participantA        String
  participantB        String
  fingerprintVerified Boolean   @default(false)
  createdAt           DateTime  @default(now())
  userA    User      @relation("ConversationA", fields: [participantA], references: [id])
  userB    User      @relation("ConversationB", fields: [participantB], references: [id])
  messages Message[]

  @@unique([participantA, participantB])
  @@index([participantA])
  @@index([participantB])
}

model Message {
  id             String        @id @default(uuid())
  conversationId String?       -- null nếu là tin nhắn group
  conversation   Conversation? @relation(fields: [conversationId], references: [id])
  groupId        String?       -- null nếu là tin nhắn 1-1
  group          Group?        @relation(fields: [groupId], references: [id])
  recipientId    String?       -- null với tin 1-1, non-null với tin group (mỗi bản ghi = 1 người nhận)
  senderId       String
  sender         User          @relation("SentMessages", fields: [senderId], references: [id])
  ciphertext     String        -- base64, nội dung đã mã hóa
  iv             String        -- base64, 12 bytes, random mỗi tin
  aad            String        -- "conversationId:senderId" hoặc "groupId:senderId"
  ekPub          String?       -- X3DH init: EK_pub của sender
  opkId          String?       -- X3DH init: ID của OPK đã dùng
  ikPub          String?       -- X3DH init: IK_pub của sender
  createdAt      DateTime      @default(now())

  @@unique([conversationId, iv])   -- chống replay attack trong 1-1
  @@unique([groupId, recipientId, iv])  -- chống replay attack trong group
  @@index([conversationId, createdAt(sort: Desc)])
  @@index([groupId, recipientId, createdAt(sort: Desc)])
}

model Group {
  id        String        @id @default(uuid())
  name      String
  createdAt DateTime      @default(now())
  members   GroupMember[]
  messages  Message[]
}

model GroupMember {
  groupId   String
  userId    String
  role      String        @default("MEMBER")  -- "ADMIN" | "MEMBER"
  joinedAt  DateTime      @default(now())
  group     Group         @relation(fields: [groupId], references: [id])
  user      User          @relation(fields: [userId], references: [id])

  @@id([groupId, userId])
}

model UploadedFile {
  id         String   @id @default(uuid())
  uploaderId String
  uploader   User     @relation(fields: [uploaderId], references: [id])
  createdAt  DateTime @default(now())
  -- file lưu tại /app/uploads/{id} (Docker volume)
  -- server chỉ thấy encrypted bytes, không biết nội dung hay loại file
}

model PeerVerification {
  verifierId  String
  peerId      String
  verifiedAt  DateTime @default(now())
  verifier    User     @relation("Verifier", fields: [verifierId], references: [id])
  peer        User     @relation("Verified", fields: [peerId], references: [id])

  @@unique([verifierId, peerId])   -- mỗi cặp (A→B) chỉ 1 bản ghi, upsert idempotent
}
```

---

## API Endpoints

### Auth
| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /auth/register | ❌ | Đăng ký (email whitelist, bcrypt cost 12, trả userId+role) |
| POST | /auth/login | ❌ | Đăng nhập, check isActive, trả JWT + role |
| POST | /auth/logout | ✅ | Thu hồi JWT vào Redis blocklist |

### Keys
| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /keys/upload | ✅ | Upload IK+SPK+OPK lần đầu (409 nếu gọi lần 2) |
| GET | /keys/:userId | ✅ | Fetch key bundle (pop 1 OPK, emit low_opk WS khi < 10) |
| POST | /keys/opk | ✅ | Thêm OPK khi sắp hết (max 100) |
| POST | /keys/spk | ✅ | Rotate SPK định kỳ |

### Conversations (1-1)
| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /conversations | ✅ | Tạo conversation, idempotent |
| GET | /conversations | ✅ | Danh sách, kèm peer.ikPub + peer.isActive + lastMessageAt |
| PATCH | /conversations/:convId/fingerprint | ✅ | fingerprintVerified=true + ghi PeerVerification |
| DELETE | /conversations/:convId | ✅ | Xóa conversation + tin nhắn |

### Messages
| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /messages/:convId | ✅ | Load lịch sử 1-1, cursor pagination |
| POST | /messages | ✅ | Lưu tin 1-1 hoặc N bản group song song, relay WS |
| GET | /messages/group/:groupId | ✅ | Load lịch sử group của user hiện tại |
| DELETE | /messages/:messageId | ✅ | Xóa tin (chỉ người gửi) |

### Groups
| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /groups | ✅ | Tạo nhóm |
| GET | /groups | ✅ | Danh sách nhóm của user |
| GET | /groups/:groupId/members | ✅ | Thành viên + isVerifiedByMe |
| POST | /groups/:groupId/members | ✅ | Thêm thành viên (admin only) |
| DELETE | /groups/:groupId/members/:userId | ✅ | Xóa thành viên (admin only) |

### Files
| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /files/upload | ✅ | Upload encrypted bytes (multer, max 10MB), trả fileId |
| GET | /files/:fileId | ✅ | Download encrypted bytes |

### Users & Peers
| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /users?search= | ✅ | Tìm kiếm user (isActive=true, max 20, loại bỏ bản thân) |
| PATCH | /peers/:peerId/verify | ✅ | Đánh dấu đã verify fingerprint (upsert idempotent) |

### Admin (role=ADMIN)
| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /admin/users | ✅ ADMIN | Danh sách user + role + isActive |
| PATCH | /admin/users/:id/disable | ✅ ADMIN | Vô hiệu hóa user |
| PATCH | /admin/users/:id/enable | ✅ ADMIN | Kích hoạt lại |
| PATCH | /admin/users/:id/grant-admin | ✅ ADMIN | Cấp quyền ADMIN |
| PATCH | /admin/users/:id/revoke-admin | ✅ ADMIN | Thu hồi quyền ADMIN (FOR UPDATE lock) |
| GET | /admin/whitelist | ✅ ADMIN | Danh sách AllowedEmail |
| POST | /admin/whitelist | ✅ ADMIN | Thêm email vào whitelist |
| DELETE | /admin/whitelist/:id | ✅ ADMIN | Xóa email khỏi whitelist |

### WebSocket
| Protocol | Path | Auth | Mô tả |
|----------|------|------|-------|
| WS | /ws?token= | ✅ JWT query param | Real-time relay + Online Status |

---

## Known Limitations (ghi vào báo cáo)

### Single-device
```
Private key chỉ tồn tại trong IndexedDB của thiết bị đăng ký.
Giải pháp trong scope: Export/Import thủ công qua file .e2ee (Luồng 7).
Giải pháp ngoài scope: Signal Sesame Protocol (multi-device sync).

Câu trả lời GV: "Trade-off có chủ ý: bảo mật hơn (key không lên server)
               nhưng kém tiện lợi. Giải quyết một phần bằng export/import."
```

### In-memory WebSocket relay
```
clients Map sống trong RAM của 1 Node.js process.
Scale ngang: mỗi instance có Map riêng → không relay cross-instance.
Giải pháp ngoài scope: Redis Pub/Sub.
```

### Group chat không có Double Ratchet
```
Group dùng "N tin 1-1 song song" — không có Sender Keys hay MLS.
Không scale tốt cho group > 20 người (N² tin nhắn).
Phù hợp với công ty nhỏ nội bộ.
```

### Sidebar không preview tin nhắn
```
Server chỉ có ciphertext. Lazy-load SK khi mở conversation → không có plaintext sẵn.
Đây là hệ quả đúng của Blind Server model, không phải thiếu sót kỹ thuật.
```

---

## Phần mở rộng: Nếu cần scale

```
WebSocket: Redis Pub/Sub — mỗi instance subscribe "user:{userId}"
Group file: CDN cho encrypted bytes thay vì lưu disk
Admin: Audit log bảng AuditLog
Multi-device: Sesame Protocol
```
