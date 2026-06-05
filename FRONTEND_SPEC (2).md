# FRONTEND_SPEC.md — E2EE Chat Frontend

## Mục đích file này
Spec chi tiết cho toàn bộ Frontend. Viết trước khi code để:
- Claude Code đọc và viết đúng ngay lần đầu
- Giải thích với giáo viên hướng dẫn
- Tham chiếu khi debug hoặc refactor

## Tech Stack Frontend
| Thứ | Công nghệ | Lý do |
|---|---|---|
| Framework | React 18 + Vite | Create React App đã deprecated, Vite nhanh hơn nhiều |
| Styling | TailwindCSS | Utility-first, không cần viết CSS file riêng |
| Routing | React Router v6 | Chuẩn cho React SPA |
| IndexedDB | Dexie.js | Wrapper đơn giản cho IndexedDB, hỗ trợ async/await |
| Crypto | libsodium-wrappers + Web Crypto API | Đã chốt từ backend spec |
| HTTP | fetch() native | Không cần axios cho scope này |
| WebSocket | WebSocket API native | Không cần socket.io |

## Cấu trúc thư mục
```
frontend/src/
├── pages/
│   ├── Register.jsx
│   ├── Login.jsx
│   └── Chat.jsx
├── components/
│   ├── Sidebar.jsx
│   ├── ConversationItem.jsx
│   ├── MessageList.jsx
│   ├── MessageBubble.jsx
│   ├── MessageInput.jsx
│   └── FingerprintModal.jsx
├── hooks/
│   ├── useAuth.js
│   ├── useWebSocket.js
│   └── useMessages.js
├── contexts/
│   └── AuthContext.jsx
├── crypto/
│   ├── keyGen.js
│   ├── x3dh.js
│   ├── aesGcm.js
│   └── fingerprint.js
├── db/
│   └── storage.js
├── services/
│   ├── api.js
│   └── socket.js
└── App.jsx
```

## Thứ tự code (BẮT BUỘC làm theo thứ tự này)
1. `crypto/` — 4 file, không phụ thuộc React
2. `db/storage.js` — phụ thuộc Dexie
3. `services/api.js` — phụ thuộc fetch
4. `contexts/AuthContext.jsx` — phụ thuộc React
5. `hooks/useAuth.js` — phụ thuộc AuthContext
6. `pages/Register.jsx` + `pages/Login.jsx` — test được ngay
7. `services/socket.js` — cần token từ useAuth
8. `hooks/useWebSocket.js` — phụ thuộc socket.js
9. `hooks/useMessages.js` — phụ thuộc crypto + api
10. `components/` — 6 component
11. `pages/Chat.jsx` — ghép tất cả lại
12. `App.jsx` — routing

---

# PHẦN 1: CRYPTO LAYER

> NGUYÊN TẮC: Toàn bộ 4 file này là pure JS, không có React, không có fetch.
> Có thể test độc lập bằng cách import vào console.

## crypto/keyGen.js

### Mục đích
Sinh và quản lý các loại key dùng trong X3DH. Đây là file đầu tiên cần viết.

### Dependencies
```js
import sodium from 'libsodium-wrappers';
// Web Crypto API dùng qua window.crypto.subtle — không cần import
```

### Các hàm cần có

#### `generateIdentityKey()`
```
Mục đích: Sinh Ed25519 keypair vĩnh viễn — đại diện danh tính của user
Input: không có
Output: { IK_pub: Uint8Array(32), IK_secret: Uint8Array(64) }
  IK_pub    = Ed25519 public key (32B) — upload lên server
  IK_secret = Ed25519 secret key (64B) = seed(32B) + pub(32B)
            → IK_pub = IK_secret.slice(32) (không cần lưu riêng)
Thư viện: sodium.crypto_sign_keypair()
Ghi chú: Chỉ gọi 1 lần duy nhất khi đăng ký. Không bao giờ gọi lại.
         Khi cần DH: convert sang X25519 bằng crypto_sign_ed25519_sk_to_curve25519()
```

#### `generateSignedPreKey(IK_secret)`
```
Mục đích: Sinh SPK và ký bằng IK để server không giả mạo được
Input: IK_secret (Uint8Array 64B — Ed25519 secret key)
Output: { SPK_pub: Uint8Array, SPK_priv: Uint8Array, SPK_sig: Uint8Array }
Thư viện: sodium.crypto_box_keypair() + sodium.crypto_sign_detached()
Ghi chú: SPK_sig = Ed25519.sign(IK_secret, SPK_pub)
         Rotate SPK định kỳ (mỗi 7 ngày) — scope hiện tại chưa làm
```

#### `generateOneTimePreKeys(n = 100)`
```
Mục đích: Sinh 100 OPK — mỗi cái dùng đúng 1 lần, sau đó xóa
Input: n (number, default 100)
Output: Array of { OPK_pub: Uint8Array, OPK_priv: Uint8Array, id: string }
        id = crypto.randomUUID() để server và client đối chiếu OPK nào đã dùng
Thư viện: sodium.crypto_box_keypair()
Ghi chú: Khi pool < 10, cần gọi lại và upload thêm qua POST /keys/opk
```

#### `deriveWrappingKey(password, salt)`
```
Mục đích: Derive AES-GCM key từ password bằng PBKDF2 — chạy 1 lần duy nhất mỗi session
Input:
  - password (string): mật khẩu người dùng nhập
  - salt (Uint8Array 16B): ngẫu nhiên, lưu cùng record trong IndexedDB
Output: CryptoKey (AES-GCM 256-bit, extractable: false)
Thư viện: Web Crypto API

Chi tiết:
  keyMaterial = importKey('raw', encode(password), 'PBKDF2', false, ['deriveKey'])
  wrappingKey = deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,              // wrappingKey không export được
    ['encrypt', 'decrypt']
  )

Lý do tách riêng: PBKDF2 600k iterations tốn ~0.5s → chỉ chạy 1 lần,
                  dùng wrappingKey đó để wrap/unwrap nhiều key khác nhau.
```

#### `wrapPrivateKey(privKey, wrappingKey)`
```
Mục đích: Mã hóa 1 private key bằng AES-GCM trước khi lưu IndexedDB
Input:
  - privKey (Uint8Array): private key cần bảo vệ
  - wrappingKey (CryptoKey): AES-GCM key từ deriveWrappingKey()
Output: { wrapped: string (base64), iv: string (base64) }
  KHÔNG có salt trong output — salt đã lưu riêng 1 lần trong record wrapSalt
Thư viện: Web Crypto API

Chi tiết:
  iv      = crypto.getRandomValues(new Uint8Array(12))  ← IV riêng cho mỗi key
  wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, privKey)
  return { wrapped: toBase64(wrapped), iv: toBase64(iv) }

Nếu bỏ hàm này: private key lưu dạng plaintext trong IndexedDB → ai truy cập máy là lấy được key
```

#### `unwrapPrivateKey(wrappedB64, ivB64, wrappingKey)`
```
Mục đích: Giải mã private key từ IndexedDB
Input:
  - wrappedB64 (string base64): private key đã mã hóa
  - ivB64 (string base64): IV dùng khi wrap
  - wrappingKey (CryptoKey): AES-GCM key từ deriveWrappingKey()
Output: Uint8Array (private key gốc)
Thư viện: Web Crypto API

Lưu ý: Nếu password sai → wrappingKey sai → AES-GCM decrypt throw DOMException
        → bắt lỗi, throw new Error('Sai mật khẩu — không thể mở khóa private key')
```

