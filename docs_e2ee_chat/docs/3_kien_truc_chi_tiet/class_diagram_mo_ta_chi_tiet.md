# Kiến Trúc Chi Tiết — Mô Tả Từng Module
> Viết theo đúng code thực tế, ghi rõ tên hàm, tham số, kiểu dữ liệu

---

## Tổng Quan Quan Hệ Module

```
Register.jsx / Login.jsx
        │
        ▼
AuthContext.jsx          ← điều phối toàn bộ auth + crypto + storage
   ├── crypto/keyGen.js  ← sinh key, PBKDF2, wrap/unwrap
   ├── crypto/x3dh.js    ← X3DH sender/receiver
   ├── crypto/aesGcm.js  ← encrypt/decrypt tin nhắn và file
   ├── crypto/fingerprint.js ← tính 60 chữ số fingerprint
   ├── db/storage.js     ← Dexie/IndexedDB: lưu key và session
   └── services/api.js   ← tất cả REST call

Chat.jsx                 ← UI chính
   ├── useWebSocket.js   ← WS, nhận tin, X3DH receiver
   ├── useMessages.js    ← quản lý list tin nhắn, cursor pagination
   └── services/socket.js ← singleton WebSocket connection
```

---

## Module `crypto/keyGen.js`

### `generateIdentityKey() → {IK_pub, IK_secret}`

```
Input:  (không có)
Output:
  IK_pub:    Uint8Array(32) — Ed25519 public key
  IK_secret: Uint8Array(64) — Ed25519 secret key
                              Format libsodium: seed(32B) + pub(32B)
                              → IK_pub = IK_secret.slice(32)

Dùng: sodium.crypto_sign_keypair()

Tại sao Ed25519 (không phải X25519)?
  IK cần 2 vai trò:
    1. Ký SPK → phải là Ed25519 (thuật toán chữ ký số)
    2. Tham gia DH trong X3DH → convert sang X25519 khi cần
  libsodium có hàm convert an toàn: crypto_sign_ed25519_sk_to_curve25519()
```

### `generateSignedPreKey(IK_secret) → {SPK_pub, SPK_priv, SPK_sig}`

```
Input:  IK_secret: Uint8Array(64)
Output:
  SPK_pub:  Uint8Array(32) — X25519 public key
  SPK_priv: Uint8Array(32) — X25519 private key
  SPK_sig:  Uint8Array(64) — Ed25519 chữ ký của IK_priv lên SPK_pub

Bên trong:
  pair = sodium.crypto_box_keypair()          → X25519
  SPK_sig = sodium.crypto_sign_detached(pair.publicKey, IK_secret)

Tại sao ký SPK?
  Bất kỳ ai có IK_pub_B đều verify được:
  "SPK này thực sự được Bob tạo ra"
  Nếu bỏ: server thay SPK bằng key giả → MITM
```

### `generateOneTimePreKeys(n=100) → [{id, OPK_pub, OPK_priv}]`

```
Input:  n: number = 100
Output: Array(100) của {
  id:       string (UUID v4 — crypto.randomUUID())
  OPK_pub:  Uint8Array(32) — X25519 public key
  OPK_priv: Uint8Array(32) — X25519 private key
}

Dùng: sodium.crypto_box_keypair() × 100
```

### `deriveWrappingKey(password, salt) → CryptoKey`

```
Input:
  password: string — mật khẩu người dùng
  salt:     Uint8Array(16) — random, lưu cùng IndexedDB

Output: CryptoKey (AES-256-GCM, extractable:false, usage:encrypt/decrypt)

Bên trong:
  1. importKey('raw', encode(password), 'PBKDF2', false, ['deriveKey'])
  2. deriveKey({name:'PBKDF2', salt, iterations:600_000, hash:'SHA-256'},
               keyMaterial,
               {name:'AES-GCM', length:256},
               false, ['encrypt','decrypt'])

Tham số 600_000: OWASP 2023 minimum cho PBKDF2-SHA256
  → ~1 giây trên máy hiện đại → brute-force 1M password = ~1M giây
```

