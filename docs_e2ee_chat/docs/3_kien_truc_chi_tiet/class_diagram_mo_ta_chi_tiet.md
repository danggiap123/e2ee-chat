# Kiến Trúc Chi Tiết — Mô Tả Từng Module
> Viết theo đúng code thực tế, ghi rõ tên hàm, tham số, kiểu dữ liệu

---

## Tổng Quan Quan Hệ Module

```
Register.jsx / Login.jsx / Admin.jsx
        │
        ▼
AuthContext.jsx          ← điều phối toàn bộ auth + crypto + storage
   ├── crypto/keyGen.js  ← sinh key, PBKDF2, wrap/unwrap
   ├── crypto/x3dh.js    ← X3DH sender/receiver
   ├── crypto/aesGcm.js  ← encrypt/decrypt tin nhắn VÀ file
   ├── crypto/fingerprint.js ← tính 60 chữ số fingerprint
   ├── db/storage.js     ← Dexie/IndexedDB: lưu key và session
   └── services/api.js   ← tất cả REST call (bao gồm cả admin + group + files)

Chat.jsx                 ← UI chính (1-1 + group + file)
   ├── useWebSocket.js   ← WS, nhận tin 1-1 và group, X3DH receiver
   ├── useMessages.js    ← quản lý list tin nhắn, cursor pagination (1-1 + group)
   ├── services/socket.js ← singleton WebSocket connection
   ├── components/ChatSidebar.jsx    ← tab Tin nhắn / Nhóm, icon ⚙ admin
   ├── components/GroupInfoPanel.jsx ← badge xác minh, shield icon từng member
   ├── components/FingerprintModal.jsx ← hiển thị 60 số, onConfirm callback
   ├── components/CreateGroupModal.jsx ← tìm kiếm + chọn thành viên + đặt tên
   └── components/MessageList.jsx    ← FileBubble ảnh/file inline
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

Tham số 600_000: OWASP 2023 minimum cho PBKDF2-SHA256
  → ~1 giây trên máy hiện đại → brute-force 1M password = ~1M giây
```

### `wrapPrivateKey(privKey, wrappingKey) → {wrapped:string, iv:string}`

```
Output: { wrapped: base64, iv: base64 }
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
Dùng: sodium.crypto_sign_verify_detached(SPK_sig, SPK_pub_B, IK_pub_B)
Nếu false: performX3DH_sender throw 'SPK signature invalid — possible MITM attack'
```

### `performX3DH_sender(myKeys, bobBundle) → {SK, EK_pub, OPK_id, IK_pub}`

```
Input:
  myKeys = { IK_secret: Uint8Array(64), IK_pub: Uint8Array(32) }
  bobBundle = { ikPub, spkPub, spkSig, opkPub, opkId } — từ GET /keys/{bobId}

Output: { SK: CryptoKey, EK_pub: Uint8Array(32), OPK_id: string, IK_pub: Uint8Array(32) }

Các bước:
  1. verifySignedPreKey() → throw nếu MITM
  2. EK = sodium.crypto_box_keypair()
  3. Convert Ed25519 → X25519: IK_priv, IK_pub_B_x
  4. DH1-4: 4 phép crypto_scalarmult
  5. IKM = F(0xFF×32) || DH1 || DH2 || DH3 || DH4 (160 bytes)
  6. SK = hkdf(IKM)
  7. .fill(0) tất cả DH, EK_priv, IK_priv (Forward Secrecy)
```

### `performX3DH_receiver(myKeys, initMsg) → {SK}`

```
Input:
  myKeys = { IK_secret, SPK_priv, OPK_priv } — OPK_priv đã load qua getOPK()
  initMsg = { ikPub: base64, ekPub: base64 }

4 phép DH ngược — cho ra cùng SK với sender
  Sau DH4: OPK_priv.fill(0) — OPK đã dùng xong, không bao giờ dùng lại
```

---

## Module `crypto/aesGcm.js`

### Hàm tin nhắn

```
encryptMessage(plaintext, SK, convId, senderId) → {ciphertext, iv, aad}
  AAD = "${convId}:${senderId}" — chống replay attack

decryptMessage(ctB64, ivB64, aad, SK) → string | null
  Return null khi SK/IV/AAD sai hoặc ciphertext bị sửa
```

### Hàm file (thêm mới)