---

## crypto/x3dh.js

### Mục đích
Thực hiện giao thức X3DH để 2 bên tính ra cùng 1 Session Key mà không cần gặp nhau.

### Dependencies
```js
import sodium from 'libsodium-wrappers';
// Web Crypto API cho HKDF
```

### Các hàm cần có

#### `verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub_B)`
```
Mục đích: Xác minh SPK của Bob chưa bị server giả mạo
Input:
  - IK_pub_B (Uint8Array): Identity Key public của Bob
  - SPK_sig (Uint8Array): chữ ký Ed25519
  - SPK_pub_B (Uint8Array): Signed PreKey public của Bob
Output: boolean
Thư viện: sodium.crypto_sign_verify_detached(SPK_sig, SPK_pub_B, IK_pub_B)

Nếu return false: DỪNG ngay, không tiếp tục X3DH — server có thể đang MITM
Nếu bỏ hàm này: không phát hiện được server giả mạo SPK → bị MITM mà không biết
```

#### `performX3DH_sender(myKeys, bobBundle)`
```
Mục đích: Alice tính Session Key khi muốn nhắn tin cho Bob lần đầu
Input:
  myKeys: {
    IK_secret: Uint8Array(64),  // Ed25519 secret key — convert sang X25519 bên trong
    IK_pub:    Uint8Array(32),  // Ed25519 public key — gửi cho Bob qua trường ikPub
  }
  bobBundle: {                  // tất cả là base64 string từ GET /keys/:bobId
    ikPub:  string,             // Ed25519 pub của Bob → convert sang X25519 bên trong
    spkPub: string,             // X25519 pub (Signed PreKey)
    spkSig: string,             // Ed25519 signature của Bob
    opkPub: string,             // X25519 pub (One-Time PreKey)
    opkId:  string              // UUID của OPK — gửi lại cho Bob trong tin nhắn
  }
Output: {
  SK:     CryptoKey,          // AES-256-GCM key — dùng để encrypt tin đầu tiên
  EK_pub: Uint8Array(32),     // Ephemeral Key public — gửi cho Bob để tính lại SK
  OPK_id: string,             // UUID OPK đã dùng — Bob cần để tìm OPK_priv
  IK_pub: Uint8Array(32),     // IK_pub của Alice — Bob cần để tính DH1 chiều ngược
}

Chi tiết 4 phép DH (tất cả X25519):
  EK      = sodium.crypto_box_keypair()   ← ephemeral key, dùng 1 lần duy nhất
  IK_priv = crypto_sign_ed25519_sk_to_curve25519(IK_secret)   ← convert Ed25519→X25519
  IK_pub_B_x = crypto_sign_ed25519_pk_to_curve25519(IK_pub_B) ← convert Ed25519→X25519

  DH1 = scalarmult(IK_priv,      SPK_pub_B)    ← mutual auth
  DH2 = scalarmult(EK.privateKey, IK_pub_B_x)  ← mutual auth
  DH3 = scalarmult(EK.privateKey, SPK_pub_B)   ← forward secrecy
  DH4 = scalarmult(EK.privateKey, OPK_pub_B)   ← forward secrecy (OPK)

  F   = new Uint8Array(32).fill(0xFF)           ← phân biệt X25519 vs X448
  IKM = concat(F, DH1, DH2, DH3, DH4)          ← 160 bytes
  SK  = HKDF-SHA256(IKM, salt=0x00×32, info="E2EEChat_v1", length=32)
  SK import với extractable: true — để lưu IndexedDB

SAU KHI TÍNH XONG: DH1–DH4.fill(0), IK_priv.fill(0), EK.privateKey.fill(0) ← BẮT BUỘC
Nếu không xóa: vi phạm Forward Secrecy — ai dump memory sau này vẫn tính lại được SK
```

#### `performX3DH_receiver(myKeys, initMsg)`
```
Mục đích: Bob tính lại SK từ tin nhắn đầu tiên Alice gửi
Input:
  myKeys: {
    IK_secret: Uint8Array(64),  // Ed25519 secret key của Bob — convert sang X25519 bên trong
    SPK_priv:  Uint8Array(32),  // X25519 private key của Bob
    OPK_priv:  Uint8Array(32),  // X25519 private key của OPK đã dùng
                                // caller load từ opkMap (storage.loadPrivateKeys) trước khi gọi
  }
  initMsg: {                    // base64 strings từ trường trong Message DB
    ikPub:  string,             // IK_pub của Alice (Ed25519) → convert sang X25519 bên trong
    ekPub:  string,             // EK_pub của Alice (X25519)
    opkId:  string              // UUID của OPK đã dùng (để caller xóa sau)
  }
Output: { SK: CryptoKey }     // cùng SK với Alice nếu tất cả đúng

Chi tiết (chiều ngược, tất cả X25519):
  IK_priv    = crypto_sign_ed25519_sk_to_curve25519(IK_secret)
  IK_pub_A_x = crypto_sign_ed25519_pk_to_curve25519(IK_pub_A)

  DH1 = scalarmult(SPK_priv, IK_pub_A_x)  ← đối xứng DH1 Alice
  DH2 = scalarmult(IK_priv,  EK_pub_A)    ← đối xứng DH2 Alice
  DH3 = scalarmult(SPK_priv, EK_pub_A)    ← đối xứng DH3 Alice
  DH4 = scalarmult(OPK_priv, EK_pub_A)    ← đối xứng DH4 Alice
  (HKDF giống hệt bên sender)

SAU KHI TÍNH XONG: DH1–DH4.fill(0), IK_priv.fill(0), OPK_priv.fill(0) ← BẮT BUỘC
Caller gọi storage.deleteOPK(userId, opkId) sau khi có SK — OPK dùng 1 lần, không dùng lại
```

---

## crypto/aesGcm.js

### Mục đích
Mã hóa và giải mã từng tin nhắn bằng AES-256-GCM.

### Dependencies
```js
// Web Crypto API — không cần import
```

### Các hàm cần có

#### `encryptMessage(plaintext, SK, conversationId, senderId)`
```
Mục đích: Mã hóa 1 tin nhắn trước khi gửi lên server
Input:
  - plaintext (string): nội dung tin nhắn người dùng gõ
  - SK (CryptoKey): Session Key từ X3DH
  - conversationId (string): UUID của conversation
  - senderId (string): userId của người gửi
Output: { ciphertext: string (base64), iv: string (base64), aad: string }

Chi tiết:
  iv  = crypto.getRandomValues(new Uint8Array(12))  ← PHẢI random mỗi tin
  aad = `${conversationId}:${senderId}`             ← authenticated, không encrypted
  encoded = new TextEncoder().encode(plaintext)
  ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    SK,
    encoded
  )
  return { ciphertext: toBase64(ciphertext), iv: toBase64(iv), aad }

Tại sao IV phải random mỗi tin: cùng plaintext + cùng key + cùng IV → cùng ciphertext
                                  attacker quan sát được 2 tin giống nhau
Tại sao có AAD: buộc ciphertext vào đúng conversation và người gửi
               Nếu ai copy ciphertext sang conversation khác → auth_tag sai → decrypt fail
```

#### `decryptMessage(ciphertext, iv, aad, SK)`
```
Mục đích: Giải mã tin nhắn nhận được
Input:
  - ciphertext (string base64)
  - iv (string base64)
  - aad (string)
  - SK (CryptoKey)
Output: string (plaintext)

Nếu SK sai, IV sai, hoặc AAD bị sửa → crypto.subtle.decrypt throw DOMException
→ bắt lỗi, return null, hiển thị "[Không giải mã được]" thay vì crash
```

