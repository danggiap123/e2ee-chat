# Kiến Trúc Chi Tiết — Class Diagram & Mô Tả Lớp

---

## 1. Class Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          CRYPTO LAYER (pure JS)                          │
│                                                                          │
│  ┌──────────────────────────────────┐                                   │
│  │           <<module>> keyGen      │                                   │
│  │──────────────────────────────────│                                   │
│  │ (không có state — pure functions)│                                   │
│  │──────────────────────────────────│                                   │
│  │ + generateIdentityKey()          │                                   │
│  │    : {IK_pub:U8A(32), IK_secret:U8A(64)}                           │
│  │ + generateSignedPreKey(IK_secret)│                                   │
│  │    : {SPK_pub:U8A(32), SPK_priv:U8A(32), SPK_sig:U8A(64)}         │
│  │ + generateOneTimePreKeys(n=100)  │                                   │
│  │    : [{id:UUID, OPK_pub, OPK_priv}]                                │
│  │ + deriveWrappingKey(password, salt)                                 │
│  │    : CryptoKey (AES-GCM, 256-bit)                                  │
│  │ + wrapPrivateKey(privKey, wrappingKey)                              │
│  │    : {wrapped:base64, iv:base64}                                   │
│  │ + unwrapPrivateKey(wrappedB64, ivB64, wrappingKey)                  │
│  │    : Uint8Array                                                      │
│  └──────────────────────────────────┘                                   │
│                                                                          │
│  ┌──────────────────────────────────┐                                   │
│  │           <<module>> x3dh        │                                   │
│  │──────────────────────────────────│                                   │
│  │ + verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub_B)                 │
│  │    : boolean                                                         │
│  │ + performX3DH_sender(myKeys, bobBundle)                             │
│  │    : {SK:CryptoKey, EK_pub:U8A, OPK_id:string, IK_pub:U8A}        │
│  │ + performX3DH_receiver(myKeys, initMsg)                             │
│  │    : {SK:CryptoKey}                                                  │
│  │ [private] hkdf(ikm: Uint8Array)                                     │
│  │    : CryptoKey                                                       │
│  │ [private] concat(...arrays)                                          │
│  │    : Uint8Array                                                      │
│  └──────────────────────────────────┘                                   │
│                                                                          │
│  ┌──────────────────────────────────┐                                   │
│  │          <<module>> aesGcm       │                                   │
│  │──────────────────────────────────│                                   │
│  │ + encryptMessage(plain, SK, convId, senderId)                       │
│  │    : {ciphertext:b64, iv:b64, aad:string}                          │
│  │ + decryptMessage(ctB64, ivB64, aad, SK)                             │
│  │    : string | null                                                   │
│  │ + encryptBytes(bytes, SK)                                            │
│  │    : {encryptedBytes:U8A, fileIv:b64}                              │
│  │ + decryptBytes(encBytes, fileIvB64, SK)                             │
│  │    : Uint8Array | null                                               │
│  │ + encryptBytesWithRandomKey(bytes)                                  │
│  │    : {encryptedBytes, fileIv:b64, fileKey:b64}                     │
│  │ + decryptBytesWithKey(encBytes, fileIvB64, fileKeyB64)              │
│  │    : Uint8Array | null                                               │
│  └──────────────────────────────────┘                                   │
│                                                                          │
│  ┌──────────────────────────────────┐                                   │
│  │       <<module>> fingerprint     │                                   │
│  │──────────────────────────────────│                                   │
│  │ + generateFingerprint(IK_A, IK_B)                                   │
│  │    : string (60 chữ số decimal)                                     │
│  │ [private] lexCompare(a, b)                                          │
│  │    : number                                                           │
│  └──────────────────────────────────┘                                   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                      DB LAYER (Dexie / IndexedDB)                        │
│                                                                          │
│  ┌──────────────────────────────────┐                                   │
│  │         <<module>> storage       │                                   │
│  │──────────────────────────────────│                                   │
│  │ [private] db: Dexie              │                                   │
│  │   tables: privateKeys, sessions  │                                   │
│  │──────────────────────────────────│                                   │
│  │ + savePrivateKeys(userId, wrapSalt, wrappingKey, IK_secret, SPK_priv, opkList)
│  │ + loadPrivateKeys(userId, wrappingKey)                               │
│  │    : {wrapSalt, IK_secret, IK_pub, SPK_priv, opkMap:Map}           │
│  │ + getWrapSalt(userId) : Uint8Array|null                             │
│  │ + hasPrivateKeys(userId) : boolean                                  │
│  │ + getOPK(userId, opkId, wrappingKey) : Uint8Array|null              │
│  │ + deleteOPK(userId, opkId) : void                                   │
│  │ + saveSession(convId, SK, wrappingKey) : void                       │
│  │ + loadSession(convId, wrappingKey) : CryptoKey|null                 │
│  │ + exportKeysToFile(userId) : void (download)                        │
│  │ + importKeysFromFile(file) : void                                   │
│  └──────────────────────────────────┘                                   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         SERVICE LAYER                                    │
│                                                                          │
│  ┌──────────────────────────────────┐                                   │
│  │          <<module>> api          │                                   │
│  │──────────────────────────────────│                                   │
│  │ + register(username, password)   │                                   │
│  │ + login(username, password)      │                                   │
│  │ + logout(token)                  │                                   │
│  │ + uploadKeys(token, keyBundle)   │                                   │
│  │ + fetchKeyBundle(token, userId)  │                                   │
│  │ + uploadMoreOPKs(token, opkPubs) │                                   │
│  │ + createConversation(token, recipientId)                             │
│  │ + listConversations(token)       │                                   │
│  │ + verifyFingerprint(token, convId)                                   │
│  │ + deleteConversation(token, convId)                                  │
│  │ + sendMessage(token, payload)    │                                   │
│  │ + loadMessages(token, convId, cursor, limit)                         │
│  │ + deleteMessage(token, msgId)    │                                   │
│  │ + searchUsers(token, keyword)    │                                   │
│  └──────────────────────────────────┘                                   │
│                                                                          │
│  ┌──────────────────────────────────┐                                   │
│  │         <<module>> socket        │                                   │
│  │──────────────────────────────────│                                   │
│  │ [private] ws: WebSocket|null     │                                   │
│  │ [private] listeners: Map<type,fn>│                                   │
│  │ [private] currentToken: string   │                                   │
│  │ [private] intentionalClose: bool │                                   │
│  │──────────────────────────────────│                                   │
│  │ + connectSocket(token)           │                                   │
│  │ + disconnectSocket()             │                                   │
│  │ + sendSocketMessage(payload)     │                                   │
│  │ + onSocketEvent(type, callback)  │                                   │
│  │ + offSocketEvent(type)           │                                   │
│  └──────────────────────────────────┘                                   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                      REACT CONTEXT / HOOKS                               │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     AuthContext                                    │  │
│  │──────────────────────────────────────────────────────────────────│  │
│  │ State (trong RAM):                                                │  │
│  │   token:       string|null    ← JWT Bearer token                 │  │
│  │   userId:      string|null    ← UUID từ server                   │  │
│  │   username:    string|null                                        │  │
│  │   IK_secret:   Uint8Array     ← Ed25519 64B (đã unwrap)          │  │
│  │   IK_pub:      Uint8Array     ← Ed25519 32B = IK_secret.slice(32)│  │
│  │   SPK_priv:    Uint8Array     ← X25519 32B (đã unwrap)           │  │
│  │   wrappingKey: CryptoKey      ← AES-GCM từ PBKDF2(password)      │  │
│  │──────────────────────────────────────────────────────────────────│  │
│  │ Functions:                                                        │  │
│  │   login(username, password) : Promise<void>                       │  │
│  │   logout() : void                                                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    useWebSocket (hook)                             │  │
│  │──────────────────────────────────────────────────────────────────│  │
│  │ State:                                                            │  │
│  │   onlineUsers:       Set<userId>                                  │  │
│  │   isConnected:       boolean                                      │  │
│  │   isSessionReplaced: boolean                                      │  │
│  │ Refs:                                                             │  │
│  │   sessionKeysRef:    Map<convId, CryptoKey>                       │  │
│  │   newMsgCallbackRef: Function                                     │  │
│  │   wrappingKeyRef, IK_secretRef, SPK_privRef, userIdRef            │  │
│  │──────────────────────────────────────────────────────────────────│  │
│  │ Returns:                                                          │  │
│  │   { onlineUsers, isConnected, sessionKeysRef,                     │  │
│  │     setNewMessageCallback, setGroupMessageCallback, ...}          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    useMessages (hook)                              │  │
│  │──────────────────────────────────────────────────────────────────│  │
│  │ State:                                                            │  │
│  │   messages:   Message[]                                           │  │
│  │   isLoading:  boolean                                             │  │
│  │   hasMore:    boolean                                             │  │
│  │   cursor:     string|null                                         │  │
│  │──────────────────────────────────────────────────────────────────│  │
│  │ Functions:                                                        │  │
│  │   loadInitial(convId, SK) : Promise<void>                         │  │
│  │   loadMore() : Promise<void>                                      │  │
│  │   addMessage(msg) : void                                          │  │
│  │   deleteMessageById(msgId) : void                                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                  BACKEND MODULES (Node.js / Express)                     │
│                                                                          │
│  ┌──────────────────────────────────┐                                   │
│  │       <<module>> handler.js      │                                   │
│  │──────────────────────────────────│                                   │
│  │ [private] clients: Map<userId,ws>│  ← in-memory relay map           │
│  │──────────────────────────────────│                                   │
│  │ + initWebSocket(server) : void   │                                   │
│  │ [private] onConnect(ws, req)     │                                   │
│  │ [private] onMessage(ws, userId, raw)                                │
│  │ [private] broadcast(payload, excludeId)                             │
│  │ [private] safeSend(ws, payload)  │                                   │
│  └──────────────────────────────────┘                                   │
│                                                                          │
│  ┌──────────────────────────────────┐                                   │
│  │      <<middleware>> auth.js      │                                   │
│  │──────────────────────────────────│                                   │
│  │ + requireAuth(req, res, next)    │                                   │
│  │   1. Lấy Bearer token từ header  │                                   │
│  │   2. jwt.verify(token, secret)   │                                   │
│  │   3. redis.get("blocklist:"+token)                                  │
│  │   4. req.user = decoded payload  │                                   │
│  └──────────────────────────────────┘                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Mô Tả Chi Tiết Từng Module

