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
├── pages/           # Register.jsx, Login.jsx, Chat.jsx
│                    # Mỗi page = 1 route, chứa layout và kết nối hooks
├── components/      # Sidebar, ConversationItem, MessageList, MessageBubble,
│                    # MessageInput, FingerprintModal
│                    # Mỗi component = pure UI, nhận props, không gọi API trực tiếp
├── hooks/           # useAuth.js, useWebSocket.js, useMessages.js
│                    # Custom hooks đóng gói side effects (fetch, WebSocket, crypto)
├── contexts/        # AuthContext.jsx
│                    # Chia sẻ token + private keys (trong RAM) cho toàn app
├── crypto/          # keyGen.js, x3dh.js, aesGcm.js, fingerprint.js
│                    # Pure JS — không có React, không có fetch
│                    # Có thể test độc lập trong browser console
├── db/              # storage.js
│                    # Dexie.js wrapper cho IndexedDB
│                    # Server không bao giờ thấy dữ liệu này
└── services/        # api.js (REST), socket.js (WebSocket singleton)
                     # Không có logic crypto hay React ở đây
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

```
Browser (Alice)
  1. Sinh Identity Key (IK)    = crypto_sign_keypair()       → Ed25519 keypair, vĩnh viễn
     IK_pub  = 32 bytes  (Ed25519 public key)
     IK_priv = 64 bytes  (libsodium format: seed 32B + public 32B ghép lại)
     Lý do dùng Ed25519 thay vì X25519:
       IK cần ký SPK bằng Ed25519 → bắt buộc phải là Ed25519 keypair
       Khi dùng IK trong DH: convert sang X25519 bằng crypto_sign_ed25519_sk/pk_to_curve25519()

  2. Sinh Signed PreKey (SPK)  = crypto_box_keypair()        → X25519 keypair, 32 bytes mỗi chiều
     SPK_sig = Ed25519.sign(IK_priv, SPK_pub)               → ký để chứng minh SPK là của Alice

  3. Sinh 100 One-Time PreKey (OPK) = crypto_box_keypair() × 100  → X25519, mỗi cái dùng 1 lần

  4. Sinh wrapSalt = crypto.getRandomValues(16 bytes)        ← random salt, lưu cùng keys
     wrappingKey = PBKDF2-SHA256(password, wrapSalt, 600_000)  ← chạy 1 LẦN DUY NHẤT

  5. Wrap từng private key bằng wrappingKey (chỉ AES-GCM, không chạy PBKDF2 lại):
     { wrapped: IK_priv,  iv: ivIK  } = AES-GCM.encrypt(IK_priv,  wrappingKey)
     { wrapped: SPK_priv, iv: ivSPK } = AES-GCM.encrypt(SPK_priv, wrappingKey)
     wrappedOPKs[i] = { id, wrapped, iv } × 100
     → Tổng 102 lần AES-GCM, ~vài ms, không lặp PBKDF2 → toàn bộ quá trình ~1-2 giây

  6. Lưu vào IndexedDB: { wrapSalt, wrappedIK, ivIK, wrappedSPK, ivSPK, wrappedOPKs[] }
     wrapSalt phải được lưu cùng — dùng khi login để derive lại wrappingKey

  7. POST /auth/register {
       username, passwordHash(bcrypt),
       IK_pub, SPK_pub, SPK_sig,
       OPK_pubs[100]            ← chỉ public key, KHÔNG có private key
     }

Server
  → hash password bằng bcrypt (cost factor 12 = 2^12 = 4096 vòng lặp)
  → lưu User + KeyBundle vào PostgreSQL
  → trả JWT token
```

**Tại sao PBKDF2 chỉ chạy 1 lần?**
- PBKDF2 với 600_000 iterations mất ~0.5 giây/lần trên hardware thông thường
- Nếu derive trong mỗi lần wrapPrivateKey: 102 × 0.5s = ~51 giây — không thể dùng được
- Giải pháp: derive wrappingKey (CryptoKey) 1 lần, dùng để AES-GCM wrap tất cả — mỗi AES-GCM chỉ tốn vài ms

