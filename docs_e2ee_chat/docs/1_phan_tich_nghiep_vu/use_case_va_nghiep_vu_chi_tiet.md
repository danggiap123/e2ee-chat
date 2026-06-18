# Phân Tích Nghiệp Vụ — E2EE Chat
> Toàn bộ nội dung viết theo đúng code thực tế đã đọc

---

## Use Case Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Hệ thống E2EE Chat                               │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ «Xác thực»                                                        │   │
│  │   UC-01 Đăng ký       UC-02 Đăng nhập      UC-03 Đăng xuất      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ «Quản lý khóa» (upload KEY xảy ra tại LOGIN, không phải register)│   │
│  │   UC-04 Upload key bundle      UC-05 Lấy key bundle người khác   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ «Chat 1-1 E2EE»                                                   │   │
│  │   UC-07 Tạo conversation 1-1   UC-08 Gửi tin X3DH                │   │
│  │   UC-09 Gửi tin AES-GCM        UC-10 Verify fingerprint 1-1      │   │
│  │   UC-11 Tải lịch sử            UC-12 Gửi file/ảnh E2EE (1-1)    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ «Chat nhóm E2EE»                                                  │   │
│  │   UC-13 Tạo nhóm               UC-14 Thêm/xóa thành viên        │   │
│  │   UC-15 Gửi tin nhóm (N bản mã song song)                        │   │
│  │   UC-16 Verify fingerprint thành viên nhóm (PeerVerification)    │   │
│  │   UC-17 Gửi file/ảnh E2EE (group — random fileKey)               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ «Quản lý thiết bị»                                                │   │
│  │   UC-18 Export .e2ee           UC-19 Import .e2ee                 │   │
│  │   UC-20 Unlock sau reload      (wrappingKey mất khỏi RAM)        │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ «Admin — Quản trị hệ thống»                                       │   │
│  │   UC-21 Quản lý danh sách email whitelist                         │   │
│  │   UC-22 Vô hiệu hóa / kích hoạt lại người dùng                   │   │
│  │   UC-23 Cấp / thu hồi quyền ADMIN                                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
          ▲                                              ▲
    Người dùng                                       Admin
   (Alice / Bob)                          (role=ADMIN hoặc ADMIN_SEED_EMAIL)
