# Phân Tích Nghiệp Vụ — E2EE Chat
> Toàn bộ nội dung viết theo đúng code thực tế đã đọc

---

## Use Case Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                      Hệ thống E2EE Chat                           │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ «Xác thực»                                                   │  │
│  │   UC-01 Đăng ký       UC-02 Đăng nhập   UC-03 Đăng xuất    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ «Quản lý khóa» (upload KEY xảy ra tại LOGIN, không phải ký)│  │
│  │   UC-04 Upload key bundle    UC-05 Lấy key bundle người khác│  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ «Chat 1-1 E2EE»                                              │  │
│  │   UC-07 Tạo conversation 1-1   UC-08 Gửi tin X3DH           │  │
│  │   UC-09 Gửi tin AES-GCM        UC-10 Verify fingerprint      │  │
│  │   UC-11 Tải lịch sử            UC-12 Xóa tin nhắn           │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ «Chat nhóm»                                                   │  │
│  │   UC-13 Tạo nhóm               UC-14 Thêm/xóa thành viên   │  │
│  │   UC-15 Gửi tin nhóm (N bản E2EE song song)                 │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ «Quản lý thiết bị»                                           │  │
│  │   UC-18 Export .e2ee           UC-19 Import .e2ee            │  │
│  │   UC-20 Unlock sau reload      (wrappingKey mất khỏi RAM)   │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
         ▲                                          ▲
   Người dùng                                    Admin
  (Alice / Bob)                           (thêm AllowedEmail)
```

---

## Ca Nghiệp Vụ Chi Tiết

---

### UC-01: Đăng Ký Tài Khoản

**File thực thi:** `Register.jsx` → `AuthContext.register()` → `api.register()`

| Thuộc tính | Nội dung |
|---|---|
| **Tác nhân** | User chưa có tài khoản |
| **Điều kiện tiên quyết** | Email có trong bảng `AllowedEmail` (Admin thêm trước) |
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
   - **KHÔNG có token trong response** — đây là điểm khác với luồng đăng nhập
5. `storage.savePrivateKeys(userId, wrapSalt, wKey, IK_secret, SPK_priv, opkList)` → lưu IndexedDB
6. `Register.jsx` nhận `resolve()` → `setSuccess(true)` → `setTimeout(() => navigate('/login'), 2500)`
   - **Bắt buộc phải đăng nhập thủ công sau đăng ký — KHÔNG tự động vào chat**

**Điểm quan trọng:**
- `api.register()` chỉ tạo user, **KHÔNG upload key** — upload key xảy ra ở `login()`
- Server không bao giờ thấy private key — chỉ nhận `{username, email, password}`
- Private key lưu IndexedDB dưới dạng ciphertext (wrapped bằng `wrappingKey`)

---

### UC-02: Đăng Nhập

**File thực thi:** `Login.jsx` → `AuthContext.login()` → `api.login()`, `api.uploadKeys()`

| Thuộc tính | Nội dung |
|---|---|
| **Tác nhân** | User đã đăng ký, thiết bị đã có IndexedDB |
| **Kết quả** | JWT lưu localStorage, private key vào RAM, key bundle upload, navigate('/chat') |

**Luồng chính (đúng theo AuthContext.login):**

1. User nhập `username`, `password`
2. `api.login(username, password)` → `POST /auth/login` → nhận `{token, userId, username}`
   - **JWT được sinh tại đây** — không phải đăng ký
   - Server: `bcrypt.compare(password, hash)` → `jwt.sign({userId}, secret, 7d)`
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
8. `api.uploadKeys(token, {ikPub, spkPub, spkSig, opkPubs})` → `POST /keys/upload` với `Authorization: Bearer token`
   - Server `requireAuth` verify JWT trước
   - Nếu server trả `409` (bundle đã tồn tại từ lần login trước) → **bỏ qua, không phải lỗi**
9. Lưu `token, userId, username` vào `localStorage`
10. Set RAM state: `setWrappingKey(wKey)`, `setIKSecret(...)`, `setIKPub(...)`, `setSPKPriv(...)`
11. `isAuthenticated` = `true` → `useEffect` trong `Login.jsx` trigger → `navigate('/chat')`

**Tại sao upload key ở login, không phải register?**
- Vì `POST /keys/upload` có `requireAuth` middleware — cần JWT
- JWT chỉ được tạo ở `POST /auth/login`
- Khi login lần 2 trở đi: server trả 409 → code tự bỏ qua (idempotent design)

---

### UC-03: Đăng Xuất

**File thực thi:** `AuthContext.logout()` → `api.logout()`

**Luồng:**
1. `api.logout(token)` → `POST /auth/logout` → server: `redis.set("blocklist:{token}", "1", EX, ttl)`
2. Xóa `localStorage`: `token`, `userId`, `username`
3. Set toàn bộ state về `null`: `token`, `userId`, `username`, `wrappingKey`, `IK_secret`, `IK_pub`, `SPK_priv`
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

### UC-08: Gửi Tin Nhắn Đầu Tiên (X3DH)

**File thực thi:** `Chat.jsx (getOrCreateSK)` → `x3dh.performX3DH_sender()` → `aesGcm.encryptMessage()` → WS

**Điều kiện:** `fingerprintVerified = true` (MessageInput bị disabled nếu false)

**Luồng:**
1. Alice bấm Gửi
2. `getOrCreateSK(convId, peerId)`: check RAM → check IndexedDB → không có → thực hiện X3DH
3. `api.fetchKeyBundle(token, bobId)` → `GET /keys/{bobId}` → server **pop 1 OPK** khỏi pool → trả `{ikPub, spkPub, spkSig, opkPub, opkId}`
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
2. `storage.getOPK(userId, opkId, wrappingKey)` → lấy đúng 1 OPK (nhanh hơn load all 100)
3. `performX3DH_receiver({IK_secret, SPK_priv, OPK_priv}, initMsg)` → cùng SK
4. `storage.saveSession(convId, SK, wrappingKey)`, `storage.deleteOPK(userId, opkId)`
5. `aesGcm.decryptMessage(ciphertext, iv, aad, SK)` → plaintext

---

### UC-10: Verify Fingerprint

**File thực thi:** `FingerprintModal.jsx` → `fingerprint.generateFingerprint()` → `api.verifyFingerprint()`

**Luồng:**
1. Alice và Bob mỗi người mở `FingerprintModal`
2. `generateFingerprint(IK_pub_A, IK_pub_B)`:
   - `lexCompare` → sort canonical (cả 2 bên ra cùng thứ tự)
   - `combined = concat(sorted[0], sorted[1])` (64B)
   - `hash = SHA-512(combined)`, lặp thêm 5199 lần
   - `digits = (BigInt(hex) % 10n**60n).toString().padStart(60,'0')`
3. Alice đọc 60 chữ số qua kênh ngoài (điện thoại), Bob so sánh
4. Khớp → `api.verifyFingerprint(token, convId)` → `PATCH /conversations/{convId}/fingerprint`
5. Server: `UPDATE conversation SET fingerprintVerified = true`
6. MessageInput được bật (`disabled={!fingerprintVerified}`)