**Tại sao 2 hàm hash khác nhau?**
- PBKDF2 (client): Web Crypto API native hỗ trợ, dùng để wrap private key trước khi lưu IndexedDB
- bcrypt (server): cost factor 12, ~300ms/hash trên phần cứng thông thường, đủ chậm để chống brute force password

---

## Luồng 2: Đăng nhập

```
Browser
  1. POST /auth/login { username, password }
  2. Server: bcrypt.compare(password, storedHash) → đúng → trả { token, userId, username }
  3. Browser nhận JWT, lưu vào memory (không lưu localStorage)

  4. Kiểm tra thiết bị:
     hasKeys = IndexedDB.privateKeys.get(userId) !== null
     - false → gọi POST /auth/logout (revoke token ngay)
               throw Error('DEVICE_NOT_REGISTERED')
               Login.jsx hiển thị: "Tài khoản này đã đăng ký trên thiết bị khác"
                                   + UI import file .e2ee
     - true  → tiếp tục

  5. Derive wrappingKey (1 lần):
     data = IndexedDB.privateKeys.get(userId)
     wrappingKey = PBKDF2(password, fromBase64(data.wrapSalt), 600_000)
     Nếu password sai: AES-GCM.decrypt sẽ throw DOMException → bắt → throw 'Sai mật khẩu'

  6. Unwrap private keys:
     IK_priv  = AES-GCM.decrypt(data.wrappedIK,  wrappingKey, data.ivIK)
     SPK_priv = AES-GCM.decrypt(data.wrappedSPK, wrappingKey, data.ivSPK)
     → private keys sẵn sàng trong RAM

  7. Session Keys (SK) KHÔNG load sẵn — lazy-load khi user mở conversation:
     Khi mở conversation X: loadSession(X) → unwrap SK → đưa vào sessionKeys Map
     Lý do: Không biết trước user sẽ mở conversation nào; load tất cả lãng phí
```

**Tại sao không lưu token trong localStorage?**
- localStorage bị đọc bởi bất kỳ JS nào trên cùng origin (kể cả XSS)
- Lưu trong RAM (React state): tab đóng → token biến mất → không bị lấy qua XSS tồn tại lâu dài

---

## Luồng 3: X3DH — Thiết lập phiên chat lần đầu

**Tình huống:** Alice muốn nhắn tin cho Bob lần đầu. Bob có thể đang offline.

```
Alice (Sender)                              Server                    Bob (Receiver)

Bước 1: Lấy key bundle của Bob
  GET /keys/bob ──────────────────────────► trả IK_pub_B, SPK_pub_B,
                                            SPK_sig, OPK_pub_B
                                            (xóa OPK_B này khỏi pool)

Bước 2: Verify chữ ký SPK
  Ed25519.verify(IK_pub_B, SPK_sig, SPK_pub_B)
  → false → DỪNG (server có thể đã giả mạo SPK)
  → true  → tiếp tục

Bước 3: Sinh Ephemeral Key (chỉ dùng 1 lần)
  EK = crypto_box_keypair()

Bước 4: Tính 4 phép Diffie-Hellman
  DH1 = X25519(IK_priv_A,  SPK_pub_B)  ← mutual authentication
  DH2 = X25519(EK_priv_A,  IK_pub_B)   ← mutual authentication
  DH3 = X25519(EK_priv_A,  SPK_pub_B)  ← forward secrecy
  DH4 = X25519(EK_priv_A,  OPK_pub_B)  ← forward secrecy (OPK dùng 1 lần)

Bước 5: Derive Session Key bằng HKDF-SHA256
  F   = 0xFF × 32 bytes           (phân biệt X25519 với X448 theo Signal spec)
  IKM = F || DH1 || DH2 || DH3 || DH4
  SK  = HKDF-SHA256(IKM, salt=0x00×32, info="E2EEChat_v1", length=32)

Bước 6: Lưu SK vào IndexedDB, xóa vật liệu tạm khỏi RAM
  wrappedSK = AES-GCM.encrypt(SK, wrappingKey)
  IndexedDB.sessions.put({ conversationId, wrappedSK })
  EK_priv_A, DH1, DH2, DH3, DH4 → null  ← XÓA ngay, đây là điều kiện bắt buộc cho Forward Secrecy
  SK vẫn giữ trong RAM để dùng ngay, wrappedSK trong IndexedDB để khôi phục sau khi refresh

Bước 7: Gửi tin đầu tiên
  POST /messages {
    IK_pub_A, EK_pub_A, OPK_id,   ← Bob cần để tính lại SK
    IV, ciphertext, auth_tag, AAD  ← tin nhắn đã mã hóa
  }

                                              Bob online, nhận tin:
Bước 8: Bob tính lại SK (chiều ngược)
  DH1 = X25519(SPK_priv_B, IK_pub_A)
  DH2 = X25519(IK_priv_B,  EK_pub_A)
  DH3 = X25519(SPK_priv_B, EK_pub_A)
  DH4 = X25519(OPK_priv_B[OPK_id], EK_pub_A)
  SK  = HKDF-SHA256(F||DH1||DH2||DH3||DH4, ...) → ra cùng SK
  Xóa OPK_priv_B đã dùng
  Giải mã tin nhắn
```