---

## crypto/fingerprint.js

### Mục đích
Tạo chuỗi 60 chữ số để 2 bên xác minh danh tính qua kênh ngoài (điện thoại).

### Hàm cần có

#### `generateFingerprint(IK_pub_A, IK_pub_B)`
```
Mục đích: Tạo fingerprint 60 số — giống hệt nhau dù Alice hay Bob gọi trước
Input: 2 Uint8Array (2 Identity Key public)
Output: string (60 chữ số, padStart)

Chi tiết:
  sorted  = [IK_pub_A, IK_pub_B].sort(lexicographicCompare)
  combined = concat(sorted[0], sorted[1])
  hash     = await crypto.subtle.digest('SHA-512', combined)
  for (let i = 0; i < 5199; i++) hash = await crypto.subtle.digest('SHA-512', hash)
  fingerprint = BigInt('0x' + toHex(new Uint8Array(hash))) % BigInt(10n ** 60n)
  return fingerprint.toString().padStart(60, '0')

Tại sao sort: đảm bảo Alice gọi generateFingerprint(A, B) và Bob gọi generateFingerprint(B, A)
              ra cùng kết quả — không phụ thuộc thứ tự
Tại sao 5200 vòng: chống brute force — kẻ tấn công không thể thử hàng triệu key giả
```

---

# PHẦN 2: DATABASE LAYER

## db/storage.js

### Mục đích
Wrapper Dexie.js cho IndexedDB. Lưu private key đã wrap và session key.
Server không bao giờ thấy dữ liệu này.

### Dependencies
```js
import Dexie from 'dexie';
```

### Schema IndexedDB
```js
const db = new Dexie('E2EEChatDB');
db.version(1).stores({
  privateKeys: 'userId',
  // Lưu: { userId, wrapSalt, wrappedIK, ivIK, wrappedSPK, ivSPK, wrappedOPKs[] }
  // wrapSalt: base64 string — 1 salt dùng chung để derive wrappingKey (PBKDF2 chạy 1 lần)
  // IK_pub KHÔNG lưu riêng — recover bằng IK_secret.slice(32) khi cần
  // wrappedOPKs: [{ id, wrapped, iv }]

  sessions: 'conversationId',
  // Lưu: { conversationId, wrappedSK, ivSK }
  // wrappedSK = AES-GCM encrypt(rawSK, wrappingKey) — SK không bao giờ lưu dạng plaintext
});
```

### Các hàm cần export

#### `savePrivateKeys(userId, wrapSalt, wrappingKey, IK_secret, SPK_priv, opkList)`
```
Mục đích: Wrap và lưu private key sau khi đăng ký
Input:
  userId     (string)
  wrapSalt   (Uint8Array 16B) — ngẫu nhiên, dùng để re-derive wrappingKey sau logout
  wrappingKey (CryptoKey)    — AES-GCM key từ deriveWrappingKey(), đã derive sẵn
  IK_secret  (Uint8Array 64B) — Ed25519 secret key
  SPK_priv   (Uint8Array 32B) — X25519 private key
  opkList    (Array<{id: string, OPK_priv: Uint8Array}>) — 100 OPK
Output: Promise<void>
Ghi chú: hàm tự gọi wrapPrivateKey() cho từng key, PBKDF2 không chạy lại ở đây
```

#### `loadPrivateKeys(userId, wrappingKey)`
```
Input: userId (string), wrappingKey (CryptoKey)
Output: { wrapSalt: Uint8Array, IK_secret: Uint8Array, IK_pub: Uint8Array,
          SPK_priv: Uint8Array, opkMap: Map<id, OPK_priv> }
        hoặc null nếu user chưa đăng ký trên thiết bị này
Ghi chú: IK_pub = IK_secret.slice(32) — tính bên trong, không unwrap riêng
         opkMap: Map<string, Uint8Array> — tra cứu O(1) trong performX3DH_receiver
```

#### `saveSession(conversationId, SK, wrappingKey)`
```
Mục đích: Lưu Session Key sau khi X3DH xong — tránh mất SK khi reload
Input:
  conversationId (string)
  SK (CryptoKey, extractable: true) — AES-256-GCM key từ X3DH
  wrappingKey (CryptoKey) — để wrap SK trước khi lưu
Ghi chú: export SK → raw bytes → wrapPrivateKey() → lưu IndexedDB
         raw bytes xóa ngay sau khi wrap (rawSK.fill(0))
```

#### `loadSession(conversationId, wrappingKey)`
```
Input: conversationId (string), wrappingKey (CryptoKey)
Output: CryptoKey (AES-256-GCM, extractable: true) hoặc null nếu chưa có session
Ghi chú: unwrap raw bytes → importKey → xóa raw bytes → trả CryptoKey
```

#### `deleteOPK(userId, opkId)`
```
Mục đích: Xóa OPK đã dùng khỏi IndexedDB
Gọi sau: performX3DH_receiver xong → OPK_priv không cần nữa
```

#### `hasPrivateKeys(userId)`
```
Output: boolean — kiểm tra user đã có key trong IndexedDB chưa
Dùng ở Login: nếu false → yêu cầu đăng ký lại (ví dụ đổi máy)
```

---

# PHẦN 3: SERVICES LAYER

## services/api.js

### Mục đích
Tập trung toàn bộ lệnh gọi REST API. Không có logic crypto hay React ở đây.

### Pattern chung
```js
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function apiFetch(path, options = {}, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  // Đọc body 1 lần duy nhất — stream chỉ đọc được 1 lần
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
```

### Các hàm cần export

#### Auth
```js
register(username, password)
  // POST /auth/register
  // Chỉ tạo user — KHÔNG upload key ở đây
  // Sau khi register xong, gọi tiếp uploadKeys()

login(username, password)
  // POST /auth/login
  // Return: { token, userId, username }

logout(token)
  // POST /auth/logout
  // Đưa token vào Redis blocklist
```

#### Keys
```js
uploadKeys(token, { ikPub, spkPub, spkSig, opkPubs })
  // POST /keys/upload
  // Tất cả là base64 string
  // Gọi 1 lần duy nhất sau register

fetchKeyBundle(token, userId)
  // GET /keys/:userId
  // Return: { ikPub, spkPub, spkSig, opkPub, opkId } — base64 strings
  // Server tự pop 1 OPK khỏi pool

uploadMoreOPKs(token, opkPubs)
  // POST /keys/opk
  // Gọi khi pool OPK < 10

rotateSpk(token, { spkPub, spkSig })
  // POST /keys/spk
  // Rotate Signed PreKey — IK và OPK giữ nguyên
```

#### Conversations
```js
createConversation(token, recipientId)
  // POST /conversations
  // Idempotent: gọi nhiều lần vẫn trả về cùng conversationId
  // Return: { conversationId }

listConversations(token)
  // GET /conversations
  // Return: [{ conversationId, peer: {id, username}, fingerprintVerified, lastMessageAt }]

verifyFingerprint(token, conversationId)
  // PATCH /conversations/:convId/fingerprint
  // Chỉ gọi sau khi user bấm "Xác nhận" trong FingerprintModal

deleteConversation(token, conversationId)
  // DELETE /conversations/:convId
  // Xóa conversation + toàn bộ tin nhắn bên trong
```