### `wrapPrivateKey(privKey, wrappingKey) → {wrapped:string, iv:string}`

```
Input:
  privKey:     Uint8Array — private key cần bảo vệ
  wrappingKey: CryptoKey — từ deriveWrappingKey()

Output:
  wrapped: base64 string — ciphertext AES-GCM
  iv:      base64 string — 12B random IV

Bên trong:
  iv = crypto.getRandomValues(Uint8Array(12))
  wrapped = AES-GCM.encrypt(privKey, wrappingKey, iv)
  return { wrapped: toBase64(wrapped), iv: toBase64(iv) }

Mỗi key có IV riêng → dù cùng wrappingKey, ciphertext khác nhau
```

### `unwrapPrivateKey(wrappedB64, ivB64, wrappingKey) → Uint8Array`

```
Throw: 'Sai mật khẩu — không thể mở khóa private key'
  khi AES-GCM.decrypt fail (wrappingKey sai = password sai)
```

---

## Module `crypto/x3dh.js`

### `verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub_B) → boolean`

```
Input:
  IK_pub_B:  Uint8Array(32) — Ed25519 public key của Bob
  SPK_sig:   Uint8Array(64) — chữ ký cần verify
  SPK_pub_B: Uint8Array(32) — message đã được ký

Output: boolean

Dùng: sodium.crypto_sign_verify_detached(SPK_sig, SPK_pub_B, IK_pub_B)

Nếu return false: performX3DH_sender throw 'SPK signature invalid — possible MITM attack'
Bỏ hàm này: server có thể thay SPK của Bob → đọc mọi tin nhắn
```

### `performX3DH_sender(myKeys, bobBundle) → {SK, EK_pub, OPK_id, IK_pub}`

```
Input:
  myKeys = {
    IK_secret: Uint8Array(64),  // Ed25519 secret của Alice
    IK_pub:    Uint8Array(32),  // Ed25519 public của Alice
  }
  bobBundle = {                 // từ GET /keys/{bobId}
    ikPub:  string (base64),    // Ed25519 pub của Bob
    spkPub: string (base64),    // X25519 pub (SPK_B)
    spkSig: string (base64),    // chữ ký Ed25519
    opkPub: string (base64),    // X25519 pub (OPK_B) — 1 lần dùng
    opkId:  string (UUID),
  }

Output: {
  SK:     CryptoKey (AES-256-GCM)
  EK_pub: Uint8Array(32) — Bob cần để tính DH2,3,4
  OPK_id: string — Bob cần để tìm OPK_priv
  IK_pub: Uint8Array(32) — Bob cần để tính DH1,DH2
}

Bên trong (theo đúng code x3dh.js):
  1. verifySignedPreKey(...) → throw nếu false
  2. EK = sodium.crypto_box_keypair()
  3. IK_priv   = crypto_sign_ed25519_sk_to_curve25519(IK_secret) // Ed25519→X25519
     IK_pub_B_x = crypto_sign_ed25519_pk_to_curve25519(IK_pub_B)
  4. DH1 = crypto_scalarmult(IK_priv,       SPK_pub_B)  // mutual auth
     DH2 = crypto_scalarmult(EK.privateKey, IK_pub_B_x) // mutual auth
     DH3 = crypto_scalarmult(EK.privateKey, SPK_pub_B)  // forward secrecy
     DH4 = crypto_scalarmult(EK.privateKey, OPK_pub_B)  // forward secrecy OPK
  5. F   = Uint8Array(32).fill(0xFF) // Signal spec domain separator
     IKM = concat(F, DH1, DH2, DH3, DH4) // 160 bytes
  6. SK = hkdf(IKM) // HKDF-SHA256, salt=0×32, info="E2EEChat_v1"
  7. DH1.fill(0); DH2.fill(0); DH3.fill(0); DH4.fill(0)
     IK_priv.fill(0); EK.privateKey.fill(0)  // Forward Secrecy
```

### `performX3DH_receiver(myKeys, initMsg) → {SK}`