---

### Module `keyGen.js`

**Mục đích:** Sinh toàn bộ key material cần thiết cho X3DH + bảo vệ private key.

#### `generateIdentityKey()`
```
Input:  (không có)
Output: { IK_pub: Uint8Array(32), IK_secret: Uint8Array(64) }

Dùng: sodium.crypto_sign_keypair() → Ed25519
Tại sao Ed25519 (không phải X25519)?
  IK cần 2 vai trò:
    1. Ký SPK → phải là Ed25519 (thuật toán chữ ký)
    2. Tham gia DH1, DH2 trong X3DH → phải convert sang X25519
  libsodium có hàm convert: crypto_sign_ed25519_sk_to_curve25519()

Tại sao IK_secret dài 64B thay vì 32B?
  libsodium format: Ed25519 secret = seed(32B) + public(32B) ghép lại
  IK_pub = IK_secret.slice(32) → không cần lưu riêng IK_pub
```

#### `generateSignedPreKey(IK_secret)`
```
Input:  IK_secret: Uint8Array(64)
Output: { SPK_pub: U8A(32), SPK_priv: U8A(32), SPK_sig: U8A(64) }

Dùng: sodium.crypto_box_keypair() → X25519 (không cần ký)
Ký:   sodium.crypto_sign_detached(SPK_pub, IK_secret) → Ed25519 sig
Tại sao ký SPK? Bất kỳ ai có IK_pub đều verify được:
  "SPK này thực sự được tạo bởi người có IK_priv tương ứng"
  Ngăn server thay SPK bằng SPK giả để MITM
```

