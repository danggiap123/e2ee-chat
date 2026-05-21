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
Mục đích: Sinh X25519 keypair vĩnh viễn — đại diện danh tính của user
Input: không có
Output: { IK_pub: Uint8Array, IK_priv: Uint8Array }
Thư viện: sodium.crypto_box_keypair()
Ghi chú: Chỉ gọi 1 lần duy nhất khi đăng ký. Không bao giờ gọi lại.
```

#### `generateSignedPreKey(IK_priv)`
```
Mục đích: Sinh SPK và ký bằng IK để server không giả mạo được
Input: IK_priv (Uint8Array)
Output: { SPK_pub: Uint8Array, SPK_priv: Uint8Array, SPK_sig: Uint8Array }
Thư viện: sodium.crypto_box_keypair() + sodium.crypto_sign_detached()
Ghi chú: SPK_sig = Ed25519.sign(IK_priv, SPK_pub)
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

#### `wrapPrivateKey(privKey, password)`
```
Mục đích: Bảo vệ private key bằng password trước khi lưu IndexedDB
Input:
  - privKey (Uint8Array): private key cần bảo vệ
  - password (string): mật khẩu người dùng nhập
Output: { wrapped: string (base64), salt: string (base64), iv: string (base64) }
Thư viện: Web Crypto API

Chi tiết từng bước:
  salt = crypto.getRandomValues(new Uint8Array(16))
  iv   = crypto.getRandomValues(new Uint8Array(12))
  keyMaterial = await crypto.subtle.importKey('raw', encode(password), 'PBKDF2', false, ['deriveKey'])
  wrappingKey  = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )
  wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, privKey)
  return { wrapped: toBase64(wrapped), salt: toBase64(salt), iv: toBase64(iv) }

Nếu bỏ hàm này: private key lưu dạng plaintext trong IndexedDB → ai truy cập máy là lấy được key
```

#### `unwrapPrivateKey(wrapped, salt, iv, password)`
```
Mục đích: Giải mã private key từ IndexedDB khi user login
Input:
  - wrapped (string base64): private key đã mã hóa
  - salt (string base64): salt dùng khi wrap
  - iv (string base64): iv dùng khi wrap
  - password (string): mật khẩu người dùng nhập
Output: Uint8Array (private key gốc)
Thư viện: Web Crypto API — ngược lại với wrapPrivateKey

Lưu ý: Nếu password sai → crypto.subtle.decrypt throw error → bắt lỗi và hiển thị "Sai mật khẩu"
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
    IK_priv: Uint8Array,   // Identity Key private của Alice
    IK_pub:  Uint8Array    // Identity Key public của Alice (dùng để gửi cho Bob)
  }
  bobBundle: {
    IK_pub:  Uint8Array,   // từ GET /keys/:bobId
    SPK_pub: Uint8Array,
    SPK_sig: Uint8Array,
    OPK_pub: Uint8Array,
    OPK_id:  string
  }
Output: {
  SK:     CryptoKey,    // Session Key 32 bytes — dùng để AES-GCM encrypt
  EK_pub: Uint8Array    // Ephemeral Key public — gửi cho Bob để Bob tính lại SK
}

Chi tiết 4 phép DH:
  EK = sodium.crypto_box_keypair()  ← sinh ephemeral key, dùng 1 lần duy nhất
  DH1 = sodium.crypto_scalarmult(IK_priv_A,  SPK_pub_B)  ← mutual auth
  DH2 = sodium.crypto_scalarmult(EK_priv_A,  IK_pub_B)   ← mutual auth
  DH3 = sodium.crypto_scalarmult(EK_priv_A,  SPK_pub_B)  ← forward secrecy
  DH4 = sodium.crypto_scalarmult(EK_priv_A,  OPK_pub_B)  ← forward secrecy

  F   = new Uint8Array(32).fill(0xFF)
  IKM = concat(F, DH1, DH2, DH3, DH4)  ← 160 bytes

  SK  = HKDF-SHA256(IKM, salt=0x00×32, info="E2EEChat_v1", length=32)
  SK nhập vào Web Crypto dưới dạng CryptoKey với usage ['encrypt', 'decrypt']

SAU KHI TÍNH XONG: EK_priv, DH1, DH2, DH3, DH4 = null  ← BẮT BUỘC xóa ngay
Nếu không xóa: vi phạm Forward Secrecy — ai lấy được bộ nhớ sau này vẫn tính lại được SK
```