#### Messages
```js
sendMessage(token, { conversationId, ciphertext, iv, aad, ekPub, opkId, ikPub })
  // POST /messages
  // ekPub, opkId, ikPub: chỉ có ở tin X3DH đầu tiên, null ở mọi tin còn lại
  // Return: { messageId, createdAt }

loadMessages(token, conversationId, cursor = null, limit = 20)
  // GET /messages/:convId?cursor=...&limit=20
  // cursor = null → load 20 tin mới nhất
  // cursor = id tin cuối → load 20 tin trước đó (scroll lên)
  // Return: { messages: [...], nextCursor }

deleteMessage(token, messageId)
  // DELETE /messages/:messageId
  // Chỉ người gửi mới xóa được tin của mình
```

#### Users
```js
searchUsers(token, keyword)
  // GET /users?search=keyword
  // keyword phải >= 2 ký tự
  // Return: { users: [{ id, username }] }
```

---

## services/socket.js

### Mục đích
Quản lý WebSocket connection. Tách ra file riêng vì WS là stateful (tồn tại suốt session),
khác với api.js là stateless.

### Thiết kế
```js
// Module-level singleton — chỉ có 1 socket tại một thời điểm
let ws = null;
const listeners = new Map();  // Map<eventType, callback>

export function connectSocket(token) {
  // Tạo kết nối: ws://localhost:3000/ws?token=...
  // Tự động reconnect sau 3 giây nếu mất kết nối (ws.onclose)
  // Parse JSON từ ws.onmessage, dispatch đến đúng listener
}

export function disconnectSocket() {
  ws?.close();
  ws = null;
}

export function sendSocketMessage(payload) {
  // Chỉ gửi khi ws.readyState === WebSocket.OPEN
  ws?.send(JSON.stringify(payload));
}

export function onSocketEvent(type, callback) {
  // Đăng ký listener cho loại message: 'message', 'presence', 'ack', 'pong'
  listeners.set(type, callback);
}

export function offSocketEvent(type) {
  listeners.delete(type);
}
```

### Các loại message từ server (ws.onmessage)
```
{ type: 'connected', userId, onlineUsers: [userId, ...] }
  → Gửi ngay khi kết nối thành công

{ type: 'message', msgId, conversationId, senderId, ciphertext, iv, aad, ekPub?, opkId?, ikPub?, createdAt }
  → Tin nhắn mới từ người khác

{ type: 'presence', userId, status: 'online' | 'offline' }
  → Trạng thái online của user khác thay đổi

{ type: 'ack', success: true, msgId, createdAt }
  → Server xác nhận đã lưu tin nhắn vừa gửi

{ type: 'pong' }
  → Response cho ping keepalive

{ type: 'error', error: string }
  → Server báo lỗi
```

### Keepalive
```
Mỗi 30 giây gửi { type: 'ping' } để giữ kết nối không bị timeout
setInterval(() => sendSocketMessage({ type: 'ping' }), 30_000)
```

---

# PHẦN 4: CONTEXTS

## contexts/AuthContext.jsx

### Mục đích
Chia sẻ thông tin login (token, userId, username, private key trong RAM)
cho mọi component mà không cần truyền props qua nhiều tầng.

### State quản lý
```js
// ── Lưu localStorage (còn sau reload) ──────────────────────────────────────
// Mục đích: app biết user "đã login" sau khi reload mà không cần đăng nhập lại
// Rủi ro: localStorage đọc được bởi JS → XSS có thể lấy token
// Trade-off: chấp nhận được cho internal enterprise tool, đổi lại UX tốt hơn
token:    string | null   // JWT — localStorage.setItem('token', token)
userId:   string | null   // localStorage.setItem('userId', userId)
username: string | null   // localStorage.setItem('username', username)

// ── Lưu RAM only (mất khi reload — đúng với thiết kế) ──────────────────────
// Không bao giờ persist ra disk hay gửi lên server
wrappingKey: CryptoKey | null  // PBKDF2 derived từ password — ephemeral có chủ ý
                               // Mất khi reload → user phải nhập password lại (unlock)
IK_secret: Uint8Array | null   // Ed25519 secret key 64B — cần cho X3DH sender
IK_pub:   Uint8Array | null    // Ed25519 public key 32B
SPK_priv: Uint8Array | null    // X25519 private key 32B — cần cho X3DH receiver

// ── Derived states ──────────────────────────────────────────────────────────
isAuthenticated: boolean  // = localStorage.getItem('token') !== null
isLocked:        boolean  // = isAuthenticated && wrappingKey === null
                          // true sau reload: token có nhưng wrappingKey mất
                          // → hiển thị UnlockModal thay vì redirect /login
```

### Các hàm expose qua context
```js
register(username, password, email)
  // Chỉ làm 2 việc: tạo tài khoản trên server + sinh/lưu key cục bộ
  // KHÔNG login, KHÔNG upload key — đó là việc của login()
  // 1. Sinh IK, SPK, 100 OPK qua keyGen.js (cục bộ, chưa cần internet)
  //    const { IK_pub, IK_secret } = await generateIdentityKey()
  //    const { SPK_pub, SPK_priv, SPK_sig } = await generateSignedPreKey(IK_secret)
  //    const opkList = await generateOneTimePreKeys(100)
  // 2. Tạo salt ngẫu nhiên + derive wrappingKey (PBKDF2 chạy 1 lần)
  //    const wrapSalt = crypto.getRandomValues(new Uint8Array(16))
  //    const wrappingKey = await deriveWrappingKey(password, wrapSalt)
  // 3. Gọi api.register(username, password, email) → server tạo User, trả { userId } (201)
  //    Lý do gọi TRƯỚC savePrivateKeys: cần userId thật từ server làm primary key IndexedDB
  // 4. Lưu vào IndexedDB — storage.savePrivateKeys() tự wrap từng key bên trong
  //    await storage.savePrivateKeys(userId, wrapSalt, wrappingKey, IK_secret, SPK_priv, opkList)
  // 5. Navigate sang trang Login — KHÔNG tự login
  // Lý do không gộp login vào đây: upload key cần JWT, JWT chỉ có sau login
  // → tách biệt rõ ràng, mỗi hàm một nhiệm vụ

login(username, password)
  // Làm 3 việc: xác thực server + unwrap key + upload key lên server
  // 1. Gọi api.login() → { token, userId, username }
  // 2. Kiểm tra IndexedDB có key không (storage.hasPrivateKeys)
  //    → Không có: throw 'DEVICE_NOT_REGISTERED' → Login.jsx hiện UI import .e2ee
  // 3. Derive wrappingKey = PBKDF2(password, wrapSalt từ IndexedDB)
  // 4. Load + unwrap private keys từ IndexedDB (storage.loadPrivateKeys)
  //    Nếu password sai: AES-GCM decrypt throw DOMException → bắt → throw 'Sai mật khẩu'
  // 5. Gọi api.uploadKeys() với public keys (dùng JWT vừa lấy)
  //    → Lần đăng nhập đầu tiên: server tạo KeyBundle mới, trả 201
  //    → Lần đăng nhập tiếp theo: server trả 409 (đã tồn tại) → bỏ qua, không phải lỗi
  // 6. Lưu token, userId, username vào localStorage
  //    localStorage.setItem('token', token)
  //    localStorage.setItem('userId', userId)
  //    localStorage.setItem('username', username)
  // 7. Set RAM state: wrappingKey, IK_secret, IK_pub, SPK_priv
  //
  // Session Keys KHÔNG load ở đây — lazy-load khi mở conversation (xem useMessages)

unlock(password)
  // Gọi sau khi reload: token có trong localStorage nhưng wrappingKey mất khỏi RAM
  // KHÔNG gọi server — toàn bộ xử lý cục bộ
  // 1. Đọc record thô từ IndexedDB: record = await db.privateKeys.get(userId)
  //    → null: không có key trên thiết bị này → throw 'DEVICE_NOT_REGISTERED'
  // 2. Derive wrappingKey = PBKDF2(password, fromBase64(record.wrapSalt))
  //    → wrappingKey = await deriveWrappingKey(password, fromBase64(record.wrapSalt))
  // 3. Gọi storage.loadPrivateKeys(userId, wrappingKey) — unwrap tất cả 1 lần
  //    → Sai password: AES-GCM throw DOMException bên trong → bắt → throw 'Sai mật khẩu'
  //    → Đúng password: trả { wrapSalt, IK_secret, IK_pub, SPK_priv, opkMap }
  //    IK_pub = IK_secret.slice(32) — tính bên trong loadPrivateKeys, không unwrap riêng
  // 4. Set RAM state: wrappingKey, IK_secret, IK_pub, SPK_priv
  //    → isLocked tự chuyển sang false → UnlockModal tự đóng
  //
  // Lý do unwrap ngay lúc unlock (không lazy):
  //   IK_secret cần sẵn trong RAM khi X3DH sender (gửi tin mới cho người chưa chat)
  //   SPK_priv cần sẵn khi X3DH receiver (nhận tin đầu từ người mới)
  //   → Unwrap 1 lần lúc unlock = fail-fast + sẵn sàng dùng ngay

logout()
  // 1. Gọi api.logout(token) → server revoke token vào Redis blocklist
  // 2. Ngắt WebSocket: disconnectSocket()
  // 3. Xóa localStorage: removeItem token, userId, username
  // 4. Xóa RAM state: wrappingKey, IK_secret, IK_pub, SPK_priv → null
  // KHÔNG xóa IndexedDB — wrapped keys vẫn còn, lần sau login lại unwrap được

// Khởi tạo AuthProvider (chạy 1 lần khi app load):
//   Đọc token từ localStorage → set isAuthenticated
//   wrappingKey = null → isLocked = true nếu token tồn tại
//   → App tự hiển thị UnlockModal nếu isLocked (xem ProtectedRoute)
```

