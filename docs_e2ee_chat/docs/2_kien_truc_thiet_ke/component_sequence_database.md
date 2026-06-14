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
 │                │                │                │─Kiểm tra ─────►│               │
 │                │                │                │  AllowedEmail  │               │
 │                │                │                │─bcrypt.hash────┘               │
 │                │                │                │─INSERT User───►│               │
 │                │                │                │◄──{userId}─────│               │
 │                │                │◄──{userId,msg}─│                │               │
 │                │                │  (KHÔNG có token)               │               │
 │                │                │                │                │               │
 │                │                │──savePrivateKeys(userId,wrapSalt,wKey,IK,SPK,OPKs)──►│
 │                │                │◄──────────────────────────────────────────────OK─│
 │                │                │                │                │               │
 │                │◄──resolve()────│                │                │               │
 │                │                │                │                │               │
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
 │               │               │                │◄─{passwordHash}            │            │
 │               │               │                │─bcrypt.compare()           │            │
 │               │               │                │─jwt.sign({userId},7d)      │            │
 │               │               │◄─{token,userId,username}───────│            │            │
 │               │               │  ← JWT sinh ở đây              │            │            │
 │               │               │                │               │            │            │
 │               │               │─hasPrivateKeys(userId)────────────────────►│            │
 │               │               │◄─true (hoặc throw DEVICE_NOT_REGISTERED)───│            │
 │               │               │                │               │            │            │
 │               │               │─getWrapSalt(userId)───────────────────────►│            │
 │               │               │◄─wrapSalt──────────────────────────────────│            │
 │               │               │                │               │            │            │
 │               │         [PBKDF2 600k vòng → wKey]              │            │            │
 │               │         [loadPrivateKeys → unwrap IK,SPK,OPKs] │            │            │
 │               │         [Tính lại SPK_pub, spkSig, opkPubs]    │            │            │
 │               │               │                │               │            │            │
 │               │               │─POST /keys/upload──────────────────────────────────────►│
 │               │               │  Authorization: Bearer {token}  │            │            │
 │               │               │  {ikPub,spkPub,spkSig,opkPubs} │            │            │
 │               │               │                │               │            │─requireAuth─┤
 │               │               │                │               │            │─INSERT ─────┤
 │               │               │                │               │            │  KeyBundle  │
 │               │               │◄─201 (hoặc 409 → bỏ qua)──────────────────────────────│
 │               │               │                │               │            │            │
 │               │         [localStorage: token,userId,username]   │            │            │
 │               │         [RAM: setWrappingKey,setIKSecret,setSPKPriv]         │            │
 │               │               │                │               │            │            │
 │               │◄─resolve()────│                │               │            │            │
 │               │  isAuthenticated=true → navigate('/chat')       │            │            │
```

---

## Sequence Diagram SD-03: Gửi Tin X3DH Lần Đầu

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
      │                  │                  │                │            [deleteOPK(opkId)]
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

## Database Schema — Mô Tả Chi Tiết

### Bảng `User`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | UUID PK | `@default(uuid())` — không đoán được |
| username | String UNIQUE | tên đăng nhập |
| email | String UNIQUE | phải có trong `AllowedEmail` |
| passwordHash | String | `bcrypt(password, cost=12)` — KHÔNG lưu plaintext |
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

**Khi nào INSERT?** — Tại `AuthContext.login()` bước 8, sau khi đã có JWT. KHÔNG phải lúc register.

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
Server tìm cả 2 chiều A↔B khi check existing (xem `conversations.js` dòng 30-36)

---

### Bảng `Message`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | UUID PK | |
| conversationId | String? FK | null nếu là tin nhóm |
| groupId | String? FK | null nếu là tin 1-1 |
| recipientId | String? | null nếu tin 1-1, có giá trị nếu tin nhóm |
| senderId | String FK | không null |
| ciphertext | String? | base64 AES-256-GCM output |
| iv | String? | base64 12B random IV |
| aad | String? | `"{convId}:{senderId}"` — plaintext, authenticated |
| ekPub | String? | base64 EK_pub — **chỉ có ở tin X3DH init**, null ở tin thường |
| opkId | String? | UUID OPK đã dùng — **chỉ có ở tin X3DH init** |
| ikPub | String? | base64 IK_pub của sender — **chỉ có ở tin X3DH init** |
| isSystem | Boolean | `@default(false)` — tin hệ thống (thêm/rời nhóm) |
| systemText | String? | text hiển thị cho tin hệ thống |
| createdAt | DateTime | |

**Replay attack protection:** `@@unique([conversationId, iv])` — server trả `409` nếu IV trùng (xem `messages.js` dòng 81-83: `err.code === 'P2002'`)

---

### Bảng `AllowedEmail`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | UUID PK | |
| email | String UNIQUE | email nhân viên được phép đăng ký |
| usedAt | DateTime? | null = chưa dùng; có giá trị = đã đăng ký rồi |

Admin thêm email qua script: `node scripts/add-employee.js email@company.com`  
Khi register: server check `{email, usedAt: null}` — 1 email chỉ dùng 1 lần