```
Input:
  myKeys = {
    IK_secret: Uint8Array(64),  // Ed25519 secret của Bob
    SPK_priv:  Uint8Array(32),  // X25519 private của Bob
    OPK_priv:  Uint8Array(32),  // đã load từ IndexedDB trước khi gọi
  }
  initMsg = {
    ikPub: string (base64),  // IK_pub của Alice (từ WS message)
    ekPub: string (base64),  // EK_pub của Alice (từ WS message)
  }

4 phép DH ngược — cho ra cùng SK với sender:
  DH1 = crypto_scalarmult(SPK_priv,  IK_pub_A_x)  // = Alice DH1
  DH2 = crypto_scalarmult(IK_priv,   EK_pub_A)    // = Alice DH2
  DH3 = crypto_scalarmult(SPK_priv,  EK_pub_A)    // = Alice DH3
  DH4 = crypto_scalarmult(OPK_priv,  EK_pub_A)    // = Alice DH4

Sau DH4: OPK_priv.fill(0) — OPK đã dùng xong, không bao giờ dùng lại
```

---

## Module `crypto/aesGcm.js`

### `encryptMessage(plaintext, SK, convId, senderId) → {ciphertext, iv, aad}`

```
Input:
  plaintext: string
  SK:        CryptoKey (AES-256-GCM)
  convId:    string (UUID)
  senderId:  string (UUID)

Output:
  ciphertext: base64 string
  iv:         base64 string (12B random)
  aad:        string (plaintext, không mã hóa)

Bên trong:
  iv  = crypto.getRandomValues(Uint8Array(12))
  aad = `${convId}:${senderId}`
  ciphertext = AES-256-GCM.encrypt(UTF8(plaintext), SK, iv, UTF8(aad))
  return { ciphertext: toBase64(ciphertext), iv: toBase64(iv), aad }

Tại sao IV random mỗi tin?
  AES-GCM với cùng key + cùng IV → keystream giống nhau
  XOR 2 ciphertext = XOR 2 plaintext → lộ thông tin

Tại sao cần AAD?
  AAD được xác thực nhưng không mã hóa
  Nếu bỏ: attacker lấy ciphertext tin A, replay vào conv B → Bob đọc được
  Với AAD="{convId}:{senderId}": auth tag sai → decrypt fail → null
```

### `decryptMessage(ctB64, ivB64, aad, SK) → string | null`

```
Return null khi: SK sai, IV sai, AAD thay đổi, ciphertext bị sửa
Không throw → UI hiển thị "[Không thể giải mã]" thay vì crash
```

---

## Module `db/storage.js`

**Dexie schema:**
```javascript
db.version(1).stores({
  privateKeys: 'userId',  // PK = userId
  sessions:    'conversationId',  // PK = conversationId
})
```

### `savePrivateKeys(userId, wrapSalt, wrappingKey, IK_secret, SPK_priv, opkList)`

```
Lưu vào table privateKeys:
{
  userId,
  wrapSalt: toBase64(wrapSalt),    // 16B random, cần để re-derive wrappingKey
  wrappedIK, ivIK,                 // IK_secret sau AES-GCM
  wrappedSPK, ivSPK,               // SPK_priv sau AES-GCM
  wrappedOPKs: [{id, wrapped, iv}] // 100 OPK, mỗi cái IV riêng
}

Tại sao lưu wrapSalt?
  Login lần sau: cần cùng salt để PBKDF2 ra cùng wrappingKey
  wrappingKey KHÔNG lưu (phải derive lại từ password mỗi lần login)
```

### `getOPK(userId, opkId, wrappingKey) → Uint8Array | null`

```
Chỉ unwrap 1 OPK theo id — nhanh hơn loadPrivateKeys() ~100 lần
Dùng trong X3DH receiver thay vì load all 100 OPK
```

### `saveSession(conversationId, SK, wrappingKey)`

```
SK là CryptoKey → exportKey('raw') → rawSK → wrapPrivateKey(rawSK, wrappingKey)
rawSK.fill(0) ngay sau khi wrap → không để raw key trong RAM
```

