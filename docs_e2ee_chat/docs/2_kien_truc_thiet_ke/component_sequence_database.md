# Kiến Trúc Thiết Kế — E2EE Chat

---

## 1. Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Browser)                             │
│                                                                          │
│  ┌──────────────┐    ┌──────────────────────────────────────────────┐   │
│  │  React Pages │    │              React Components                 │   │
│  │  ─────────── │    │  ──────────────────────────────────────────  │   │
│  │  Register    │    │  ChatSidebar   MessageList   MessageInput     │   │
│  │  Login       │    │  ConversationItem  GroupItem GroupInfoPanel   │   │
│  │  Chat        │    │  FingerprintModal  ConfirmModal  Avatar       │   │
│  └──────┬───────┘    └──────────────────┬───────────────────────────┘   │
│         │                               │                                │
│         ▼                               ▼                                │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                       React Hooks / Context                       │   │
│  │  AuthContext  │  useWebSocket  │  useMessages                     │   │
│  └──────┬───────────────┬─────────────────┬────────────────────────┘   │
│         │               │                 │                              │
│         ▼               ▼                 ▼                              │
│  ┌──────────┐    ┌───────────┐    ┌────────────────────────────────┐   │
│  │ services │    │  services │    │          crypto/               │   │
│  │ api.js   │    │ socket.js │    │  keyGen.js  x3dh.js            │   │
│  │ (REST)   │    │ (WS)      │    │  aesGcm.js  fingerprint.js     │   │
│  └────┬─────┘    └────┬──────┘    └────────────────────────────────┘   │
│       │               │                           │                      │
│       │               │            ┌──────────────▼──────────────────┐  │
│       │               │            │  db/storage.js  (Dexie/IndexedDB)│  │
│       │               │            └─────────────────────────────────┘  │
└───────┼───────────────┼──────────────────────────────────────────────────┘
        │               │
        │   HTTPS        │  WSS
        ▼               ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                          BACKEND (Node.js / Express)                       │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                          server.js (Entry Point)                      │ │
│  │       Express App    +    http.createServer    +    WebSocket Server  │ │
│  └─────────────────────────────────┬────────────────────────────────────┘ │
│                                    │                                       │
│        ┌───────────────────────────┼──────────────────────┐               │
│        ▼                           ▼                       ▼               │
│  ┌───────────┐              ┌─────────────┐        ┌──────────────┐       │
│  │  REST API  │              │ middleware/  │        │  ws/handler  │       │
│  │  Routes    │              │  auth.js    │        │  (WS relay)  │       │
│  │  ───────── │◄────────────►│  JWT verify │        │  clients Map │       │
│  │  auth.js   │              │  Redis      │        └──────┬───────┘       │
│  │  keys.js   │              │  blocklist  │               │               │
│  │  messages  │              └─────────────┘               │               │
│  │  convs     │                                            │               │
│  │  users     │                                            │               │
│  │  groups    │                                            │               │
│  │  files     │                                            │               │
│  └─────┬──────┘                                           │               │
│        │                                                  │               │
└────────┼──────────────────────────────────────────────────┼───────────────┘
         │                                                  │
    ┌────▼────────────┐                              ┌──────▼──────┐
    │   PostgreSQL     │                              │    Redis     │
    │  (Prisma ORM)    │                              │  JWT        │
    │  User            │                              │  blocklist  │
    │  KeyBundle       │                              └─────────────┘
    │  Conversation    │
    │  Message         │
    │  Group           │
    │  GroupMember     │
    │  UploadedFile    │
    │  AllowedEmail    │
    └──────────────────┘
```

**Nguyên tắc phân tầng Frontend:**
```
Pages/Components → Hooks/Context → Services / Crypto / DB
     ↑                                    (1 chiều duy nhất)