```
encryptBytes(bytes, SK) → {encryptedBytes, fileIv}
  Dùng cho 1-1: mã hóa binary bằng SK conversation
  IV = random(12B), không có AAD (file không cần chống replay như tin nhắn)

encryptBytesWithRandomKey(bytes) → {encryptedBytes, fileIv, fileKey}
  Dùng cho group: sinh random 256-bit fileKey (AES-GCM)
  Mã hóa file 1 lần → upload 1 bản ciphertext cho cả nhóm
  fileKey plaintext được bọc trong message payload của từng người

decryptBytes(encryptedBytes, fileIvB64, SK) → Uint8Array
  Giải mã bằng SK conversation (1-1)

decryptBytesWithKey(encryptedBytes, fileIvB64, fileKeyB64) → Uint8Array
  Giải mã bằng fileKey từ message payload (group)
```

---

## Module `crypto/fingerprint.js`

### `generateFingerprint(IK_pub_A, IK_pub_B) → string (60 chữ số)`

```
1. lexCompare → sort canonical (Alice gọi (A,B), Bob gọi (B,A) → cùng [first, second])
2. combined = concat(first, second) → 64B
3. SHA-512 × 5200 vòng
4. BigInt(hex) % 10^60 → padStart(60, '0')

Fingerprint không đổi dù context là 1-1 hay group
→ PeerVerification global: verify 1 lần, dùng mọi nơi
```

---

## Module `db/storage.js`

**Dexie schema:**
```javascript
db.version(1).stores({
  privateKeys: 'userId',       // PK = userId
  sessions:    'conversationId', // PK = conversationId (cả 1-1 lẫn group)
})
```

### Các hàm chính

```
savePrivateKeys(userId, wrapSalt, wrappingKey, IK_secret, SPK_priv, opkList)
  Lưu: { userId, wrapSalt, wrappedIK, ivIK, wrappedSPK, ivSPK, wrappedOPKs:[{id,wrapped,iv}] }

loadPrivateKeys(userId, wrappingKey) → { IK_secret, IK_pub, SPK_priv, opkMap }
  opkMap: Map<opkId, OPK_priv Uint8Array>

hasPrivateKeys(userId) → boolean
getWrapSalt(userId) → Uint8Array

getOPK(userId, opkId, wrappingKey) → Uint8Array | null
  Chỉ unwrap 1 OPK theo id — nhanh hơn loadPrivateKeys() ~100×
  Dùng trong X3DH receiver

saveSession(conversationId, SK, wrappingKey)
  SK là CryptoKey → exportKey('raw') → rawSK → wrapPrivateKey → lưu
  rawSK.fill(0) ngay sau khi wrap

loadSession(conversationId, wrappingKey) → CryptoKey | null
deleteOPK(userId, opkId)
```

**Session key cho group:** `conversationId` được dùng với format `${groupId}:${recipientId}` (sender) hoặc `${groupId}:${senderId}` (receiver) — tách biệt hoàn toàn với SK 1-1.

---

## Module `AuthContext.jsx`

**State và ý nghĩa:**

| State | Lưu ở đâu | Mất khi nào |
|---|---|---|
| `token` | `localStorage` + React state | Logout hoặc xóa localStorage |
| `userId` | `localStorage` + React state | Logout hoặc xóa localStorage |
| `username` | `localStorage` + React state | Logout hoặc xóa localStorage |
| `role` | `localStorage` + React state | Logout hoặc xóa localStorage |
| `wrappingKey` | RAM (React state) | Reload trang |
| `IK_secret` | RAM (React state) | Reload trang |
| `IK_pub` | RAM (React state) | Reload trang |
| `SPK_priv` | RAM (React state) | Reload trang |

**`isAuthenticated = token !== null`**
**`isLocked = isAuthenticated && wrappingKey === null`**

---

## Module `useWebSocket.js`

### Stale Closure và Giải Pháp

```javascript
const wrappingKeyRef = useRef(wrappingKey);
const IK_secretRef   = useRef(IK_secret);
useEffect(() => { wrappingKeyRef.current = wrappingKey; }, [wrappingKey]);
// Handler đọc từ Ref → luôn có giá trị mới nhất
```

### `handleIncoming(msg)` — Logic nhận tin 1-1

```
1. SK = sessionKeysRef.current.get(msg.conversationId)
2. Nếu không có:
   a. msg có ekPub → X3DH init: getOPK → X3DH receiver → saveSession → deleteOPK
   b. Không có ekPub → loadSession(IndexedDB)
3. decryptMessage → plaintext → callback onNewMessage
```

### `handleGroupIncoming(msg)` — Logic nhận tin nhóm

```
SK cache key = "${groupId}:${senderId}"
Quy trình giống handleIncoming nhưng dùng key khác
X3DH receiver: lưu SK vào IndexedDB với key "${groupId}:${senderId}"
```