### Cách dùng trong component
```jsx
// App.jsx bọc toàn bộ
<AuthProvider>
  <RouterProvider ... />
</AuthProvider>

// Bất kỳ component nào cần
const { token, userId, login, logout, isAuthenticated } = useContext(AuthContext);
```

---

# PHẦN 5: HOOKS

## hooks/useAuth.js

### Mục đích
Custom hook để dùng AuthContext gọn hơn. Thêm guard nếu dùng ngoài Provider.

```js
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải dùng trong AuthProvider');
  return ctx;
}
```

---

## hooks/useWebSocket.js

### Mục đích
Kết nối WebSocket, nhận tin nhắn mới, decrypt, cập nhật state online users.
Được dùng trong Chat.jsx — chạy suốt thời gian user ở trang Chat.

### Interface
```js
function useWebSocket() {
  // Lấy token, userId, IK_secret, wrappingKey từ useAuth()
  // Lấy sessionKeys (Map<conversationId, CryptoKey>) từ... (xem bên dưới)

  return {
    onlineUsers: Set<userId>,    // Set userId đang online
    isConnected: boolean,        // WebSocket đang mở không

    // Callback — Chat.jsx đăng ký để nhận tin mới
    onNewMessage: (callback) => void
    // callback nhận: { conversationId, message: { id, senderId, plaintext, createdAt } }
  }
}
```

### Luồng xử lý tin nhắn đến (type: 'message')
```
1. Nhận raw message từ server: { ciphertext, iv, aad, ekPub?, opkId?, ikPub?, conversationId }

2. Kiểm tra có session key cho conversationId chưa:
   - Có: dùng SK đó để decrypt thẳng → bước 5
   - Không có + có ekPub (tin X3DH đầu): chạy performX3DH_receiver → lưu SK → bước 5
   - Không có + không có ekPub: lỗi — không giải mã được, hiển thị "[Tin nhắn không giải mã được]"

3. X3DH receiver (nếu cần):
   - Load SPK_priv, OPK_priv[opkId] từ IndexedDB
   - Gọi x3dh.performX3DH_receiver()
   - Lưu SK mới vào IndexedDB qua storage.saveSession()
   - Xóa OPK đã dùng qua storage.deleteOPK()

4. Decrypt: aesGcm.decryptMessage(ciphertext, iv, aad, SK)
   - Lỗi decrypt: return { plaintext: null, error: true }

5. Gọi onNewMessage callback với plaintext
```

### Xử lý presence
```
{ type: 'presence', userId, status: 'online'|'offline' }
→ Cập nhật onlineUsers Set
→ React re-render tự động vì dùng useState
```

---

## hooks/useMessages.js

### Mục đích
Load lịch sử tin nhắn, decrypt từng tin, quản lý cursor pagination.
Tách khỏi useWebSocket vì đây là batch loading, không phải real-time.

### Interface
```js
function useMessages(conversationId) {
  return {
    messages: Array<{
      id: string,
      senderId: string,
      plaintext: string | null,  // null nếu decrypt fail
      createdAt: string,
      isDecryptError: boolean
    }>,
    isLoading: boolean,
    hasMore: boolean,       // còn tin cũ hơn để load không
    loadMore: () => void,   // gọi khi user scroll lên đầu
    addMessage: (msg) => void  // gọi từ useWebSocket khi có tin mới real-time
  }
}
```

### Luồng load lịch sử
```
1. conversationId thay đổi (user click conversation khác):
   - Reset state: messages = [], cursor = null, hasMore = true

2. Gọi api.loadMessages(token, conversationId, cursor=null, limit=20)
   → Server trả về 20 tin mới nhất, sắp xếp mới → cũ

3. Với mỗi tin trong kết quả:
   - Lấy SK từ storage.loadSession(conversationId) → unwrap bằng wrappingKey
   - Nếu chưa có SK và tin có ekPub → cần X3DH receiver trước
   - Gọi aesGcm.decryptMessage(ciphertext, iv, aad, SK)
   - Nếu decrypt fail: { plaintext: null, isDecryptError: true }

4. Lưu vào state messages[], đảo ngược thứ tự (hiển thị cũ → mới từ trên xuống)

5. nextCursor = null → hasMore = false (đã load hết)
   nextCursor có giá trị → hasMore = true, lưu cursor cho lần loadMore tiếp

6. loadMore(): gọi api.loadMessages với cursor hiện tại → prepend vào đầu messages[]

Lưu ý: KHÔNG decrypt lại tin đã decrypt — kiểm tra messages[].id trước khi thêm
```

---

# PHẦN 6: PAGES

## pages/Register.jsx

### Mục đích
Form đăng ký. Khi submit: sinh key → wrap → lưu IndexedDB → gọi api.register() → navigate Login.

### Cơ chế Whitelist Email
Đây là hệ thống nội bộ doanh nghiệp — không phải ai cũng đăng ký được.
IT Admin thêm email nhân viên vào bảng AllowedEmail trong DB trước.
Chỉ email có trong whitelist mới được phép tạo tài khoản.

```
Bảng AllowedEmail trong PostgreSQL:
{ id, email, usedAt }
  usedAt = null       → email hợp lệ, chưa được dùng → cho phép đăng ký
  usedAt = timestamp  → email đã được dùng rồi → từ chối 409
```