#### `performX3DH_receiver(myKeys, initMsg)`
```
Mục đích: Bob tính lại SK từ tin nhắn đầu tiên Alice gửi
Input:
  myKeys: {
    IK_priv:  Uint8Array,
    SPK_priv: Uint8Array,
    OPK_privs: Map<string, Uint8Array>  // map từ OPK_id → OPK_priv
  }
  initMsg: {
    IK_pub_A: Uint8Array,   // từ trường ikPub trong Message
    EK_pub_A: Uint8Array,   // từ trường ekPub trong Message
    OPK_id:   string        // từ trường opkId trong Message
  }
Output: { SK: CryptoKey }  // cùng SK với Alice nếu tất cả đúng

Chi tiết (chiều ngược):
  DH1 = sodium.crypto_scalarmult(SPK_priv_B,    IK_pub_A)
  DH2 = sodium.crypto_scalarmult(IK_priv_B,     EK_pub_A)
  DH3 = sodium.crypto_scalarmult(SPK_priv_B,    EK_pub_A)
  DH4 = sodium.crypto_scalarmult(OPK_priv_B[OPK_id], EK_pub_A)
  (HKDF giống hệt bên sender)

SAU KHI TÍNH XONG: xóa OPK_priv_B[OPK_id] khỏi storage — đã dùng rồi, không dùng lại
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
  // Lưu: { userId, wrappedIK, saltIK, ivIK, wrappedSPK, saltSPK, ivSPK, wrappedOPKs[] }
  // wrappedOPKs: [{ id, wrapped, salt, iv }]

  sessions: 'conversationId',
  // Lưu: { conversationId, wrappedSK, saltSK, ivSK }
  // wrappedSK = AES-GCM encrypt(SK, wrappingKey) — SK không bao giờ lưu dạng plaintext
});
```

### Các hàm cần export

#### `savePrivateKeys(userId, keys)`
```
Mục đích: Lưu private key đã wrap sau khi đăng ký
Input:
  userId (string)
  keys: {
    wrappedIK, saltIK, ivIK,         // Identity Key đã wrap
    wrappedSPK, saltSPK, ivSPK,      // Signed PreKey đã wrap
    wrappedOPKs: [{ id, wrapped, salt, iv }]  // 100 OPK đã wrap
  }
Output: Promise<void>
```

#### `loadPrivateKeys(userId)`
```
Output: object như trên hoặc null nếu chưa có
```

#### `saveSession(conversationId, wrappedSK, saltSK, ivSK)`
```
Mục đích: Lưu Session Key đã wrap sau khi X3DH xong
Lý do cần lưu: Reload trang thì SK trong RAM mất — cần unwrap lại từ IndexedDB
```

#### `loadSession(conversationId)`
```
Output: { wrappedSK, saltSK, ivSK } hoặc null nếu chưa có session
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
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
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
{
  token: string | null,        // JWT — lưu trong RAM, KHÔNG localStorage
  userId: string | null,       // UUID của user hiện tại
  username: string | null,     // username để hiển thị
  IK_priv: Uint8Array | null,  // Identity Key private — trong RAM sau khi unwrap
  IK_pub: Uint8Array | null,   // Identity Key public
  SPK_priv: Uint8Array | null, // Signed PreKey private
  wrappingKey: CryptoKey | null // PBKDF2 derived key — dùng để wrap/unwrap các key khác
                                // QUAN TRỌNG: lưu wrappingKey thay vì password
                                // vì không bao giờ lưu plaintext password trong memory lâu
}
```