### Return value

```
{ onlineUsers: Set<userId>, isConnected: boolean,
  onNewMessage: callback, onNewGroupMessage: callback,
  sessionKeysRef: MutableRefObject<Map> }
```

---

## Module `useMessages.js`

### Params: `(conversationId, sessionKeysRef)` hoặc `(null, sessionKeysRef, groupId)`

```
getSK(convId): RAM → IndexedDB → ghi vào cache
fetchBatch(convId):
  - load 20 tin (newest-first từ server)
  - pre-pass tìm tin X3DH init (ekPub) trong batch → lấy SK trước
  - Promise.all decrypt song song
  - reverse() → hiển thị cũ→mới
fetchGroupBatch(groupId): SK per sender (key = "${groupId}:${senderId}")
loadMore(): cursor pagination, prepend batch cũ hơn
addMessage(msg): check trùng msgId trước khi thêm
```

---

## Backend: `ws/handler.js`

### `clients: Map<userId, WebSocket>`

```
In-memory Map — sống trong RAM Node.js process
Single-session policy: mở tab mới → đóng WS cũ, gửi {type:'session_replaced'}
safeSend(ws, data): kiểm tra readyState === OPEN trước khi send
broadcast(data, excludeUserId): duyệt Map, loại trừ người gây event
```

### Token từ query string

```
req.url.split('?token=')[1]
Tại sao: WebSocket browser không hỗ trợ custom header trong handshake
```

---

## Backend: `routes/auth.js`

### Timing Attack Protection

```javascript
const DUMMY_HASH = '$2b$12$invalidhashfortimingatk';
const isValid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
// user không tồn tại → vẫn tốn ~250ms → thời gian response như nhau
```

### Login trả thêm `role`

```javascript
jwt.sign({ userId: user.id, username: user.username, role: user.role }, secret, '7d')
return res.json({ token, userId: user.id, username: user.username, role: user.role })
```

### Register: `ADMIN_SEED_EMAIL` bypass

```javascript
const isAdminSeed = email === process.env.ADMIN_SEED_EMAIL;
// isAdminSeed = true → bỏ qua check whitelist + gán role: 'ADMIN'
// Chỉ có tác dụng lần đầu — lần sau email đã tồn tại trong DB
```

---

## Backend: `routes/admin.js` (MỚI)

### Bảo vệ: JWT middleware + kiểm tra `role === 'ADMIN'`

### 7 Endpoint

```
GET  /admin/users              → danh sách tất cả user (id, username, email, role, isActive)
PATCH /admin/users/:id/disable → isActive=false (chặn tự disable mình)
PATCH /admin/users/:id/enable  → isActive=true
PATCH /admin/users/:id/grant-admin  → role=ADMIN
PATCH /admin/users/:id/revoke-admin → role=USER
  ├── Chặn tự revoke mình
  ├── $transaction + SELECT COUNT(*) FOR UPDATE (PostgreSQL row lock)
  └── Từ chối nếu đây là admin cuối cùng

GET    /admin/whitelist      → danh sách AllowedEmail
POST   /admin/whitelist      → thêm email
DELETE /admin/whitelist/:id  → xóa email
```

### Race Condition Protection (revoke-admin)

```javascript
// prisma.$transaction đảm bảo atomicity
// FOR UPDATE: lock row → request thứ 2 phải đợi request thứ 1 commit
// Sau khi thứ 1 commit, thứ 2 đọc lại → thấy count=1 → bị từ chối
await prisma.$executeRaw`SELECT id FROM "User" WHERE role='ADMIN' FOR UPDATE`;
const adminCount = await tx.user.count({ where: { role: 'ADMIN' } });
if (adminCount <= 1) return res.status(400).json({ error: 'Không thể thu hồi...' });
```

---

## Backend: `routes/groups.js` (MỚI)

```
POST   /groups                    → tạo nhóm (tạo Group + thêm creator vào GroupMember)
GET    /groups                    → danh sách nhóm của user (join GroupMember)
GET    /groups/:id/members        → danh sách thành viên kèm ikPub + isVerifiedByMe
                                    (join KeyBundle + PeerVerification)
POST   /groups/:id/members        → thêm thành viên (admin nhóm only)
DELETE /groups/:id/members/:userId → xóa thành viên (admin nhóm only)
```

### `GET /groups/:id/members` — Join PeerVerification

```javascript
members.map(m => ({
  ...m,
  isVerifiedByMe: m.id === myId
    ? null  // bản thân mình → không có trạng thái
    : verificationMap.has(m.id)  // có bản ghi PeerVerification không?
}))
```