Server kiểm tra 2 lớp:
- Email không có trong whitelist → 403 "Email này không được phép đăng ký"
- Email có nhưng usedAt != null  → 409 "Email đã được dùng để đăng ký tài khoản"

Sau khi đăng ký thành công, server cập nhật usedAt = now() trong cùng 1 transaction
→ đảm bảo 1 email chỉ tạo được đúng 1 tài khoản, không thể dùng lại.

### UI Elements
```
- Input: email         ← THÊM MỚI — phải là email công ty có trong whitelist
- Input: username
- Input: password (type="password")
- Input: confirmPassword (type="password") — chỉ validate ở FE, không gửi lên server
- Button: "Đăng ký"
- Link: "Đã có tài khoản? Đăng nhập"
- Loading state khi đang xử lý (sinh key mất 3-5 giây)
- Error messages:
  - "Email này không được phép đăng ký" (403 — không có trong whitelist)
  - "Email này đã được dùng để đăng ký tài khoản" (409 — đã dùng rồi)
  - "Username đã tồn tại" (409 — trùng username)
  - "Password phải có ít nhất 8 ký tự" (400)
```

### Luồng xử lý khi nhấn Đăng ký
```
[FE validate trước — không gọi API nếu sai]
1. email không rỗng, đúng định dạng email
2. username: 3-20 ký tự, chỉ a-z0-9_
3. password >= 8 ký tự
4. confirmPassword === password

[Nếu validate pass — bắt đầu loading]
5. Sinh khóa cục bộ:
   "Đang sinh khóa mã hóa..." → generateIdentityKey, generateSignedPreKey, generateOneTimePreKeys(100)

6. Wrap và lưu IndexedDB:
   "Đang bảo vệ khóa..."      → deriveWrappingKey(password) + wrapPrivateKey × 102 lần
                                  + storage.savePrivateKeys()

7. Gọi API:
   "Đang tạo tài khoản..."    → POST /auth/register { username, password, email }
   Server thực hiện:
     a. Kiểm tra email trong AllowedEmail → 403 hoặc 409 nếu không hợp lệ
     b. Kiểm tra username trùng → 409 nếu đã tồn tại
     c. bcrypt.hash(password, 12)
     d. Transaction: tạo User + cập nhật AllowedEmail.usedAt = now()
     e. Trả 201

8. "Hoàn thành!" → navigate('/login')
   Hiển thị thông báo: "Đăng ký thành công! Vui lòng đăng nhập."
```

Lý do sinh khóa TRƯỚC khi gọi api.register():
- Nếu register thành công nhưng sinh khóa thất bại → tài khoản tồn tại nhưng không có key
- Sinh trước, lưu IndexedDB trước → đảm bảo key an toàn trước khi tạo tài khoản

Lý do phải qua Login thay vì vào Chat thẳng:
- Upload key cần JWT, JWT chỉ có sau khi login
- Mỗi endpoint một nhiệm vụ — register không nên tự login thay user
- Giống hành vi của hầu hết ứng dụng thực tế

### Validate (tóm tắt)
```
- email: không rỗng, đúng định dạng — để server kiểm tra whitelist
- username: không rỗng, 3-20 ký tự, chỉ a-z0-9_
- password: >= 8 ký tự
- confirmPassword: === password
- Validate phía FE trước, không gọi API nếu validate fail
```

### Sau khi thành công
```
→ navigate('/login')
→ Hiển thị thông báo: "Đăng ký thành công! Vui lòng đăng nhập."
```

Lý do phải qua Login thay vì vào Chat thẳng:
- Upload key cần JWT, JWT chỉ có sau khi login
- Mỗi endpoint một nhiệm vụ — register không nên tự login thay user
- Giống hành vi của hầu hết ứng dụng thực tế

---

## pages/Login.jsx

### Mục đích
Form đăng nhập. Khi submit: gọi API → nhận token → unwrap key từ IndexedDB → upload public key lên server.

### UI Elements
```
- Input: username
- Input: password (type="password")
- Button: "Đăng nhập"
- Link: "Chưa có tài khoản? Đăng ký"
- Error message: "Sai username hoặc password" (gộp chung như backend)
- Warning: nếu IndexedDB không có key → "Máy này chưa có dữ liệu mã hóa. 
            Vui lòng đăng ký lại hoặc dùng đúng thiết bị đã đăng ký."
```

### Luồng xử lý khi nhấn Đăng nhập
```
1. POST /auth/login { username, password } → nhận { token, userId, username }
2. Derive wrappingKey = PBKDF2(password, salt từ IndexedDB)
3. Kiểm tra IndexedDB có key không (storage.hasPrivateKeys)
   → Không có: throw lỗi, hiện warning đổi máy
4. Unwrap IK_secret, SPK_priv từ IndexedDB → đưa vào RAM
5. POST /keys/upload { ikPub, spkPub, spkSig, opkPubs } (dùng JWT vừa lấy)
   → Lần đầu đăng nhập: server tạo KeyBundle → 201 ✅
   → Lần đăng nhập tiếp theo: server trả 409 → bỏ qua, không phải lỗi ✅
   Lý do gọi mỗi lần: không biết đây là lần đầu hay lần thứ N
   → server tự quyết định qua cơ chế idempotent
6. Set state: token, userId, username, IK_secret, IK_pub, SPK_priv, wrappingKey
```

### Sau khi thành công
```
→ navigate('/chat')
```

---

## pages/Chat.jsx

### Mục đích
Layout trang chat chính. CHỈ lo bố cục và truyền props — không có logic crypto hay API call trực tiếp.

### Layout
```
┌──────────────────────────────────────────────────────────────┐
│ Sidebar (w-80, cố định)  │  Vùng chat (flex-1)             │
│                           │  ┌─ Header: tên peer + online ─┐ │
│ [Tìm user...]             │  │                              │ │
│ ──────────────            │  │   MessageList                │ │
│ [ConversationItem]        │  │   (scroll, flex-col-reverse) │ │
│ [ConversationItem]        │  │                              │ │
│ [ConversationItem]        │  └─────────────────────────────┘ │
│                           │  MessageInput                    │
└──────────────────────────────────────────────────────────────┘
```

### State quản lý trong Chat.jsx
```js
const [activeConversationId, setActiveConversationId] = useState(null);
const [activePeer, setActivePeer] = useState(null);  // { id, username }
// conversations và messages quản lý trong hooks
```

### Hooks dùng
```js
const { token, userId, IK_secret, IK_pub, wrappingKey } = useAuth();
const { onlineUsers, isConnected, onNewMessage } = useWebSocket();
const { messages, isLoading, hasMore, loadMore, addMessage } = useMessages(activeConversationId);
```

---

# PHẦN 7: COMPONENTS

## components/UnlockModal.jsx

### Mục đích
Hiển thị sau khi reload trang — user đã login (token còn trong localStorage)
nhưng wrappingKey mất khỏi RAM. Yêu cầu nhập lại password để mở khóa cục bộ.
KHÔNG phải trang login — không gọi server, không verify bcrypt.

### Khi nào hiện
```
isAuthenticated = true  (localStorage có token)
isLocked = true         (wrappingKey = null)
→ ProtectedRoute render <UnlockModal /> thay cho <Chat />
```

### Props
```js
// Không cần props — lấy mọi thứ từ useAuth()
// username lấy từ localStorage để hiển thị lời chào
// unlock(password) lấy từ AuthContext
```