**Lưu ý quan trọng:** Từ tin nhắn thứ 2 trở đi, không cần X3DH nữa. Chỉ dùng SK đã có để AES-GCM.

---

## Luồng 4: Gửi tin nhắn (AES-256-GCM)

```
Alice muốn gửi "Xin chào Bob":

  IV  = crypto.getRandomValues(12 bytes)  ← PHẢI random mỗi tin, không được trùng
  AAD = `${conversationId}:${senderId}`  ← không mã hóa nhưng được xác thực, buộc ciphertext vào đúng conversation + người gửi
  
  { ciphertext, auth_tag } = AES-256-GCM encrypt(plaintext, SK, IV, AAD)
  
  Gửi qua WebSocket: { conversationId, IV, ciphertext, auth_tag, AAD }
  
  Server lưu DB → relay trực tiếp đến Bob qua in-memory Map → Bob nhận
  
  Bob giải mã: AES-256-GCM decrypt(ciphertext, SK, IV, AAD, auth_tag)
  → auth_tag sai (bị tamper) → throw error, không hiển thị tin
  → auth_tag đúng → hiển thị plaintext
```

**Tại sao AAD quan trọng?**
Nếu không có AAD, attacker có thể thay senderId hoặc timestamp mà AES-GCM không phát hiện.
Với AAD, bất kỳ thay đổi nào ở metadata → auth_tag sai → decrypt fail.

---

## Luồng 5: WebSocket + In-Memory Relay

```
Bob gửi tin cho Alice:

Bob ──WS──► Server (handler.js)
                │
                ├─1. INSERT vào PostgreSQL ← lưu trước, không mất tin khi sập
                │
                └─2. clients.get("alice_uuid")?.send(message) ← relay ngay nếu Alice online

clients = Map<userId, WebSocket> — sống trong RAM của tiến trình Node.js
```

**Tại sao lưu DB TRƯỚC, relay SAU?**
- Nếu relay trước rồi sập: Alice nhận tin nhưng reload app thì tin biến mất khỏi lịch sử
- Nếu lưu DB trước rồi sập: tin đã an toàn trong DB, Alice chỉ cần reload là thấy
- Chênh lệch thời gian 5–15ms, người dùng không cảm nhận được
- Phù hợp với đồ án 1 server instance, ưu tiên độ chính xác hơn tốc độ

**Xử lý khi Bob offline:**
- clients.get(receiverId) trả undefined → bỏ qua relay
- Tin đã lưu DB → Bob load lịch sử khi online là thấy đủ

**Hạn chế (ghi vào báo cáo):**
Kiến trúc này chỉ phù hợp 1 server instance. Nếu scale ngang nhiều instance,
phải thay bằng Redis Pub/Sub để các instance đồng bộ danh sách clients với nhau.
Với quy mô đồ án (nội bộ doanh nghiệp, 1 instance), đây là lựa chọn đơn giản và đủ dùng.

