# Kiến Trúc Thiết Kế — E2EE Chat
> Toàn bộ sequence diagram viết theo đúng code thực tế

---

## Sequence Diagram SD-01: Đăng Ký

> Nguồn code: `Register.jsx` → `AuthContext.register()` → `api.register()` → `storage.savePrivateKeys()`

```
User        Register Page     Auth Context       Server          PostgreSQL      IndexedDB
 │                │                │                │                │               │
 │─Nhập form─────►│                │                │                │               │
 │                │                │                │                │               │
 │                │──register()───►│                │                │               │
 │                │                │                │                │               │
 │                │          [1] generateIdentityKey()               │               │
 │                │          [2] generateSignedPreKey(IK_secret)     │               │
 │                │          [3] generateOneTimePreKeys(100)         │               │
 │                │          [4] wrapSalt = random(16B)              │               │
 │                │          [5] deriveWrappingKey(password,salt)    │               │
 │                │                │                │                │               │
 │                │                │─POST /auth/register────────────►│               │
 │                │                │  {username,email,password}      │               │
 │                │                │                │─Check ────────►│               │
 │                │                │                │  AllowedEmail  │               │
 │                │                │                │  (hoặc bypass  │               │
 │                │                │                │  nếu ADMIN_    │               │
 │                │                │                │  SEED_EMAIL)   │               │
 │                │                │                │─bcrypt.hash────┘               │
 │                │                │                │─$transaction──►│               │
 │                │                │                │  UPDATE AllowedEmail.usedAt    │
 │                │                │                │  INSERT User (role=USER/ADMIN) │
 │                │                │                │◄──{userId}─────│               │
 │                │                │◄──{userId,msg}─│                │               │
 │                │                │  (KHÔNG có token)               │               │
 │                │                │                │                │               │
 │                │                │──savePrivateKeys(userId,wrapSalt,wKey,IK,SPK,OPKs)──►│
 │                │                │◄──────────────────────────────────────────────OK─│
 │                │                │                │                │               │
 │                │◄──resolve()────│                │                │               │
 │◄─setSuccess(true)               │                │                │               │
 │   navigate('/login') sau 2.5s   │                │                │               │
```

**Điểm quan trọng:**
- `api.register()` chỉ tạo User trong DB, **KHÔNG upload key, KHÔNG trả token**
- Sau khi đăng ký xong → redirect `/login`, user phải đăng nhập thủ công
- Upload key xảy ra ở `AuthContext.login()` vì lúc đó mới có JWT

---

## Sequence Diagram SD-02: Đăng Nhập

> Nguồn code: `Login.jsx` → `AuthContext.login()` → `api.login()`, `storage.*`, `api.uploadKeys()`

```
User       Login Page      Auth Context        Server        PostgreSQL   IndexedDB   Server(Keys)
 │               │               │                │               │            │            │
 │─Nhập form────►│               │                │               │            │            │
 │               │──login()─────►│                │               │            │            │
 │               │               │─POST /auth/login──────────────►│            │            │
 │               │               │  {username,password}           │            │            │
 │               │               │                │─findUser──────►            │            │
 │               │               │                │◄─{pwdHash,isActive,role}   │            │
 │               │               │                │─check isActive             │            │
 │               │               │                │─bcrypt.compare()           │            │
 │               │               │                │─jwt.sign({userId,role},7d) │            │
 │               │               │◄─{token,userId,username,role}──│            │            │
 │               │               │                │               │            │            │
 │               │               │─hasPrivateKeys(userId)────────────────────►│            │
 │               │               │◄─true (hoặc throw DEVICE_NOT_REGISTERED)───│            │
 │               │               │                │               │            │            │
 │               │               │─getWrapSalt(userId)───────────────────────►│            │
 │               │               │◄─wrapSalt──────────────────────────────────│            │
 │               │         [PBKDF2 600k vòng → wKey]              │            │            │
 │               │         [loadPrivateKeys → unwrap IK,SPK,OPKs] │            │            │
 │               │         [Tính lại SPK_pub, spkSig, opkPubs]    │            │            │
 │               │               │                │               │            │            │
 │               │               │─POST /keys/upload──────────────────────────────────────►│
 │               │               │  Authorization: Bearer {token}  │            │            │
 │               │               │  {ikPub,spkPub,spkSig,opkPubs} │            │            │
 │               │               │◄─201 (hoặc 409 → bỏ qua)──────────────────────────────│
 │               │               │                │               │            │            │
 │               │         [localStorage: token,userId,username,role]           │            │
 │               │         [RAM: setWrappingKey,setIKSecret,setSPKPriv,setRole] │            │
 │               │               │                │               │            │            │
 │               │◄─resolve()────│                │               │            │            │
 │               │  isAuthenticated=true → navigate('/chat')       │            │            │
```