### UI
```
┌────────────────────────────────────────────┐
│                                            │
│         🔒  E2EE Chat                      │
│                                            │
│   Xin chào, alice                          │
│   Nhập mật khẩu để tiếp tục               │
│                                            │
│   ┌──────────────────────────────────┐     │
│   │  ••••••••••                      │     │
│   └──────────────────────────────────┘     │
│                                            │
│   [     Mở khóa     ]                      │
│                                            │
│   Không phải bạn?  Đăng xuất              │
│                                            │
└────────────────────────────────────────────┘
Là full-screen overlay — không có nút đóng, không dismiss được bằng click ngoài
```

### Luồng xử lý khi nhấn "Mở khóa"
```
1. Lấy userId từ localStorage
2. Gọi auth.unlock(password):

   unlock(password) — trong AuthContext:
     a. record = await db.privateKeys.get(userId)
        → null: không có key trên thiết bị này → throw 'DEVICE_NOT_REGISTERED'
           hiện link "Nhập file .e2ee" thay vì ô password
     b. wrapSalt = fromBase64(record.wrapSalt)
     c. wrappingKey = await deriveWrappingKey(password, wrapSalt)
        → PBKDF2 chạy cục bộ ~0.5 giây, hiện spinner trong thời gian này
     d. keys = await storage.loadPrivateKeys(userId, wrappingKey)
        → password sai: AES-GCM throw DOMException bên trong → bắt → throw 'Sai mật khẩu'
        → trả { IK_secret, IK_pub, SPK_priv, opkMap }
        IK_pub = IK_secret.slice(32) — tính bên trong, không có field wrappedIKPub
     e. setAuth({ wrappingKey, IK_secret: keys.IK_secret, IK_pub: keys.IK_pub, SPK_priv: keys.SPK_priv })
        → isLocked tự chuyển false → ProtectedRoute re-render → <Chat /> hiển thị

3. Nếu throw 'Sai mật khẩu': hiện lỗi ngay bên dưới ô input, không xóa password

4. Nút "Đăng xuất": gọi logout() → xóa localStorage → navigate('/login')
   Dùng khi: user muốn đăng nhập bằng tài khoản khác
```

### Lưu ý bảo mật
```
- KHÔNG hiện hint password, KHÔNG có "Quên mật khẩu" — private key wrap bằng password,
  không có recovery nếu mất password (đây là đặc tính E2EE, ghi vào báo cáo)
- Modal không thể bị dismiss — bắt buộc unlock hoặc logout
- Số lần thử sai không giới hạn ở đây vì: PBKDF2 đã đủ chậm (~0.5s/lần),
  local brute force không hiệu quả hơn offline attack
```

---

## components/Sidebar.jsx

### Props
```js
{
  activeConversationId: string | null,
  onSelectConversation: (conversationId, peer) => void,
  onlineUsers: Set<string>  // userId đang online
}
```

### Tính năng
```
1. Load danh sách conversation khi mount: api.listConversations(token)
2. Hiển thị danh sách ConversationItem
3. Ô tìm kiếm user:
   - Debounce 300ms trước khi gọi api.searchUsers()
   - Hiện dropdown kết quả bên dưới input
   - Click vào user → tạo conversation mới (api.createConversation) → mở chat ngay
4. Highlight conversation đang active
5. Tự động cập nhật lastMessageAt khi có tin mới (nhận từ Chat.jsx qua callback)
```

### Sidebar KHÔNG hiển thị preview nội dung tin nhắn
```
Lý do: Server chỉ có ciphertext, không có plaintext.
       Để hiện preview cần decrypt — chỉ làm được sau khi đã load message history.
       Với đồ án, chỉ hiển thị: [username] + [lastMessageAt] là đủ và đúng.
       Đây là hệ quả đúng của mô hình Blind Server — ghi vào báo cáo.
```

---

## components/ConversationItem.jsx

### Props
```js
{
  conversation: {
    conversationId: string,
    peer: { id: string, username: string },
    fingerprintVerified: boolean,
    lastMessageAt: string  // ISO timestamp
  },
  isActive: boolean,
  isOnline: boolean,
  onClick: () => void
}
```

### UI
```
┌─────────────────────────────────┐
│ [Avatar]  Bob          12:34    │
│           ● Online              │  ← dấu chấm xanh nếu isOnline
│           🔒 Chưa xác thực      │  ← nếu !fingerprintVerified
└─────────────────────────────────┘
```

### Avatar
```
Không upload ảnh — dùng chữ cái đầu của username làm avatar.
"Bob" → hiển thị chữ "B" trên nền màu được tính từ hash của userId.
Lý do: đơn giản, không cần upload, mỗi user có màu riêng nhất quán.
```

---

## components/MessageList.jsx

### Props
```js
{
  messages: Array<{ id, senderId, plaintext, createdAt, isDecryptError }>,
  currentUserId: string,
  isLoading: boolean,
  hasMore: boolean,
  onLoadMore: () => void
}
```

### Tính năng
```
1. Scroll to bottom tự động khi có tin mới
2. Infinite scroll ngược (scroll lên → load tin cũ hơn):
   - Dùng IntersectionObserver trên element đầu tiên
   - Khi element đó vào viewport → gọi onLoadMore()
3. Giữ vị trí scroll khi prepend tin cũ (không nhảy lên đầu)
4. Loading spinner khi isLoading = true
5. "Đã tải hết tin nhắn" khi hasMore = false
```

---

## components/MessageBubble.jsx

### Props
```js
{
  message: { id, senderId, plaintext, createdAt, isDecryptError },
  isSelf: boolean  // senderId === currentUserId
}
```

### UI
```
isSelf = true:   bong bóng bên PHẢI, màu primary
isSelf = false:  bong bóng bên TRÁI, màu neutral
isDecryptError:  text màu đỏ "[Không giải mã được]"

Timestamp: hiện khi hover
```

---

## components/MessageInput.jsx

### Props
```js
{
  onSend: (plaintext: string) => Promise<void>,
  disabled: boolean,  // true khi fingerprintVerified = false
  disabledReason: string  // "Xác nhận fingerprint trước khi chat"
}
```

### Tính năng
```
- Textarea tự động tăng chiều cao theo nội dung (max 5 dòng)
- Enter gửi tin, Shift+Enter xuống dòng
- Disable + tooltip khi chưa verify fingerprint
- Loading state khi đang gửi (prevent double-send)
- Xóa nội dung sau khi gửi thành công
```

### Luồng gửi tin (quan trọng nhất)
```
onSend được định nghĩa trong Chat.jsx:

async function handleSend(plaintext) {
  // Bước 1: Lấy SK cho conversation này
  let SK = sessionKeys.get(activeConversationId);

  // Bước 2: Nếu chưa có SK → X3DH (2 trường hợp dẫn đến đây):
  //   a) Tin đầu tiên với người này (chưa bao giờ chat)
  //   b) Reload trang xảy ra GIỮA X3DH bước 2-3 lần trước
  //      (performX3DH_sender xong nhưng chưa kịp saveSession → SK mất khỏi RAM + IndexedDB)
  //   Cả 2 trường hợp xử lý giống nhau: fetch bundle mới, X3DH lại, saveSession trước khi gửi.
  //   Nếu trường hợp b): OPK cũ bị "lãng phí" 1 cái (server vẫn còn OPK khác) — chấp nhận được.
  if (!SK) {
    const bobBundle = await api.fetchKeyBundle(token, activePeer.id);
    // bobBundle trả về base64 strings → convert sang Uint8Array
    const { SK: newSK, EK_pub } = await x3dh.performX3DH_sender(myKeys, bobBundle);
    SK = newSK;
    // QUAN TRỌNG: saveSession TRƯỚC khi gửi tin lên server
    // Nếu gửi tin trước rồi mới save: tin đến Bob nhưng Alice reload thì SK mất
    // → Alice không giải mã được lịch sử của chính mình
    await storage.saveSession(activeConversationId, SK, wrappingKey);
    sessionKeys.set(activeConversationId, SK);
    // Đính kèm X3DH fields vào tin gửi
    x3dhFields = { ekPub: toBase64(EK_pub), opkId: bobBundle.opkId, ikPub: toBase64(IK_pub) };
  }

  // Bước 3: Encrypt
  const { ciphertext, iv, aad } = await aesGcm.encryptMessage(
    plaintext, SK, activeConversationId, userId
  );

  // Bước 4: Gửi qua WebSocket
  sendSocketMessage({
    type: 'message',
    conversationId: activeConversationId,
    ciphertext, iv, aad,
    ...x3dhFields  // undefined nếu không phải tin đầu
  });
}
```