- crypto/ : pure JS, không import React, không gọi API
- db/     : chỉ đọc/ghi IndexedDB, không có logic crypto
- services/: không import React, không có logic crypto
```

---

## 2. Sequence Diagrams

### SD-01: Đăng Ký (Register + Upload Key)

```
Browser (Alice)          server.js / auth.js       PostgreSQL    IndexedDB
      │                         │                       │              │
      │── (1) generateIdentityKey() ───────────────────────────────── │
      │── (2) generateSignedPreKey(IK_secret) ──────────────────────── │
      │── (3) generateOneTimePreKeys(100) ─────────────────────────── │
      │── (4) wrapSalt = random(16B) ──────────────────────────────── │
      │── (5) wrappingKey = PBKDF2(password, wrapSalt, 600k) ──────── │
      │── (6) wrapPrivateKey(IK, wrappingKey) ─────────────────────── │
      │── (7) wrapPrivateKey(SPK, wrappingKey) ─────────────────────── │
      │── (8) wrapPrivateKey(each OPK, wrappingKey) ×100 ─────────── │
      │                         │                       │              │
      │──── POST /auth/register ──────────────────────► │              │
      │     {username,email,pw} │                       │              │
      │                         │── bcrypt.hash(pw,12) ─►              │
      │                         │── user.create() ──────► INSERT User  │
      │◄─── {token, userId} ────│                       │              │
      │                         │                       │              │
      │──── POST /keys/upload ──────────────────────────►              │
      │     {ikPub,spkPub,spkSig,opkPubs[100]}          │              │
      │                         │── keyBundle.create() ─► INSERT KeyBundle
      │◄─── 201 Created ────────│                       │              │
      │                         │                       │              │
      │──────────────────────── savePrivateKeys() ──────────────────► │
      │     {wrapSalt,wrappedIK,wrappedSPK,wrappedOPKs[100]}          │
      │                                                 │              │
```

---

### SD-02: Đăng Nhập (Login)

```
Browser (Alice)          server.js / auth.js       PostgreSQL    Redis
      │                         │                       │            │
      │──── POST /auth/login ──────────────────────────►            │
      │     {username, password}│                       │            │
      │                         │── user.findUnique() ──►            │
      │                         │◄─ {passwordHash,...} ─│            │
      │                         │── bcrypt.compare() ───┘            │
      │                         │── jwt.sign({userId}, secret, 7d) ──┘
      │◄─── {token, userId} ────│                       │            │
      │                         │                       │            │
      │── getWrapSalt(userId) ─────────────────────────────────────► │
      │◄─ wrapSalt ────────────────────────────────────────────────── │
      │                         │                       │            │
      │── PBKDF2(password, wrapSalt, 600k) ────────────────────────── │
      │── loadPrivateKeys(userId, wrappingKey) ────────────────────► │
      │   (unwrap IK, SPK, 100 OPK)                                  │
      │◄─ {IK_secret, SPK_priv, opkMap} ──────────────────────────── │
      │                         │                       │            │
      │── AuthContext.set({token, IK_secret, SPK_priv, wrappingKey}) │
      │── connectSocket("ws://server/ws?token=JWT") ────►            │
```

---

### SD-03: Gửi Tin Nhắn Đầu Tiên (X3DH)

```
Alice (Browser)          Server          Bob (Browser)
      │                    │                    │
      │── GET /keys/bob ──►│                    │
      │◄─ {ikPub,spkPub,   │                    │
      │    spkSig,opkPub,  │ (server pop 1 OPK  │
      │    opkId}          │  khỏi pool)        │
      │                    │                    │
      │── verifySignedPreKey(ikPub_B, spkSig, spkPub_B)
      │   → true (bình thường) / throw nếu MITM
      │                    │                    │
      │── EK = random X25519 keypair ──────────────────
      │── DH1 = X25519(IK_priv_A, SPK_pub_B)
      │── DH2 = X25519(EK_priv, IK_pub_B_x25519)
      │── DH3 = X25519(EK_priv, SPK_pub_B)
      │── DH4 = X25519(EK_priv, OPK_pub_B)
      │── IKM = F||DH1||DH2||DH3||DH4 (160B)
      │── SK = HKDF-SHA256(IKM, salt=0×32, info="E2EEChat_v1")
      │── xóa DH1..DH4, EK_priv khỏi RAM (.fill(0))
      │                    │                    │
      │── IV = random(12B) ─────────────────────────────
      │── AAD = "{convId}:{Alice_userId}"
      │── ciphertext = AES-256-GCM(plaintext, SK, IV, AAD)
      │                    │                    │
      │── WS send {convId, ciphertext, iv, aad, │
      │            ekPub, opkId, ikPub} ─────►  │
      │                    │── INSERT Message ──►│
      │◄─── ack ───────────│────────────────────►│ WS relay
      │                    │                    │
      │                    │                    │── OPK_priv = getOPK(opkId)
      │                    │                    │── DH1 = X25519(SPK_priv_B, IK_pub_A_x25519)
      │                    │                    │── DH2 = X25519(IK_priv_B, EK_pub_A)
      │                    │                    │── DH3 = X25519(SPK_priv_B, EK_pub_A)
      │                    │                    │── DH4 = X25519(OPK_priv_B, EK_pub_A)
      │                    │                    │── SK = HKDF(...IKM) — same SK!
      │                    │                    │── plaintext = AES-GCM.decrypt(...)
      │                    │                    │── deleteOPK(opkId) — dùng 1 lần