### Các hàm expose qua context
```js
register(username, password)
  // 1. Gọi api.register(username, password)
  // 2. Sinh IK, SPK, 100 OPK qua keyGen.js
  // 3. Derive wrappingKey = PBKDF2(password)
  // 4. Wrap từng private key qua keyGen.wrapPrivateKey()
  // 5. Lưu tất cả wrapped key vào IndexedDB qua storage.savePrivateKeys()
  // 6. Gọi api.uploadKeys() với public keys
  // 7. Gọi api.login() để lấy token
  // 8. Set state: token, userId, username, IK_priv, IK_pub, SPK_priv, wrappingKey

login(username, password)
  // 1. Gọi api.login() → { token, userId, username }
  // 2. Derive wrappingKey = PBKDF2(password, salt từ IndexedDB)
  // 3. Load wrapped keys từ IndexedDB qua storage.loadPrivateKeys()
  // 4. Unwrap từng key qua keyGen.unwrapPrivateKey()
  // 5. Load tất cả session (SK) từ IndexedDB, unwrap bằng wrappingKey
  // 6. Set state đầy đủ
  // Lỗi password sai: unwrap throw error → bắt và throw 'Sai mật khẩu'

logout()
  // 1. Gọi api.logout(token)
  // 2. Ngắt WebSocket: disconnectSocket()
  // 3. Xóa toàn bộ state (token, keys về null)
  // KHÔNG xóa IndexedDB — key vẫn còn đó, lần sau login lại unwrap được

isAuthenticated: boolean  // = token !== null
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
  // Lấy token, userId, IK_priv, wrappingKey từ useAuth()
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
Form đăng ký. Khi submit: sinh key → wrap → lưu IndexedDB → upload public key → login.

### UI Elements
```
- Input: username
- Input: password (type="password")
- Input: confirmPassword (type="password") — chỉ validate ở FE, không gửi lên server
- Button: "Đăng ký"
- Link: "Đã có tài khoản? Đăng nhập"
- Loading state khi đang xử lý (sinh key mất 2-3 giây)
- Error message nếu username đã tồn tại hoặc password < 8 ký tự
```

### Loading states chi tiết
```
"Đang tạo tài khoản..."   → gọi api.register()
"Đang sinh khóa mã hóa..." → generateIdentityKey, generateSignedPreKey, generateOneTimePreKeys
"Đang bảo vệ khóa..."      → wrapPrivateKey × 102 lần (IK + SPK + 100 OPK)
"Hoàn tất..."              → uploadKeys + login
```

Lý do cần loading states rõ ràng: sinh 100 OPK + wrap 102 key mất 3-5 giây.
Không có loading state → user tưởng app bị đơ, bấm lại nhiều lần.

### Validate
```
- username: không rỗng, 3-20 ký tự, chỉ a-z0-9_
- password: >= 8 ký tự
- confirmPassword: === password
- Validate phía FE trước, không gọi API nếu validate fail
```

### Sau khi thành công
```
→ navigate('/chat') — không cần qua Login vì đã login ngay sau register
```

---

## pages/Login.jsx

### Mục đích
Form đăng nhập. Khi submit: gọi API → nhận token → unwrap key từ IndexedDB.

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
const { token, userId, IK_priv, wrappingKey } = useAuth();
const { onlineUsers, isConnected, onNewMessage } = useWebSocket();
const { messages, isLoading, hasMore, loadMore, addMessage } = useMessages(activeConversationId);
```

---

# PHẦN 7: COMPONENTS

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

  // Bước 2: Nếu chưa có SK → đây là tin đầu tiên → X3DH
  if (!SK) {
    const bobBundle = await api.fetchKeyBundle(token, activePeer.id);
    // bobBundle trả về base64 strings → convert sang Uint8Array
    const { SK: newSK, EK_pub } = await x3dh.performX3DH_sender(myKeys, bobBundle);
    SK = newSK;
    // Lưu SK
    const wrapped = await keyGen.wrapPrivateKey(SK_bytes, wrappingKey);
    await storage.saveSession(activeConversationId, wrapped.wrapped, wrapped.salt, wrapped.iv);
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
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}
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
[ ] 11. Reload trang → load lịch sử, decrypt lại từ IndexedDB SK
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