```

---

## Ca Nghiệp Vụ Chi Tiết

---

### UC-01: Đăng Ký Tài Khoản

**File thực thi:** `Register.jsx` → `AuthContext.register()` → `api.register()`

| Thuộc tính | Nội dung |
|---|---|
| **Tác nhân** | User chưa có tài khoản |
| **Điều kiện tiên quyết** | Email có trong bảng `AllowedEmail` (Admin thêm trước), hoặc email = `ADMIN_SEED_EMAIL` |
| **Kết quả** | User tạo trên server, private key lưu IndexedDB, **redirect về /login** |

**Luồng chính (đúng theo AuthContext.register):**

1. User nhập `username`, `email`, `password`, `confirm password`
2. Frontend validate: `password === confirm`, `password.length >= 8`
3. `AuthContext.register()` chạy — **4 bước tuần tự:**
   - `generateIdentityKey()` → `{IK_pub, IK_secret}` (Ed25519, 32B+64B)
   - `generateSignedPreKey(IK_secret)` → `{SPK_pub, SPK_priv, SPK_sig}` (X25519+sig)
   - `generateOneTimePreKeys(100)` → array `[{id:UUID, OPK_pub, OPK_priv}]`
   - `wrapSalt = crypto.getRandomValues(16B)`, `wKey = deriveWrappingKey(password, wrapSalt)` (PBKDF2, 600k vòng)
4. `api.register(username, password, email)` → `POST /auth/register` → server trả `{userId, message}`
   - Server kiểm tra email trong `AllowedEmail` → 403 nếu không có
   - **Exception:** nếu `email === ADMIN_SEED_EMAIL` → bypass whitelist + gán `role: ADMIN`
   - **KHÔNG có token trong response** — đây là điểm khác với luồng đăng nhập
5. `storage.savePrivateKeys(userId, wrapSalt, wKey, IK_secret, SPK_priv, opkList)` → lưu IndexedDB
6. `Register.jsx` nhận `resolve()` → `setSuccess(true)` → `setTimeout(() => navigate('/login'), 2500)`
   - **Bắt buộc phải đăng nhập thủ công sau đăng ký — KHÔNG tự động vào chat**

**Điểm quan trọng:**
- `api.register()` chỉ tạo user, **KHÔNG upload key** — upload key xảy ra ở `login()`
- Server không bao giờ thấy private key — chỉ nhận `{username, email, password}`
- Private key lưu IndexedDB dưới dạng ciphertext (wrapped bằng `wrappingKey`)
- `ADMIN_SEED_EMAIL` chỉ có tác dụng 1 lần — sau khi đăng ký, email đó tồn tại trong DB nên lần sau bị từ chối

---

### UC-02: Đăng Nhập

**File thực thi:** `Login.jsx` → `AuthContext.login()` → `api.login()`, `api.uploadKeys()`

| Thuộc tính | Nội dung |
|---|---|
| **Tác nhân** | User đã đăng ký, thiết bị đã có IndexedDB |
| **Kết quả** | JWT lưu localStorage, role lưu localStorage, private key vào RAM, key bundle upload, navigate('/chat') |

**Luồng chính (đúng theo AuthContext.login):**

1. User nhập `username`, `password`
2. `api.login(username, password)` → `POST /auth/login` → nhận `{token, userId, username, role}`
   - Server kiểm tra `isActive === true` → 401 nếu bị vô hiệu hóa
   - **JWT được sinh tại đây** — không phải đăng ký
   - Server: `bcrypt.compare(password, hash)` → `jwt.sign({userId, username, role}, secret, 7d)`
3. `storage.hasPrivateKeys(userId)` — nếu `false` → throw `DEVICE_NOT_REGISTERED`
   - `Login.jsx` bắt lỗi này → hiển thị: "Hãy dùng thiết bị gốc hoặc xuất file .e2ee"
4. `storage.getWrapSalt(userId)` → đọc `wrapSalt` từ IndexedDB
5. `deriveWrappingKey(password, wrapSalt)` → `wKey` (PBKDF2 600k vòng, ~1 giây)
6. `storage.loadPrivateKeys(userId, wKey)` → unwrap toàn bộ `IK_secret`, `SPK_priv`, `opkMap`
   - Password sai → `AES-GCM.decrypt` throw → hiển thị "Sai mật khẩu"
7. Tính lại public keys từ private key (deterministic):
   - `SPK_pub = sodium.crypto_scalarmult_base(keys.SPK_priv)`
   - `spkSig = sodium.crypto_sign_detached(SPK_pub, keys.IK_secret)`
   - `opkPubs = [...keys.opkMap.entries()].map(([id, priv]) => ({id, pub: toBase64(crypto_scalarmult_base(priv))}))`
8. `api.uploadKeys(token, {ikPub, spkPub, spkSig, opkPubs})` → `POST /keys/upload`
   - Nếu server trả `409` (bundle đã tồn tại) → **bỏ qua, không phải lỗi**
9. Lưu `token, userId, username, role` vào `localStorage`
10. Set RAM state: `setWrappingKey(wKey)`, `setIKSecret(...)`, `setIKPub(...)`, `setSPKPriv(...)`, `setRole(role)`
11. `isAuthenticated = true` → navigate('/chat')

---

### UC-03: Đăng Xuất

**File thực thi:** `AuthContext.logout()` → `api.logout()`

**Luồng:**
1. `api.logout(token)` → `POST /auth/logout` → server: `redis.set("blocklist:{token}", "1", EX, ttl)`
2. Xóa `localStorage`: `token`, `userId`, `username`, `role`
3. Set toàn bộ state về `null`: `token`, `userId`, `username`, `role`, `wrappingKey`, `IK_secret`, `IK_pub`, `SPK_priv`
4. **KHÔNG xóa IndexedDB** — wrapped private key vẫn còn, login lại vẫn dùng được

---

### UC-20: Unlock Sau Reload

**File thực thi:** `AuthContext.unlock()` — UC đặc biệt, không có trong hệ thống chat thông thường

**Bài toán:** Sau reload trang, `localStorage` còn `token/userId` nhưng RAM state (`wrappingKey`, `IK_secret`...) bị xóa. Lúc này `isLocked = true`.

**Luồng:**
1. `App.jsx` phát hiện `isAuthenticated = true` nhưng `isLocked = true` → hiện `UnlockModal`
2. User nhập password vào `UnlockModal`
3. `unlock(password)`:
   - `getWrapSalt(userId)` từ IndexedDB
   - `deriveWrappingKey(password, wrapSalt)` (PBKDF2 600k, ~1 giây)
   - `loadPrivateKeys(userId, wKey)` → unwrap keys
   - Set RAM state → `isLocked = false` → UI tự render lại sang Chat
4. **Không gọi server, không cần mạng** — hoàn toàn local

---

### UC-08: Gửi Tin Nhắn Đầu Tiên (X3DH — 1-1)

**File thực thi:** `Chat.jsx (getOrCreateSK)` → `x3dh.performX3DH_sender()` → `aesGcm.encryptMessage()` → WS

**Điều kiện:** `fingerprintVerified = true` (MessageInput bị disabled nếu false)

**Luồng:**
1. Alice bấm Gửi
2. `getOrCreateSK(convId, peerId)`: check RAM → check IndexedDB → không có → thực hiện X3DH
3. `api.fetchKeyBundle(token, bobId)` → `GET /keys/{bobId}` → server **pop 1 OPK** → trả `{ikPub, spkPub, spkSig, opkPub, opkId}`
4. `performX3DH_sender({IK_secret, IK_pub}, bobBundle)`:
   - `verifySignedPreKey(IK_pub_B, spkSig, spkPub)` — throw nếu MITM
   - `EK = sodium.crypto_box_keypair()` — ephemeral key 1 lần
   - Convert Ed25519 → X25519: `IK_priv`, `IK_pub_B_x`
   - `DH1..DH4` → `IKM = F(0xFF×32) || DH1 || DH2 || DH3 || DH4`
   - `SK = HKDF-SHA256(IKM)` (AES-256-GCM key)
   - `.fill(0)` tất cả DH values, `EK.privateKey`, `IK_priv` (X25519 variant)
   - Return `{SK, EK_pub, OPK_id, IK_pub}`
5. `storage.saveSession(convId, SK, wrappingKey)` → wrap SK → IndexedDB
6. `encryptMessage(plaintext, SK, convId, senderId)`:
   - `IV = crypto.getRandomValues(12B)`
   - `AAD = "{convId}:{senderId}"`
   - `ciphertext = AES-256-GCM.encrypt(plaintext, SK, IV, AAD)`
7. Gửi qua WS: `{type:'message', conversationId, ciphertext, iv, aad, ekPub, opkId, ikPub}`
8. Server: `INSERT Message` → relay cho Bob nếu online

**Phía Bob nhận:**
1. Bob nhận WS message có `ekPub, opkId, ikPub` → biết đây là X3DH init message
2. `storage.getOPK(userId, opkId, wrappingKey)` → lấy đúng 1 OPK
3. `performX3DH_receiver({IK_secret, SPK_priv, OPK_priv}, initMsg)` → cùng SK
4. `storage.saveSession(convId, SK, wrappingKey)`, `storage.deleteOPK(userId, opkId)`
5. `aesGcm.decryptMessage(ciphertext, iv, aad, SK)` → plaintext

---

### UC-10: Verify Fingerprint 1-1

**File thực thi:** `FingerprintModal.jsx` → `fingerprint.generateFingerprint()` → `api.verifyFingerprint()`

**Luồng:**
1. Alice và Bob mỗi người mở `FingerprintModal`
2. `generateFingerprint(IK_pub_A, IK_pub_B)`:
   - `lexCompare` → sort canonical (cả 2 bên ra cùng thứ tự)
   - `hash = SHA-512(combined)`, lặp thêm 5199 lần
   - `digits = (BigInt(hex) % 10n**60n).toString().padStart(60,'0')`
3. Alice đọc 60 chữ số qua kênh ngoài (điện thoại), Bob so sánh
4. Khớp → `api.verifyFingerprint(token, convId)` → `PATCH /conversations/{convId}/fingerprint`
5. Server: dùng `$transaction` ghi đồng thời vào cả `Conversation.fingerprintVerified = true` **và** bảng `PeerVerification` (A→B)
6. MessageInput được bật (`disabled={!fingerprintVerified}`)

**Điểm quan trọng:** Verify 1-1 tự động cập nhật `PeerVerification` → badge nhóm tự xanh ở mọi nhóm có cùng người

---

### UC-15: Gửi Tin Nhắn Nhóm (N Bản Mã Song Song)

**File thực thi:** `Chat.jsx (handleSendGroup)` → `getOrCreateGroupSK()` → `encryptMessage()` × N → `api.sendGroupMessage()`

**Đặc điểm kiến trúc:** Không dùng Sender Keys — mỗi người nhận có 1 bản ciphertext riêng, mã hóa bằng SK 1-1 với người gửi.

**Luồng gửi:**
1. Alice chọn nhóm, nhập tin, bấm Gửi
2. `handleSendGroup(text, groupId)`:
   - Lấy danh sách thành viên (trừ bản thân)
   - Với mỗi member B: `getOrCreateGroupSK(groupId, B.id)` → SK riêng (Alice-Bob, Alice-Carol...)
   - Mỗi SK cache với key = `${groupId}:${B.id}` (tách biệt với SK 1-1)
3. `encryptMessage(text, SK_AB, groupId, aliceId)`:
   - `AAD = "${groupId}:${aliceId}"` — chống tamper, nhất quán sender/receiver
4. `api.sendGroupMessage(token, groupId, [{recipientId, ciphertext, iv, aad, ekPub?, opkId?, ikPub?}])`
5. Server `POST /messages`: với mỗi phần tử → `INSERT Message (groupId, recipientId, ...)` + relay WS đến từng người

**Luồng nhận:**
1. Bob nhận WS `{type:'group_message', groupId, senderId, ...}`
2. `handleGroupIncoming`: SK cache key = `${groupId}:${senderId}`
3. Nếu là X3DH init → X3DH receiver → lưu SK với key `${groupId}:${senderId}`
4. Decrypt → hiển thị tin

---

### UC-12 / UC-17: Gửi File & Ảnh E2EE

**File thực thi:** `MessageInput.jsx (file input / paste)` → `Chat.jsx (handleSendFile / handleSendGroupFile)` → `api.uploadFile()`

#### 1-1 (UC-12)

1. User chọn file hoặc dán ảnh từ clipboard (Ctrl+V)
2. `handleSendFile(file)`:
   - `getOrCreateSK(convId, peerId)` → lấy SK như gửi tin thường
   - `encryptBytes(fileBytes, SK)` → `{encryptedBytes, fileIv}` (AES-256-GCM)
   - `api.uploadFile(token, encryptedBytes)` → `POST /files/upload` → server lưu disk, trả `fileId`
   - Tạo payload JSON: `{type, fileId, fileName, mimeType, fileSize, fileIv}`
   - `encryptMessage(JSON.stringify(payload), SK, convId, senderId)` → gửi qua WS như tin thường
3. **Server chỉ thấy encrypted bytes — không biết loại file hay nội dung**

#### Group (UC-17)

1. `handleSendGroupFile(file)`:
   - `encryptBytesWithRandomKey(fileBytes)` → `{encryptedBytes, fileIv, fileKey}` (random 256-bit AES key)
   - Upload 1 lần: `api.uploadFile(token, encryptedBytes)` → `fileId`
   - Với mỗi thành viên: tạo payload `{type, fileId, fileKey, fileIv, fileName, ...}` → mã hóa bằng SK riêng
   - **Chỉ upload 1 bản ciphertext, tiết kiệm băng thông N×**
   - `fileKey` (plaintext) được bọc trong message payload → server không thể đọc key

**Tải về:**
1. `handleDownloadFile(fileInfo, senderId)`:
   - `api.downloadFile(token, fileId)` → `GET /files/{fileId}` → trả encrypted bytes
   - 1-1: `decryptBytes(bytes, fileIv, SK)` — dùng SK conversation
   - Group: `decryptBytesWithKey(bytes, fileIv, fileKey)` — dùng fileKey từ message payload
   - Tạo Blob URL → hiển thị ảnh inline hoặc kích hoạt download

---

### UC-16: Verify Fingerprint Thành Viên Nhóm (PeerVerification)

**File thực thi:** `Chat.jsx` → `GroupInfoPanel.jsx` → `FingerprintModal.jsx` → `api.verifyPeer()`

**Thiết kế:** Verification là **toàn cục** — verify Bob 1 lần → xanh ở mọi nhóm có Bob (không cần verify lại từng nhóm).

**Luồng:**
1. Alice chọn nhóm → header badge hiện `"E2EE · X/Y đã xác minh"` (amber) hoặc `"Tất cả đã xác minh"` (green)
2. Click badge → mở `GroupInfoPanel` — danh sách thành viên với shield icon
3. Shield icon trạng thái:
   - Xanh lá: đã verify (`isVerifiedByMe = true`)
   - Xám (clickable): chưa verify
   - Xám nhạt disabled: member chưa upload key (không có `ikPub`)
4. Click shield xám → `FingerprintModal` mở với `onConfirm={() => api.verifyPeer(token, member.id)}`
5. So sánh 60 chữ số qua kênh ngoài → "Xác nhận" → `PATCH /peers/:peerId/verify`
6. Server: `upsert PeerVerification { verifierId: myId, peerId }` (idempotent)
7. Shield chuyển xanh, badge header cập nhật đếm
8. Vào nhóm khác có cùng member → tự động xanh (PeerVerification là global)

**Tại sao không block chat như 1-1?**
- Group chat hiếm khi block được — thành viên mới thêm vào sẽ chưa verify
- Signal cũng không block group chat khi chưa verify (Safety Numbers tự nguyện)
- E2EE bảo vệ 99% mối đe dọa (nghe lén, rò rỉ DB) kể cả không verify
- Fingerprint chỉ bảo vệ thêm MITM chủ động (rủi ro rất thấp với hệ thống nội bộ)

---

### UC-21: Quản Lý Whitelist Email (Admin)

**File thực thi:** `Admin.jsx` → `api.getWhitelist()` / `api.addToWhitelist()` / `api.deleteFromWhitelist()`

| Thuộc tính | Nội dung |
|---|---|
| **Tác nhân** | User có `role = ADMIN` |
| **Điều kiện tiên quyết** | Đã đăng nhập, truy cập `/admin` qua icon ⚙ trong sidebar |

**Luồng:**
1. Admin vào trang Admin → Tab "Whitelist Email"
2. Danh sách hiện: email, ngày thêm, ngày dùng (null = chưa đăng ký)
3. Nhập email mới → `api.addToWhitelist(token, email)` → `POST /admin/whitelist`
4. Xóa email → `api.deleteFromWhitelist(token, id)` → `DELETE /admin/whitelist/:id`

**Lưu ý:** Xóa email đã dùng không xóa user — chỉ xóa bản ghi whitelist.

---

### UC-22 & UC-23: Quản Lý Người Dùng (Admin)

**File thực thi:** `Admin.jsx` → `api.disableUser()` / `api.enableUser()` / `api.grantAdmin()` / `api.revokeAdmin()`

**Luồng vô hiệu hóa:**
1. Admin click "Vô hiệu hóa" bên cạnh user
2. `PATCH /admin/users/:id/disable` → `UPDATE User SET isActive=false`
3. Hệ quả ngay lập tức:
   - User bị ẩn khỏi search
   - JWT middleware trả 401 nếu user đó gửi request
   - Người khác không gửi tin được (`POST /messages` check `recipient.isActive`)
   - Sidebar hiện banner "Người dùng này đã không còn trong tổ chức"
4. **KHÔNG xóa ciphertext** — conversation cũ vẫn đọc được (receiver đã có SK)

**Luồng cấp/thu hồi ADMIN:**
1. `PATCH /admin/users/:id/grant-admin` → `UPDATE User SET role=ADMIN`
2. `PATCH /admin/users/:id/revoke-admin`:
   - Dùng `prisma.$transaction` + `SELECT COUNT(*) FOR UPDATE` → PostgreSQL row lock
   - Kiểm tra còn ít nhất 1 ADMIN khác → từ chối nếu đây là admin cuối cùng
   - Chặn admin tự thu hồi quyền mình

**Truy cập Admin Panel:**
- Icon ⚙ trong `ChatSidebar` (chỉ admin thấy) → `navigate('/admin')` (SPA, không reload)
- `wrappingKey` vẫn còn trong RAM → quay lại `/chat` không cần nhập mật khẩu
- Gõ thẳng URL `/admin` sau reload: `wrappingKey` mất → về `/chat` sẽ trigger `UnlockModal` (đúng về bảo mật)