---

## Sequence Diagram SD-03: Gửi Tin X3DH Lần Đầu (1-1)

> Nguồn code: `Chat.jsx (getOrCreateSK)` → `x3dh.performX3DH_sender()` → `aesGcm.encryptMessage()`

```
Alice(Browser)    Crypto/Storage      Server(REST)     Server(WS)       Bob(Browser)
      │                  │                  │                │                 │
      │─Gửi tin──────────►                  │                │                 │
      │            [check RAM: không có SK]  │                │                 │
      │            [check IndexedDB: không có SK]             │                 │
      │                  │─GET /keys/{bobId}────────────────►│                 │
      │                  │                  │─pop 1 OPK─────►│                 │
      │                  │◄─{ikPub,spkPub,spkSig,opkPub,opkId}                │
      │                  │                  │                │                 │
      │            [verifySignedPreKey() → true ✓]           │                 │
      │            [EK = crypto_box_keypair()]                │                 │
      │            [DH1=X25519(IK_priv,SPK_B)]               │                 │
      │            [DH2=X25519(EK,IK_B_x25519)]              │                 │
      │            [DH3=X25519(EK,SPK_B)]                    │                 │
      │            [DH4=X25519(EK,OPK_B)]                    │                 │
      │            [SK = HKDF(F||DH1||DH2||DH3||DH4)]        │                 │
      │            [.fill(0): DH1-4, EK_priv, IK_priv_x25519]│                 │
      │            [saveSession(convId, SK, wrappingKey)]     │                 │
      │            [IV=random(12B), AAD="{convId}:{senderId}"]│                 │
      │            [ciphertext=AES-256-GCM(plain,SK,IV,AAD)]  │                 │
      │                  │                  │                │                 │
      │─WS: {ciphertext,iv,aad,ekPub,opkId,ikPub}───────────►│                 │
      │                  │                  │─INSERT Message─►│                 │
      │                  │                  │                │─relay───────────►│
      │                  │                  │                │            [getOPK(opkId)]
      │                  │                  │                │            [X3DH receiver]
      │                  │                  │                │            [saveSession]
      │                  │                  │                │            [deleteOPK]
      │                  │                  │                │            [AES-GCM decrypt]
      │◄─ack {msgId}─────────────────────────────────────────│                 │
```

---

## Sequence Diagram SD-04: Unlock Sau Reload

> Nguồn code: `AuthContext.unlock()` — không gọi server

```
User       App.jsx/UnlockModal     Auth Context         IndexedDB
 │                  │                   │                    │
 │            [reload trang]            │                    │
 │            isAuthenticated=true      │                    │
 │            isLocked=true (wrappingKey=null)               │
 │            → hiện UnlockModal        │                    │
 │                  │                   │                    │
 │─Nhập password───►│                   │                    │
 │                  │──unlock(password)─►                    │
 │                  │                   │─getWrapSalt(userId)─►
 │                  │                   │◄─wrapSalt───────────│
 │                  │           [PBKDF2 600k → wKey]         │
 │                  │           [loadPrivateKeys → unwrap]   │
 │                  │                   │─(không gọi server) │
 │                  │                   │                    │
 │                  │◄──resolve()────────                    │
 │◄─isLocked=false → Chat hiện lại      │                    │
```

---

## Sequence Diagram SD-05: Gửi Tin Nhóm (N Bản Mã Song Song)

> Nguồn code: `Chat.jsx (handleSendGroup)` → `api.sendGroupMessage()` → `ws/handler.js`

```
Alice(Browser)    Crypto/Storage   Server(REST)    Server(WS)  Bob(Browser)  Carol(Browser)
      │                  │               │               │            │              │
      │─Gửi tin nhóm─────►               │               │            │              │
      │            [getOrCreateGroupSK(gId, bob.id)]     │            │              │
      │            [getOrCreateGroupSK(gId, carol.id)]   │            │              │
      │            SK_AB cache: "${groupId}:${bob.id}"   │            │              │
      │            SK_AC cache: "${groupId}:${carol.id}" │            │              │
      │                  │               │               │            │              │
      │            [encryptMessage(text, SK_AB, gId, aliceId)]        │              │
      │            [encryptMessage(text, SK_AC, gId, aliceId)]        │              │
      │            AAD = "${groupId}:${aliceId}" (giống nhau)         │              │
      │                  │               │               │            │              │
      │─POST /messages───────────────────►               │            │              │
      │  [{recipientId:bob, ct1,iv1,aad},               │            │              │
      │   {recipientId:carol, ct2,iv2,aad}]             │            │              │
      │                  │               │─INSERT Msg×2─►│            │              │
      │                  │               │─relay Bob─────►──relay────►│              │
      │                  │               │─relay Carol───►──relay──────────────────►│
      │◄─201─────────────────────────────│               │            │              │
      │                  │               │               │      [X3DH/AES decrypt]   │
```