---

## Luồng 6: Fingerprint Verification (chống MITM)

```
Alice và Bob đều tính fingerprint độc lập:

  sorted_keys = sort([IK_pub_Alice, IK_pub_Bob])  ← sort canonical để 2 bên ra cùng kết quả
  hash = SHA-512(sorted_keys)
  for i in range(5199): hash = SHA-512(hash)      ← lặp 5200 vòng, chống brute force
  fingerprint = BigInt(hash) % 10^60              ← chuyển thành 60 chữ số decimal

Alice đọc 60 chữ số cho Bob nghe qua điện thoại (kênh ngoài).
Bob so sánh với fingerprint trên màn hình.
Khớp → đánh dấu conversation.fingerprintVerified = true → mới cho phép chat.
Không khớp → dừng, có thể đang bị MITM.
```

---

## Luồng 7: Chuyển thiết bị (Export / Import key)

**Bối cảnh:** Private key chỉ tồn tại trong IndexedDB của thiết bị đăng ký.
Nếu dùng thiết bị mới (hoặc xóa IndexedDB), login sẽ bị block ở bước kiểm tra thiết bị (Luồng 2, bước 4).
Giải pháp: export backup file `.e2ee` từ thiết bị cũ, import vào thiết bị mới.

```
EXPORT (trên thiết bị cũ)
  1. Login thành công (thiết bị cũ có IndexedDB)
  2. User bấm "Export backup"
  3. data = IndexedDB.privateKeys.get(userId)
     → data chứa: { userId, wrapSalt, wrappedIK, ivIK, wrappedSPK, ivSPK, wrappedOPKs[] }
     → tất cả đã wrap bằng password — plaintext private key KHÔNG bao giờ xuất hiện trong file
  4. blob = JSON.stringify(data) → download file e2ee-keys-{userId}.e2ee

IMPORT (trên thiết bị mới)
  1. User truy cập Login page → nhận lỗi DEVICE_NOT_REGISTERED
  2. User upload file .e2ee
  3. data = JSON.parse(file) → validate cấu trúc
  4. IndexedDB.privateKeys.put(data)
  5. Login bình thường: PBKDF2(password, data.wrapSalt) → unwrap keys → vào chat
```

**Bảo mật của file .e2ee:**
- File chứa wrapped keys — private key vẫn được mã hóa bằng password
- Kẻ có file .e2ee mà không biết password: không thể decrypt → không lấy được private key
- Kẻ có cả file .e2ee và password: có thể giả danh user — tương đương bị lộ cả username + password
- Kết luận: backup file an toàn nếu password đủ mạnh, tương tự file backup mã hóa của các ứng dụng khác

**Hạn chế còn lại:**
- Người dùng phải tự quản lý file backup — không có auto-sync
- Session Keys (SK) không được export → sau khi import thiết bị mới, cần X3DH lại với mỗi conversation
  Điều này xảy ra tự nhiên: thiết bị mới không có sessions trong IndexedDB → tin đầu tiên gửi sẽ trigger X3DH

---

## Frontend Crypto Flow (Runtime)

### sessionKeys — Map<conversationId, CryptoKey>

```
Sống trong RAM tại Chat.jsx:
  const [sessionKeys, setSessionKeys] = useState(new Map())

Nguồn 1 — handleSend (gửi tin X3DH đầu tiên):
  X3DH sender → SK (CryptoKey, extractable: true)
  exportKey('raw', SK) → raw bytes → wrap → lưu IndexedDB
  setSessionKeys(prev => new Map(prev).set(conversationId, SK))

Nguồn 2 — useWebSocket (nhận tin X3DH đầu tiên từ người khác):
  X3DH receiver → SK → wrap → lưu IndexedDB → setSessionKeys(...)

Nguồn 3 — useMessages (lazy-load khi mở conversation):
  loadSession(conversationId) → { wrappedSK, ivSK }
  SK_raw = AES-GCM.decrypt(wrappedSK, wrappingKey, ivSK)
  SK = importKey('raw', SK_raw, 'AES-GCM', true, ['encrypt','decrypt'])
  setSessionKeys(prev => new Map(prev).set(conversationId, SK))
```