---

## components/FingerprintModal.jsx

### Props
```js
{
  isOpen: boolean,
  onClose: () => void,
  onVerified: () => void,
  myIKPub: Uint8Array,
  peerIKPub: Uint8Array,
  peerUsername: string,
  conversationId: string
}
```

### UI và luồng
```
1. Tính fingerprint: generateFingerprint(myIKPub, peerIKPub) → 60 chữ số
2. Hiển thị 60 số chia thành nhóm 5 cho dễ đọc:
   12345 67890 12345 67890 ...
3. Hướng dẫn: "Đọc đây đủ các con số này cho [peerUsername] nghe qua điện thoại.
               Nếu khớp, bấm Xác nhận."
4. Nút "Xác nhận" → gọi api.verifyFingerprint(token, conversationId)
                  → gọi onVerified() → đóng modal
5. Nút "Hủy" → đóng modal, KHÔNG verify

Lưu ý: SHA-512 lặp 5200 vòng mất ~1-2 giây → hiện spinner khi tính fingerprint
```

---

# PHẦN 8: APP.JSX VÀ ROUTING

## App.jsx

```jsx
// Routing đơn giản với React Router v6

<AuthProvider>
  <Routes>
    <Route path="/register" element={<Register />} />
    <Route path="/login"    element={<Login />} />
    <Route path="/chat"     element={
      <ProtectedRoute>   {/* Redirect về /login nếu chưa auth */}
        <Chat />
      </ProtectedRoute>
    } />
    <Route path="/" element={<Navigate to="/login" />} />
  </Routes>
</AuthProvider>
```

### ProtectedRoute component
```jsx
function ProtectedRoute({ children }) {
  const { isAuthenticated, isLocked } = useAuth();

  if (!isAuthenticated) return <Navigate to="/login" replace />;  // chưa login bao giờ
  if (isLocked) return <UnlockModal />;   // đã login, reload → cần nhập lại password
  return children;                         // đã login + đã unlock → vào chat
}
```

### Hành vi khi reload trang — Unlock Modal flow
```
Trước reload:
  localStorage: token="eyJ...", userId="uuid-xx", username="alice"
  RAM:          wrappingKey=CryptoKey, IK_secret=Uint8Array, sessionKeys=Map{...}

Reload xảy ra (F5):
  localStorage: token="eyJ..." ← còn nguyên
  RAM:          wrappingKey=null, IK_secret=null, sessionKeys=Map{} ← xóa sạch

App khởi động lại:
  AuthProvider.init() đọc localStorage.token → isAuthenticated = true
                                             → wrappingKey = null → isLocked = true
  ProtectedRoute: isAuthenticated=true, isLocked=true → render <UnlockModal />

User thấy:
  Màn hình UnlockModal (full-screen overlay)
  "Xin chào, alice — Nhập mật khẩu để tiếp tục"
  [ô nhập password] [nút Mở khóa]

User nhập password đúng:
  unlock(password) chạy cục bộ — KHÔNG gọi server
    → derive wrappingKey (PBKDF2)
    → unwrap IK_secret, SPK_priv từ IndexedDB
    → set RAM state
  isLocked = false → ProtectedRoute render <Chat /> bình thường

Vào Chat.jsx:
  sidebar load GET /conversations → hiện danh sách
  user click conversation → loadSession() → unwrap SK → chat tiếp
  Tin nhắn cũ: fetch từ server → decrypt bằng SK → hiển thị đầy đủ

Dữ liệu không mất:
  localStorage: token, userId, username → còn nguyên
  IndexedDB: wrapped private keys + wrapped session keys → còn nguyên
  PostgreSQL: toàn bộ ciphertext → còn nguyên
  Chỉ mất tạm thời: wrappingKey, IK_secret (RAM) → khôi phục sau khi nhập password
  Mất vĩnh viễn: text đang gõ dở chưa gửi → không thể recover (chưa được lưu đâu)
```

---

# PHẦN 9: BIẾN MÔI TRƯỜNG

## frontend/.env
```
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
```

Tại sao dùng VITE_ prefix: Vite chỉ expose biến có prefix VITE_ ra browser.
Biến không có prefix sẽ bị giữ lại server-side (build time) — bảo mật hơn.

---

# PHẦN 10: CHECKLIST TRƯỚC KHI DEMO

## Luồng hoạt động đầy đủ (test theo thứ tự này)
```
[ ] 1. Alice đăng ký → key sinh đúng, lưu IndexedDB
[ ] 2. Bob đăng ký tương tự
[ ] 3. Alice login → unwrap key thành công, không báo lỗi
[ ] 4. Alice tìm "bob" → hiện kết quả
[ ] 5. Alice tạo conversation với Bob
[ ] 6. Alice mở FingerprintModal → 60 số hiển thị đúng
[ ] 7. Alice verify fingerprint → fingerprintVerified = true
[ ] 8. Alice gửi tin đầu tiên → X3DH chạy, tin gửi thành công
[ ] 9. Bob (tab khác) nhận tin real-time → decrypt đúng nội dung
[ ] 10. Bob reply → Alice nhận và decrypt đúng (lần này không cần X3DH)
[ ] 11. Reload trang → UnlockModal hiện (token còn localStorage, wrappingKey mất RAM)
        → nhập password → unlock cục bộ (không gọi server) → Chat load bình thường
        → click conversation → SK unwrap từ IndexedDB → lịch sử decrypt đầy đủ
[ ] 12. Logout → token bị revoke, không vào /chat được
```

## Câu hỏi giáo viên hay hỏi
```
"Private key lưu ở đâu, có an toàn không?"
→ IndexedDB, đã wrap bằng PBKDF2(600k) + AES-GCM. Server không bao giờ thấy.

"Nếu user đổi máy thì sao?"
→ Không đăng nhập được vì IndexedDB trên máy mới không có key.
  Đây là trade-off của E2EE — bảo mật tốt hơn nhưng không multi-device.
  Signal giải quyết bằng Sesame protocol — ngoài scope đồ án.

"Server có đọc được tin nhắn không?"
→ Không. Server chỉ lưu ciphertext. Decrypt xảy ra hoàn toàn ở browser.
  Dump toàn bộ PostgreSQL cũng không đọc được nội dung.

"Tại sao sidebar không hiện preview tin nhắn?"
→ Vì server không có plaintext. Preview cần decrypt, decrypt cần SK,
  SK chỉ có ở browser của đúng user. Đây là hệ quả đúng của Blind Server model.
```