---

## Sequence Diagram SD-06: Gửi File E2EE (Group)

> Nguồn code: `Chat.jsx (handleSendGroupFile)` → `api.uploadFile()` → `api.sendGroupMessage()`

```
Alice(Browser)    Crypto/Storage   Server(REST)     Bob(Browser)  Carol(Browser)
      │                  │               │                 │              │
      │─Chọn file────────►               │                 │              │
      │            [encryptBytesWithRandomKey(fileBytes)]  │              │
      │            → {encryptedBytes, fileIv, fileKey}     │              │
      │                  │               │                 │              │
      │─POST /files/upload────────────────►               │              │
      │  (encrypted bytes)               │                 │              │
      │◄─{fileId}────────────────────────│                 │              │
      │                  │               │                 │              │
      │            payload_bob = {type, fileId, fileKey, fileIv, fileName, ...}
      │            payload_carol = {type, fileId, fileKey, fileIv, fileName, ...}
      │            ct_bob   = encryptMessage(JSON(payload_bob),   SK_AB, gId)
      │            ct_carol = encryptMessage(JSON(payload_carol), SK_AC, gId)
      │                  │               │                 │              │
      │─POST /messages (group)────────────►               │              │
      │  [{recipientId:bob, ct_bob,...},  │                 │              │
      │   {recipientId:carol, ct_carol,...}]               │              │
      │                  │               │─relay──────────►│              │
      │                  │               │─relay──────────────────────────►
      │                  │               │                 │              │
      │                  │               │    Bob: decrypt ct_bob → payload → fileKey
      │                  │               │    GET /files/{fileId} → encryptedBytes
      │                  │               │    decryptBytesWithKey(bytes, fileIv, fileKey)
```

**Lưu ý bảo mật:** Server lưu 1 bản encrypted file. `fileKey` được wrap trong message payload của từng người → server không thể đọc key → không thể decrypt file.

---

## Sequence Diagram SD-07: Verify Fingerprint Nhóm (PeerVerification)

> Nguồn code: `GroupInfoPanel.jsx` → `FingerprintModal.jsx` → `api.verifyPeer()`

```
Alice(Browser)    GroupInfoPanel    FingerprintModal     Server         PostgreSQL
      │                  │                  │               │                │
      │─Chọn nhóm────────►                  │               │                │
      │─GET /groups/:id/members─────────────────────────────►               │
      │◄─[{id,username,ikPub,isVerifiedByMe}]─────────────────────────────── │
      │            Badge: "E2EE · 1/2 đã xác minh" (amber) │               │
      │                  │                  │               │                │
      │─Click badge──────►                  │               │                │
      │            Mở GroupInfoPanel         │               │                │
      │─Click shield Bob─►                  │               │                │
      │                  │──open modal──────►                │                │
      │                  │           [generateFingerprint(myIKPub, bob.ikPub)]
      │                  │           → 60 chữ số            │                │
      │                  │                  │               │                │
      │                  │    (so sánh qua kênh ngoài)      │                │
      │                  │─Xác nhận────────►│               │                │
      │                  │                  │─PATCH /peers/{bob.id}/verify──►│
      │                  │                  │               │─UPSERT ────────►
      │                  │                  │               │  PeerVerification
      │                  │                  │               │  {verifierId:alice, peerId:bob}
      │                  │                  │◄─200───────────│                │
      │◄─onMemberVerified(bob.id)────────────                │                │
      │  shield Bob → xanh, badge → "2/2 Tất cả đã xác minh"│               │
```

---

## Database Schema — Mô Tả Chi Tiết