---

## Module `AuthContext.jsx`

**State và ý nghĩa:**

| State | Lưu ở đâu | Mất khi nào |
|---|---|---|
| `token` | `localStorage` + React state | Logout hoặc xóa localStorage |
| `userId` | `localStorage` + React state | Logout hoặc xóa localStorage |
| `username` | `localStorage` + React state | Logout hoặc xóa localStorage |
| `wrappingKey` | RAM (React state) | Reload trang |
| `IK_secret` | RAM (React state) | Reload trang |
| `IK_pub` | RAM (React state) | Reload trang |
| `SPK_priv` | RAM (React state) | Reload trang |

**`isAuthenticated = token !== null`**  
**`isLocked = isAuthenticated && wrappingKey === null`**  
→ `isLocked = true` sau reload: localStorage có token nhưng RAM mất wrappingKey → UnlockModal

---

## Module `useWebSocket.js`

### Stale Closure Problem và Giải Pháp

```javascript
// VẤN ĐỀ: handler đăng ký lúc effect chạy "đóng băng" giá trị
// Nếu wrappingKey thay đổi sau đó, handler vẫn dùng wrappingKey cũ

// GIẢI PHÁP: dùng Ref thay vì state trực tiếp trong handler
const wrappingKeyRef = useRef(wrappingKey);
const IK_secretRef   = useRef(IK_secret);

// Sync Ref theo state
useEffect(() => { wrappingKeyRef.current = wrappingKey; }, [wrappingKey]);
useEffect(() => { IK_secretRef.current   = IK_secret;   }, [IK_secret]);

// Handler đọc từ Ref → luôn có giá trị mới nhất
async function handleIncoming(msg) {
  const wKey = wrappingKeyRef.current;  // không bao giờ stale
}
```

### `handleIncoming(msg)` — Logic nhận tin

```
1. SK = sessionKeysRef.current.get(msg.conversationId)  // RAM cache

2. Nếu không có SK:
   a. msg có ekPub + opkId + ikPub → X3DH init message:
      - getOPK(userId, msg.opkId, wrappingKey)
      - performX3DH_receiver({IK_secret, SPK_priv, OPK_priv}, msg)
      - saveSession(convId, SK, wrappingKey)
      - deleteOPK(userId, msg.opkId)
   b. Không có ekPub → load từ IndexedDB:
      - loadSession(convId, wrappingKey)

3. Nếu vẫn không có SK → hiển thị decryptError: true

4. decryptMessage(msg.ciphertext, msg.iv, msg.aad, SK) → plaintext
```

---

## Backend: `ws/handler.js`

### `clients: Map<userId, WebSocket>`

```
In-memory Map — sống trong RAM Node.js process
Mất khi server restart → client auto-reconnect (socket.js có reconnect logic)
Không dùng Redis vì chỉ có 1 server instance

Single-session policy (dòng 60-65 handler.js):
  Khi user mở tab mới → WS connect mới → server đóng WS cũ
  Gửi {type:'session_replaced'} cho WS cũ trước khi đóng
  Tránh: 2 WS cùng userId → tin đến 1 trong 2 ngẫu nhiên
```

### `onConnect(ws, req)` — JWT từ query string

```
Token lấy từ: req.url.split('?token=')[1]
Tại sao query string, không phải header?
  WebSocket browser API không hỗ trợ custom header trong handshake
  Query string là cách duy nhất browser gửi token qua WS upgrade
```

---

## Backend: `routes/auth.js` (POST /auth/login)

### Timing Attack Protection

```javascript
const DUMMY_HASH = '$2b$12$invalidhashfortimingatk';
const isValid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
```

Nếu user không tồn tại và return sớm → response nhanh hơn → attacker đoán được username.  
Dùng `DUMMY_HASH`: dù user không tồn tại, vẫn tốn ~250ms để bcrypt.compare.  
Cả 2 case đều trả cùng message: "Tên đăng nhập hoặc mật khẩu không đúng"