#### `deriveWrappingKey(password, salt)`
```
Input:  password: string, salt: Uint8Array(16)
Output: CryptoKey (AES-256-GCM, non-extractable, usage: deriveKey)

Dùng: PBKDF2-SHA256, iterations=600_000
Tại sao 600k vòng? 
  NIST SP 800-132 khuyến nghị ≥600k vòng với SHA-256 (2023)
  ~1 giây trên máy hiện đại → brute-force 1M password = 1M giây

Tại sao PBKDF2 không phải Argon2id?
  PBKDF2 là Web Crypto API native → không cần WASM bundle
  Argon2id an toàn hơn (memory-hard) nhưng cần thêm ~50KB WASM
  Đây là trade-off phạm vi đồ án
```

#### `wrapPrivateKey(privKey, wrappingKey)`
```
Input:  privKey: Uint8Array, wrappingKey: CryptoKey
Output: { wrapped: base64, iv: base64 }

iv = crypto.getRandomValues(12B) — IV ngẫu nhiên RIÊNG cho từng key
wrapped = AES-256-GCM.encrypt(privKey, wrappingKey, iv)

Nếu bỏ hàm này:
  Private key lưu plaintext trong IndexedDB
  Bất kỳ JS nào trên trang (kể cả extension) đọc được
```

---

### Module `x3dh.js`

**Mục đích:** Implement giao thức X3DH (Extended Triple Diffie-Hellman) theo Signal spec.