---

## Backend: `routes/peers.js` (MỚI)

```
PATCH /peers/:peerId/verify → idempotent upsert PeerVerification
  ├── Chặn tự verify mình
  ├── Check peer tồn tại
  └── prisma.peerVerification.upsert({ where: {verifierId_peerId} })
```

---

## Backend: `routes/files.js` (MỚI)

```
POST /files/upload  → multer memoryStorage, max 10MB
  ├── ghi disk tại uploads/{uuid} (không có extension)
  ├── INSERT UploadedFile (uploaderId)
  └── return { fileId }

GET  /files/:fileId → trả encrypted bytes (application/octet-stream)
  ├── verify JWT (requireAuth)
  └── res.sendFile(path)
```

---

## Backend: `middleware/auth.js`

### Check `isActive` sau verify JWT

```javascript
const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
if (!user || !user.isActive) {
  return res.status(401).json({ error: 'Tài khoản đã bị vô hiệu hóa' });
}
req.user = { ...decoded, isActive: user.isActive };
```

---

## Frontend: `pages/Admin.jsx` (MỚI)

### 2 Tab

```
Tab "Người dùng":
  - Bảng: username, email, badge role (ADMIN/USER), trạng thái (Active/Disabled)
  - Nút: Vô hiệu hóa / Kích hoạt (disabled nếu là bản thân)
  - Nút: Cấp Admin / Thu hồi Admin (disabled nếu là bản thân)
  - Dùng JWT từ AuthContext — không có màn hình nhập secret riêng

Tab "Whitelist Email":
  - Form thêm email
  - Danh sách: email, ngày thêm, ngày dùng (null = chưa dùng), nút Xóa

Nút "Vào Chat": navigate('/chat') — SPA, không reload → wrappingKey vẫn trong RAM
```

---

## Frontend: `components/ChatSidebar.jsx`

### Tab Tin nhắn / Nhóm + Icon Admin

```
Props: role (từ useAuth())
Kết cấu:
  - Nút tạo nhóm (dấu +) trong tab Nhóm → CreateGroupModal
  - Tab "Tin nhắn": danh sách ConversationItem với search debounce 400ms
  - Tab "Nhóm": danh sách GroupItem
  - Icon ⚙ trong header (CHỈ hiện nếu role === 'ADMIN') → navigate('/admin')
    SPA navigation → wrappingKey không bị mất khỏi RAM
```

---

## Frontend: `components/GroupInfoPanel.jsx` (MỚI)

```
Props: group, myIKPub, onMemberVerified(peerId)
State: fingerprintTarget (member đang mở FingerprintModal)

Danh sách thành viên với shield icon:
  - Xanh lá (isVerifiedByMe=true): đã verify
  - Xám (isVerifiedByMe=false, ikPub có): click được → mở FingerprintModal
  - Xám nhạt disabled (ikPub null): chưa upload key, không verify được

FingerprintModal:
  onConfirm={() => api.verifyPeer(token, member.id)}
  Sau verify: onMemberVerified(member.id) → Chat.jsx cập nhật state → badge header đổi màu
```

---

## Frontend: `components/FingerprintModal.jsx` (Refactored)

### Thay đổi so với phiên bản cũ

```
Trước: nhận prop (token, conversationId) → tự gọi api.verifyFingerprint()
Sau:   nhận prop onConfirm: async () => void → caller tự quyết gọi API nào

Lý do: tái sử dụng được cho cả 1-1 và group
  1-1:   onConfirm={() => api.verifyFingerprint(token, convId)}
  Group: onConfirm={() => api.verifyPeer(token, member.id)}
```

---

## Frontend: `components/MessageList.jsx` — FileBubble

```
parsePlaintext(text):
  TRY JSON.parse(text) → { type: 'file' | 'image', fileId, fileName, ... }
  CATCH → text thường (backward-compatible với tin nhắn cũ)

FileBubble component:
  Image: tự tải qua handleDownloadFile(), hiển thị inline, click mở toàn màn hình
  File:  icon + tên + dung lượng + click tải xuống (spinner khi đang decrypt)
```

---

## Frontend: `components/MessageInput.jsx`

### Clipboard Paste

```javascript
onPaste(e):
  const item = e.clipboardData.items — tìm item.type.startsWith('image/')
  Nếu có: e.preventDefault() → item.getAsFile() → handleSendFile(file)
  Nếu không: text paste hoạt động bình thường (không preventDefault)
```

### Auto-focus sau gửi

```javascript
useEffect(() => {
  if (!isSending) textareaRef.current?.focus();
}, [isSending]);
```