```

---

### SD-04: Xác Minh Fingerprint

```
Alice (Browser)                        Bob (Browser)
      │                                      │
      │── generateFingerprint(IK_A, IK_B)   │── generateFingerprint(IK_A, IK_B)
      │   sorted = lex_sort([IK_A, IK_B])   │   sorted = lex_sort([IK_A, IK_B])
      │   combined = sort[0] || sort[1]     │   combined = sort[0] || sort[1]
      │   hash = SHA-512(combined)          │   hash = SHA-512(combined)
      │   for 5199 vòng: SHA-512(hash)      │   for 5199 vòng: SHA-512(hash)
      │   digits = BigInt(hash) % 10^60     │   digits = BigInt(hash) % 10^60
      │                                      │
      │ Alice: "xin đọc 60 chữ số..." ──────►│ Bob so sánh với màn hình
      │                                      │ Khớp → Bob bấm xác nhận
      │                                      │── PATCH /conversations/{id}/fingerprint
      │◄────────── WS: verified ─────────────│
      │── setIsVerified(true) ───────────────│── setIsVerified(true)
```

---

### SD-05: Tải Lịch Sử Tin Nhắn (Cursor Pagination)

```
Alice (Browser)                Server             PostgreSQL
      │                           │                    │
      │── GET /messages/{convId}?limit=20 ──────────►  │
      │                           │── findMany({        │
      │                           │     orderBy: {      │
      │                           │       createdAt:'desc'},
      │                           │     take: 20        │
      │                           │   }) ───────────────►
      │◄── {messages:[...20 tin], │◄── rows ────────────│
      │     nextCursor: id_tin_20}│                    │
      │                           │                    │
      │── giải mã từng tin bằng SK│                    │
      │── hiển thị 20 tin mới nhất│                    │
      │                           │                    │
      │ [User scroll lên đỉnh]    │                    │
      │                           │                    │
      │── GET /messages/{convId}?limit=20&cursor={id_tin_20}
      │                           │── findMany({        │
      │                           │     cursor:{id:...},│
      │                           │     skip:1, take:20 │
      │                           │   }) ───────────────►
      │◄── {messages:[...], nextCursor:...}             │
```

**Cursor pagination vs offset:**
Offset (`LIMIT 20 OFFSET 100`) chậm dần theo số dòng vì DB phải scan và bỏ qua 100 dòng đầu. Cursor dùng index trực tiếp → O(log n) thay vì O(n).

---

## 3. Database Schema — Mô Tả Chi Tiết

### Sơ đồ quan hệ

```
User ──1:1── KeyBundle          (mỗi user có 1 bộ public key)
User ──1:N── Message (sender)   (user gửi nhiều tin)
User ──1:N── Message (recipient)
User ──M:N── Conversation        (qua participantA/B)
User ──M:N── Group               (qua GroupMember)
User ──1:1── Group (creator)