### Bảng `User`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | UUID PK | `@default(uuid())` — không đoán được |
| username | String UNIQUE | tên đăng nhập |
| email | String UNIQUE | phải có trong `AllowedEmail` hoặc là `ADMIN_SEED_EMAIL` |
| passwordHash | String | `bcrypt(password, cost=12)` — KHÔNG lưu plaintext |
| role | Enum (USER/ADMIN) | `@default(USER)` — ADMIN_SEED_EMAIL tự động nhận ADMIN |
| isActive | Boolean | `@default(true)` — false = bị vô hiệu hóa bởi admin |
| createdAt | DateTime | `@default(now())` |

---

### Bảng `KeyBundle`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | UUID PK | |
| userId | String UNIQUE FK | 1 user → 1 bundle |
| ikPub | String | base64 Ed25519 public key (32B) |
| spkPub | String | base64 X25519 public key (32B) |
| spkSig | String | base64 Ed25519 chữ ký của IK_priv lên SPK_pub (64B) |
| opkPubs | Json[] | mảng `[{id:UUID, pub:base64}]` — pool OPK còn lại |

**Quan trọng:** `opkPubs` bị pop 1 phần tử mỗi lần ai đó `GET /keys/{userId}`. Server chỉ thấy public key — private key **không bao giờ rời khỏi browser**.

---

### Bảng `Conversation`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | UUID PK | |
| participantA | String FK | userId người tạo conversation |
| participantB | String FK | userId người kia |
| fingerprintVerified | Boolean | `@default(false)` — MessageInput disabled nếu false |
| createdAt | DateTime | |

Index: `@@unique([participantA, participantB])` — tránh duplicate

---

### Bảng `Message`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | UUID PK | |
| conversationId | String? FK | null nếu là tin nhóm |
| groupId | String? FK | null nếu là tin 1-1 |
| recipientId | String? | null nếu tin 1-1, userId nhận nếu tin nhóm |
| senderId | String FK | không null |
| ciphertext | String? | base64 AES-256-GCM output |
| iv | String? | base64 12B random IV |
| aad | String? | `"{convId}:{senderId}"` hoặc `"{groupId}:{senderId}"` |
| ekPub | String? | base64 EK_pub — **chỉ có ở tin X3DH init** |
| opkId | String? | UUID OPK đã dùng — **chỉ có ở tin X3DH init** |
| ikPub | String? | base64 IK_pub của sender — **chỉ có ở tin X3DH init** |
| isSystem | Boolean | `@default(false)` — tin hệ thống (thêm/rời nhóm) |
| systemText | String? | text hiển thị cho tin hệ thống |
| createdAt | DateTime | |

**Replay attack protection:** `@@unique([conversationId, iv])` — server trả `409` nếu IV trùng (xem `messages.js`: `err.code === 'P2002'`)

---

### Bảng `AllowedEmail`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | UUID PK | |
| email | String UNIQUE | email nhân viên được phép đăng ký |
| usedAt | DateTime? | null = chưa dùng; có giá trị = đã đăng ký rồi |

Admin quản lý qua trang `/admin` → Tab "Whitelist Email".

---

### Bảng `Group`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | UUID PK | |
| name | String | tên nhóm |
| createdBy | String FK | userId người tạo nhóm (admin nhóm) |
| createdAt | DateTime | |

---

### Bảng `GroupMember`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | UUID PK | |
| groupId | String FK | |
| userId | String FK | |
| joinedAt | DateTime | |

Index: `@@unique([groupId, userId])` — không thêm trùng thành viên

---

### Bảng `UploadedFile`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | UUID PK | tên file trên disk (không đoán được) |
| uploaderId | String FK | user đã upload |
| createdAt | DateTime | |

**Server lưu tại:** `/app/uploads/{id}` (mounted volume `uploads_data`)  
**Server không biết:** nội dung file, loại file, tên file gốc — tất cả mã hóa trước khi upload

---

### Bảng `PeerVerification`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | UUID PK | |
| verifierId | String FK | user thực hiện verify |
| peerId | String FK | user được verify |
| verifiedAt | DateTime | thời điểm xác nhận |

Index: `@@unique([verifierId, peerId])` — mỗi cặp chỉ 1 bản ghi (upsert idempotent)

**Tính toàn cục:** 1 bản ghi trong `PeerVerification` có hiệu lực ở tất cả nhóm. `GET /groups/:id/members` join bảng này để trả `isVerifiedByMe` cho từng member.

**Đồng bộ 1-1 ↔ Group:** `PATCH /conversations/:id/fingerprint` dùng `$transaction` ghi đồng thời vào cả `Conversation.fingerprintVerified` và `PeerVerification` → verify 1-1 tự động được nhận diện ở group.