#### `verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub_B)`
```
Input:  
  IK_pub_B: Uint8Array(32)  — public key của Bob
  SPK_sig:  Uint8Array(64)  — chữ ký Ed25519
  SPK_pub_B:Uint8Array(32)  — Signed PreKey của Bob

Output: boolean

Dùng: sodium.crypto_sign_verify_detached(SPK_sig, SPK_pub_B, IK_pub_B)

Nếu return false: dừng X3DH, throw error
Nếu bỏ hàm này: server có thể thay SPK_pub_B bằng SPK giả của mình
  → tính DH với server thay vì Bob → server đọc được toàn bộ tin nhắn
```

#### `performX3DH_sender(myKeys, bobBundle)`
```
Input:
  myKeys: {
    IK_secret: Uint8Array(64),  // Ed25519 secret key của Alice
    IK_pub:    Uint8Array(32),  // Ed25519 public key của Alice
  }
  bobBundle: {                  // Dữ liệu từ GET /keys/{bobId}
    ikPub:  string (base64),    // Ed25519 pub của Bob
    spkPub: string (base64),    // X25519 pub (SPK)
    spkSig: string (base64),    // Ed25519 signature
    opkPub: string (base64),    // X25519 pub (OPK)
    opkId:  string (UUID),      // Bob dùng để tìm OPK_priv
  }

Output: {
  SK:     CryptoKey,            // AES-256-GCM Session Key
  EK_pub: Uint8Array(32),       // Bob cần để tính lại SK
  OPK_id: string,               // Bob cần để tìm OPK_priv
  IK_pub: Uint8Array(32),       // Bob cần để tính DH1, DH2
}

Các bước:
  1. verifySignedPreKey(...)  → throw nếu false
  2. Convert IK Ed25519 → X25519:
     IK_priv = sodium.crypto_sign_ed25519_sk_to_curve25519(IK_secret)
     IK_pub_B_x = sodium.crypto_sign_ed25519_pk_to_curve25519(IK_pub_B)
  3. EK = sodium.crypto_box_keypair()  ← X25519 ephemeral
  4. DH1..DH4 (xem SD-03)
  5. IKM = F(0xFF×32) || DH1 || DH2 || DH3 || DH4
  6. SK = HKDF-SHA256(IKM)
  7. DH1..4, EK_priv, IK_priv .fill(0)  ← forward secrecy

Tại sao prefix F = 0xFF×32?
  Signal spec yêu cầu để phân biệt X25519 (0xFF) vs X448 (0x00)
  Tránh nhầm lẫn nếu sau này nâng cấp lên X448
```

#### `hkdf(ikm)` (private)
```
Input:  ikm: Uint8Array (160B — 32+32+32+32+32)
Output: CryptoKey (AES-256-GCM, 256-bit, extractable: true)

Dùng: Web Crypto API HKDF-SHA256
  salt = Uint8Array(32).fill(0)    ← theo Signal spec
  info = "E2EEChat_v1"             ← domain separation string

Tại sao extractable: true?
  CryptoKey non-extractable không thể exportKey() → không lưu IndexedDB được
  extractable: true → exportKey('raw') → wrap → lưu
  Rủi ro nhỏ vì SK chỉ nằm trong RAM, không expose ra ngoài nếu không có XSS
```

---

### Module `aesGcm.js`

**Mục đích:** Mã hóa/giải mã tin nhắn và file bằng AES-256-GCM.

#### `encryptMessage(plaintext, SK, conversationId, senderId)`
```
Input:
  plaintext:      string           — tin nhắn chưa mã hóa
  SK:             CryptoKey        — AES-256-GCM session key
  conversationId: string (UUID)
  senderId:       string (UUID)

Output: { ciphertext: base64, iv: base64, aad: string }

Chi tiết:
  iv  = crypto.getRandomValues(Uint8Array(12))  ← 96-bit, phải random mỗi tin
  aad = `${conversationId}:${senderId}`         ← authenticated but NOT encrypted
  ciphertext = AES-256-GCM.encrypt(plaintext_utf8, SK, iv, aad)

Nếu bỏ aad:
  Attacker lấy ciphertext từ conv A, gửi vào conv B
  Bob giải mã thành công → đọc được tin Alice gửi trong conv khác
  Với AAD, auth tag fail → decrypt trả null → "Không thể giải mã"

Nếu dùng IV cố định:
  AES-GCM security model sụp đổ khi IV trùng nhau → 
  kẻ tấn công có thể XOR 2 ciphertext để loại bỏ keystream
```

#### `decryptMessage(ciphertextB64, ivB64, aad, SK)`
```
Output: string | null

Trả null khi:
  - SK sai (khác session)
  - IV sai
  - AAD bị sửa
  - ciphertext bị tamper (auth tag fail)

Không throw → UI hiển thị "[Không thể giải mã]" thay vì crash
```