### Tại sao SK import với `extractable: true`?
```
extractable: false (mặc định):
  SK không thể exportKey → không lưu được vào IndexedDB
  Reload trang → SK mất → không đọc được lịch sử, không gửi được tin

extractable: true:
  SK có thể exportKey('raw') → wrap bằng wrappingKey → lưu IndexedDB
  Reload trang → loadSession → unwrap → importKey lại → tiếp tục dùng

Rủi ro của extractable: true:
  Về lý thuyết, code JS khác có thể exportKey nếu có tham chiếu đến SK
  Trong thực tế: SK chỉ nằm trong sessionKeys Map trong React state
  Không bị lộ ra ngoài nếu không có XSS và app được viết đúng
```

### Vòng đời của các key trong RAM
```
wrappingKey (CryptoKey):   sinh khi register/login → tồn tại đến khi logout
IK_priv, SPK_priv (Uint8Array): giống wrappingKey
sessionKeys (Map):         tích lũy khi chat → mất khi reload (lazy-load lại từ IndexedDB)
EK_priv (Uint8Array):      ephemeral — XÓA ngay sau X3DH, không giữ trong RAM
DH1, DH2, DH3, DH4:        intermediate — XÓA ngay sau tính xong SK
```

---

## Database Schema (Prisma)

```prisma
model User {
  id           String        @id @default(uuid())
  username     String        @unique
  passwordHash String
  createdAt    DateTime      @default(now())
  keyBundle    KeyBundle?
  sentMessages     Message[]      @relation("SentMessages")
  conversationsAsA Conversation[] @relation("ConversationA")
  conversationsAsB Conversation[] @relation("ConversationB")
}

model KeyBundle {
  id      String @id @default(uuid())
  userId  String @unique
  user    User   @relation(fields: [userId], references: [id])
  ikPub   String   -- base64, Identity Key public
  spkPub  String   -- base64, Signed PreKey public
  spkSig  String   -- base64, Ed25519 signature của SPK trên SPK_pub
  opkPubs Json[]   -- mỗi phần tử: { id: string, pub: string (base64) }, tối đa 100
}

model Conversation {
  id                  String    @id @default(uuid())
  participantA        String    -- userId của user A
  participantB        String    -- userId của user B
  fingerprintVerified Boolean   @default(false)  -- bắt buộc true trước khi chat
  createdAt           DateTime  @default(now())
  userA    User      @relation("ConversationA", fields: [participantA], references: [id])
  userB    User      @relation("ConversationB", fields: [participantB], references: [id])
  messages Message[]

  @@unique([participantA, participantB])  -- mỗi cặp chỉ có 1 conversation
  @@index([participantA])
  @@index([participantB])
}

model Message {
  id             String       @id @default(uuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id])
  senderId       String
  sender         User         @relation("SentMessages", fields: [senderId], references: [id])
  ciphertext     String       -- base64, nội dung đã mã hóa
  iv             String       -- base64, 12 bytes, random mỗi tin
  aad            String       -- format: "conversationId:senderId" — authenticated but not encrypted
  -- 3 trường sau CHỈ có ở tin đầu tiên của X3DH init message, null ở mọi tin còn lại:
  ekPub          String?      -- base64, Ephemeral Key public của sender
  opkId          String?      -- ID của OPK đã dùng (để Bob tìm đúng OPK_priv)
  ikPub          String?      -- base64, Identity Key public của sender (để Bob tính DH1)
  createdAt      DateTime     @default(now())

  @@unique([conversationId, iv])                    -- IV phải duy nhất trong conversation — chống replay attack
  @@index([conversationId, createdAt(sort: Desc)]) -- pagination nhanh
}
```

---