Conversation ──1:N── Message
Group ────────1:N── Message
Group ────────1:N── GroupMember
```

---

### Bảng `User`

```
id           String   @id @default(uuid())    ← UUID v4, không đoán được
username     String   @unique                 ← tên đăng nhập
email        String   @unique                 ← phải có trong AllowedEmail
passwordHash String                           ← BCrypt(cost=12), KHÔNG lưu plaintext
createdAt    DateTime @default(now())
```

**Tại sao UUID thay vì auto-increment?**
Auto-increment (1, 2, 3...) bị đoán: kẻ tấn công thử `/users/1`, `/users/2` để crawl. UUID không đoán được.

**Tại sao BCrypt cost=12?**
Mỗi lần hash tốn ~250ms. Brute-force 1 triệu password = 250.000 giây ≈ 3 ngày. Cost=12 là cân bằng giữa bảo mật và UX.

---

### Bảng `KeyBundle`

```
id     String @id
userId String @unique     ← foreign key → User
ikPub  String             ← base64 Ed25519 public key (32B)
spkPub String             ← base64 X25519 public key (32B)
spkSig String             ← base64 Ed25519 signature (64B) của IK_priv trên SPK_pub
opkPubs Json[]            ← mảng [{id: UUID, pub: base64}] — pool OPK còn lại
```

**Đây là bảng đặc trưng nhất của hệ thống E2EE.** Hệ thống chat thông thường không có bảng này.
Server chỉ thấy public key — private key không bao giờ rời khỏi trình duyệt.

**`opkPubs Json[]`:** Mỗi khi Bob fetch key Alice, server **pop** (xóa) 1 OPK khỏi mảng. OPK dùng 1 lần để đảm bảo forward secrecy — nếu session key bị lộ sau này, các session trước vẫn an toàn vì OPK đã xóa.

---

### Bảng `Conversation`

```
id                  String   @id
participantA        String   ← userId của người tạo conversation
participantB        String   ← userId của người kia
fingerprintVerified Boolean  @default(false)   ← false = MessageInput bị disabled
createdAt           DateTime

@@unique([participantA, participantB])    ← tránh duplicate
@@index([participantA])                  ← tìm nhanh conv của user A
@@index([participantB])                  ← tìm nhanh conv của user B
```

**`fingerprintVerified`:** Cột boolean này là cơ chế ép buộc verify MITM. Frontend đọc trường này và disable ô nhập tin nếu `false`.

---

### Bảng `Message`

```
id             String    @id
conversationId String?   ← null nếu là tin nhóm
groupId        String?   ← null nếu là tin 1-1
recipientId    String?   ← null nếu là tin 1-1, có giá trị nếu tin nhóm
senderId       String    ← không null

ciphertext     String?   ← base64 AES-256-GCM ciphertext
iv             String?   ← base64 12B random IV
aad            String?   ← "{convId}:{senderId}" — plaintext, không mã hóa

ekPub          String?   ← base64 EK_pub — chỉ có ở tin X3DH đầu tiên
opkId          String?   ← UUID của OPK đã dùng — Bob cần để tìm OPK_priv
ikPub          String?   ← base64 IK_pub của Alice — Bob cần để tính DH1

isSystem       Boolean   @default(false)   ← true = tin hệ thống (thêm/rời nhóm)
systemText     String?                     ← text hiển thị cho tin hệ thống

@@unique([conversationId, iv])             ← chống replay attack (IV không được trùng)
@@unique([groupId, recipientId, iv])
@@index([conversationId, createdAt(sort: Desc)])    ← cursor pagination 1-1
@@index([groupId, recipientId, createdAt(sort: Desc)])  ← cursor pagination group
```

**3 cột `ekPub, opkId, ikPub`:** Chỉ có giá trị ở tin đầu tiên của một session (X3DH initiation message). Bob cần 3 cột này để tính lại SK. Các tin tiếp theo, 3 cột này là `null` — Bob dùng SK đã cache.

**`@@unique([conversationId, iv])`:** Replay attack: kẻ tấn công copy một ciphertext đã gửi và gửi lại. Nếu IV trùng trong cùng conversation → server từ chối (Prisma unique constraint). Nếu IV khác → AES-GCM auth tag sẽ sai.

---

### Bảng `AllowedEmail`

```
id        String    @id
email     String    @unique
usedAt    DateTime?    ← null = chưa dùng, có giá trị = đã đăng ký
```

**Mô hình doanh nghiệp nội bộ:** Admin thêm email nhân viên vào whitelist trước. Chỉ email trong whitelist mới đăng ký được → tránh người ngoài truy cập hệ thống nội bộ.