---

### Module `fingerprint.js`

#### `generateFingerprint(IK_pub_A, IK_pub_B)`
```
Input:  2 Uint8Array(32) — thứ tự không quan trọng
Output: string (60 chữ số decimal)

Bước 1: lexCompare → sort canonical
  Alice gọi (IK_A, IK_B), Bob gọi (IK_B, IK_A) → cùng ra kết quả

Bước 2: concat 64 bytes → hash SHA-512 × 5200 vòng
  5200 vòng: brute-force 1 cặp key giả = 5200 lần hash SHA-512
  Thử 1M cặp key = 5.2 tỷ lần hash ≈ không khả thi trong thực tế

Bước 3: BigInt(hex) % 10^60 → 60 chữ số decimal
  Dễ đọc và so sánh hơn hex
  60 chữ số = 10^60 khả năng → 200 bits entropy
```

---

### Module `storage.js`

**Dexie.js** — wrapper cho IndexedDB API.

**Tại sao không dùng localStorage?**
- localStorage: synchronous, limit 5MB, lưu string plaintext
- IndexedDB: asynchronous (không block UI), limit vài GB, lưu binary (Uint8Array)
- Private key là 64 bytes binary → IndexedDB phù hợp hơn

**Schema:**
```
privateKeys: { userId (PK), wrapSalt, wrappedIK, ivIK, wrappedSPK, ivSPK, wrappedOPKs[] }
sessions:    { conversationId (PK), wrappedSK, ivSK }
```

#### `savePrivateKeys(userId, wrapSalt, wrappingKey, IK_secret, SPK_priv, opkList)`
```
Tại sao không lưu wrappingKey vào DB?
  wrappingKey derive từ password — nếu lưu DB, mất ý nghĩa của password
  wrappingKey phải derive lại từ password mỗi lần login → đảm bảo chỉ ai biết password mới dùng được

Tại sao lưu wrapSalt?
  PBKDF2 cần cùng salt để ra cùng wrappingKey
  Salt là random → phải lưu lại để login lần sau
  Salt không cần bí mật (không phải password)
```

#### `getOPK(userId, opkId, wrappingKey)`
```
Tại sao không dùng loadPrivateKeys() cho receiver?
  loadPrivateKeys() unwrap 100 OPK → 100 lần AES-GCM decrypt
  getOPK() chỉ unwrap 1 OPK theo opkId → 100× nhanh hơn
```

---

### Module `handler.js` (Backend WebSocket)

#### `clients: Map<userId, WebSocket>`
```
In-memory Map — sống trong RAM của Node.js process
Không phải database, không phải Redis
Chỉ tồn tại khi server đang chạy

Tại sao không dùng Redis?
  1 server instance → Map trong RAM là đủ, đơn giản hơn nhiều
  Redis Pub/Sub cần khi scale ngang nhiều instance
  Đồ án scope 1 instance → không cần

Hạn chế: nếu server restart → Map mất → tất cả client phải reconnect
  WebSocket client có auto-reconnect → tự động giải quyết
```

#### `onConnect(ws, req)` — 8 bước
```
1. Lấy token từ query string (?token=JWT)
   Tại sao query string thay vì header?
   WebSocket API browser không hỗ trợ custom header trong handshake
   Query string là cách duy nhất browser có thể gửi token qua WS

2. jwt.verify(token) — xác thực chữ ký + hạn
3. redis.get("blocklist:"+token) — check xem đã logout chưa
4. Đóng socket cũ nếu user mở tab mới (single-session policy)
5. clients.set(userId, ws)
6. Gửi danh sách online users
7. Broadcast "userId vừa online"
8. Đăng ký ws.on('message') và ws.on('close')
```

---

### Middleware `auth.js` (Backend)

#### `requireAuth(req, res, next)`
```
1. Lấy Authorization header → Bearer {token}
   Tại sao Bearer scheme? Chuẩn OAuth 2.0 RFC 6750

2. jwt.verify(token, process.env.JWT_SECRET)
   JWT_SECRET = 256-bit random string
   Nếu sai secret hoặc hết hạn → throw → 401

3. redis.get("blocklist:"+token)
   Nếu Redis down → bỏ qua check (graceful degradation)
   Trade-off: nếu Redis down, logout không có tác dụng trong thời gian ngắn
   Chấp nhận được vì Redis thường không down lâu

4. req.user = decoded → { userId, username, iat, exp }
   next() → đến route handler

Tại sao JWT thay vì Session?
  Stateless: server không cần lưu session state
  Phù hợp với REST API
  Có thể verify mà không cần DB lookup (chỉ cần verify signature)
```