## API Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /auth/register | ❌ | Đăng ký tài khoản (bcrypt cost 12 hash password) |
| POST | /auth/login | ❌ | Đăng nhập, nhận JWT |
| POST | /auth/logout | ✅ JWT | Thu hồi JWT vào Redis blocklist |
| POST | /keys/upload | ✅ JWT | Upload IK+SPK+OPK lần đầu (1 lần duy nhất) |
| GET | /keys/:userId | ✅ JWT | Bob fetch key Alice (pop 1 OPK, emit low_opk WS khi < 10) |
| POST | /keys/opk | ✅ JWT | Thêm OPK khi sắp hết (max 100, trả added/previous/current) |
| POST | /keys/spk | ✅ JWT | Rotate SPK định kỳ (chỉ thay spkPub+spkSig) |
| POST | /conversations | ✅ JWT | Tạo conversation giữa 2 user, idempotent (tìm cả 2 chiều) |
| GET | /conversations | ✅ JWT | Danh sách conversation, kèm `peer: {id, username}` + lastMessageAt, sort mới nhất trước |
| PATCH | /conversations/:convId/fingerprint | ✅ JWT | Đánh dấu fingerprintVerified=true (chỉ member, không cho unverify) |
| DELETE | /conversations/:convId | ✅ JWT | Xóa conversation + toàn bộ tin nhắn (chỉ member) |
| GET | /messages/:convId | ✅ JWT | Load lịch sử, cursor pagination (orderBy createdAt desc) |
| POST | /messages | ✅ JWT | Lưu ciphertext (server không giải mã), hỗ trợ ekPub+opkId+ikPub cho X3DH init |
| DELETE | /messages/:messageId | ✅ JWT | Xóa 1 tin nhắn (chỉ người gửi mới xóa được) |
| GET | /users?search= | ✅ JWT | Tìm kiếm user theo username (contains, insensitive, max 20, loại bỏ bản thân) |
| WS | /ws?token= | ✅ JWT (query param) | WebSocket connection + In-Memory relay + Online Status |

---

## Known Limitations (ghi vào báo cáo)

### Single-device
```
Vấn đề: Private key chỉ tồn tại trong IndexedDB của thiết bị đăng ký.
        Dùng thiết bị khác: login thành công nhưng không có key → không giải mã được.

Giải pháp trong scope: Export/Import key thủ công qua file .e2ee (Luồng 7).
                       User tự quản lý backup — không có auto-sync.

Giải pháp ngoài scope: Signal Sesame Protocol — sync key bundle đa thiết bị tự động.
                        Phức tạp hơn nhiều, không triển khai cho đồ án này.

Câu trả lời cho GV: "Đây là trade-off có chủ ý của E2EE single-device.
                    Bảo mật tốt hơn (key không sync lên server) nhưng kém tiện lợi hơn.
                    Giải quyết được một phần bằng export/import thủ công."
```

### In-memory WebSocket relay
```
Vấn đề: clients Map sống trong RAM của 1 Node.js process.
        Scale ngang nhiều instance: mỗi instance có Map riêng → không relay được cross-instance.

Giải pháp trong scope: 1 server instance, đủ cho đồ án nội bộ.

Giải pháp ngoài scope: Redis Pub/Sub — mỗi instance subscribe/publish qua Redis.
```

### Sidebar không hiển thị preview tin nhắn
```
Lý do: Server chỉ có ciphertext, không có plaintext.
       Lazy-load SK khi mở conversation → không có plaintext sẵn trong sidebar.

Đây là hệ quả đúng của Blind Server model — không phải thiếu sót kỹ thuật.
```

---

## Phần mở rộng: Nếu cần scale lên nhiều server instance

Kiến trúc in-memory Map hiện tại đủ cho đồ án 1 instance.
Nếu cần scale ngang, thay thế bằng Redis Pub/Sub:

```
Mỗi server subscribe channel "user:{userId}" trên Redis
Khi relay: redis.publish("user:{receiverId}", payload)
Server nào đang giữ socket của receiver sẽ tự nhận và forward
```

Thay đổi chỉ ở handler.js — không cần sửa routes hay schema.